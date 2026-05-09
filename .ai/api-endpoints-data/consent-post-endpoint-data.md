# Endpoint
POST /api/consent

## Description
Rejestruje zgodę użytkownika RODO (TOS, Privacy Policy, cookies) z anonimizacją adresu IP po stronie serwera (motyw 30 RODO). Obsługuje **bundle insert** (przy rejestracji — atomowo TOS+PP+cookies) lub **per-type insert** (przy wycofaniu pojedynczej zgody). Custom Route Handler — plik `src/app/api/consent/route.ts`.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`) — weryfikowana przez `@supabase/ssr` (`createServerClient`).
- **NIE** używa `service_role`. Klient sesyjny + RLS + RPC `record_consent_bundle()` (`SECURITY DEFINER`, wykonuje się jako rola `postgres`).
- **Krytyczne:** handler musi wywołać `auth.getUser()` jako pierwsze działanie po stworzeniu klienta — matcher proxy w `src/proxy.ts` wyklucza `/api/*`, więc bez tego call'a cookies nie są refreshowane.

## Request Headers
```
Content-Type: application/json
Idempotency-Key: <uuid v4>            # zalecany — patrz §7 api-plan
```

## Request Body Schema

### Wariant A — bundle (rejestracja, US-001)
```json
{
  "types": ["terms_of_service", "privacy_policy", "cookies"],
  "version": "1.0",
  "accepted": true
}
```

### Wariant B — per-type (np. wycofanie cookies)
```json
{
  "consent_type": "cookies",
  "version": "1.0",
  "accepted": false
}
```

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `types` | `Array<"terms_of_service" \| "privacy_policy" \| "cookies">` | jeden z `types`/`consent_type` | Bundle insert |
| `consent_type` | `"terms_of_service" \| "privacy_policy" \| "cookies"` | jeden z `types`/`consent_type` | Single-row insert |
| `version` | `string` | tak | Wersja dokumentu zgody (taka sama dla całego bundla) |
| `accepted` | `boolean` | tak | `false` = wycofanie zgody (zwykle z `consent_type`) |

> **Zasada:** dokładnie jedno z `types`/`consent_type` musi być obecne. Mieszanie pól → 400 `ambiguous_payload`.

## Response

### 201 — bundle
```json
{
  "inserted": [
    { "id": 42, "consent_type": "terms_of_service", "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" },
    { "id": 43, "consent_type": "privacy_policy",   "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" },
    { "id": 44, "consent_type": "cookies",          "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" }
  ],
  "current_consent_version": "1.0"
}
```

### 201 — per-type
```json
{
  "id": 45,
  "user_id": "uuid-...",
  "consent_type": "cookies",
  "version": "1.0",
  "accepted": false,
  "accepted_at": "2026-05-08T12:00:00Z"
}
```

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 400 | `{ "error": "invalid_consent_type" }` | Wartość spoza `CHECK` |
| 400 | `{ "error": "invalid_payload" }` | Malformed JSON |
| 400 | `{ "error": "missing_fields" }` | Brak wymaganych pól |
| 400 | `{ "error": "ambiguous_payload" }` | Równocześnie `types` i `consent_type` lub żadne |
| 400 | `{ "error": "invalid_bundle" }` | `types` zawiera wartości spoza `CHECK` lub duplikaty |
| 400 | `{ "error": "invalid_idempotency_key" }` | `Idempotency-Key` obecny ale nie UUID v4 |
| 401 | `{ "error": "unauthorized" }` | Brak sesji |
| 403 | `{ "error": "unauthorized_consent_target" }` | RPC `record_consent_bundle` rzuca gdy `p_user_id ≠ auth.uid()` (defense-in-depth) |
| 409 | `{ "error": "idempotency_key_conflict" }` | Ten sam `Idempotency-Key` w 60s, ale inny payload |
| 500 | `{ "error": "internal_error" }` | Błąd DB |

## Database Tables Involved

### `public.consent_log`
Append-only audyt zgód. RLS: SELECT/INSERT dla `authenticated` (po `user_id = auth.uid()`); brak UPDATE/DELETE.

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` |
| `user_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `consent_type` | `TEXT` | `CHECK (consent_type IN ('terms_of_service','privacy_policy','cookies'))` |
| `version` | `TEXT` | `NOT NULL` |
| `accepted` | `BOOLEAN` | `NOT NULL` |
| `accepted_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |
| `ip_address` | `INET` | nullable, **anonimizowany przed INSERT** |
| `user_agent` | `TEXT` | nullable |

### `public.user_profiles`
| Kolumna | Typ | Uwagi |
|---|---|---|
| `current_consent_version` | `TEXT` | Aktualizowane wyłącznie przez RPC `record_consent_bundle()` (`SECURITY DEFINER`, jako rola `postgres`). Trigger `block_protected_columns_update` blokuje zmianę z roli `authenticated`. |

## Business Logic

### 1. Verify session
```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
```

### 2. Idempotency-Key handling (jeśli obecny)
- Walidacja jako UUID v4 → 400 jeśli nie.
- Klucz cache: `${user.id}:${idempotencyKey}` (per user).
- Hash payloadu: SHA-256 z `JSON.stringify(body)`.
- Lookup w cache (TTL 60s, in-memory `Map` per Fluid Compute instance w MVP):
  - Trafienie z **identycznym hashem** → zwróć zapisaną odpowiedź.
  - Trafienie z **innym hashem** → 409 `idempotency_key_conflict`.
  - Brak trafienia → kontynuuj; zapisz `{ status, body, payloadHash }` w cache.
- Brak nagłówka = brak idempotency (każde wywołanie = nowy wiersz).

### 3. Validate payload
- Dokładnie jedno z `types`/`consent_type` (XOR).
- `types` bez duplikatów; każdy w `('terms_of_service','privacy_policy','cookies')`.
- `version` non-empty string; `accepted` boolean.

### 4. Pobranie i anonimizacja IP
- Czytaj `x-forwarded-for` (pierwszy adres) lub `x-real-ip`.
- Anonimizacja przez `src/lib/ipAnonymize.ts`:
  - IPv4: wyzeruj ostatni oktet (`192.168.1.42` → `192.168.1.0/24`)
  - IPv6: wyzeruj ostatnie 80 bitów (`/48`)
- Czytaj `User-Agent` z headers.

### 5. Bundle insert (`types: [...]`) — atomowo
```typescript
const { data, error } = await supabase.rpc('record_consent_bundle', {
  p_user_id: user.id,
  p_version: version,
  p_accepted: accepted,
  p_ip: anonIp,
  p_user_agent: userAgent
})
```
RPC `record_consent_bundle()` (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`):
- W **jednej transakcji** wstawia 3 wiersze do `consent_log` (po jednym dla każdego typu).
- Gdy `p_accepted = true` → aktualizuje `user_profiles.current_consent_version = p_version`.
- Egzekwuje `auth.uid() = p_user_id` dla `authenticated`; `service_role` może rejestrować dla dowolnego usera.
- Eliminuje okno niespójności audytu RODO art. 7 ust. 1.

### 6. Per-type insert (`consent_type: ...`)
```typescript
const { data, error } = await supabase
  .from('consent_log')
  .insert({
    user_id: user.id,
    consent_type,
    version,
    accepted,
    ip_address: anonIp,
    user_agent: userAgent
  })
  .select()
  .single()
```
RLS `consent_log_insert_authenticated` egzekwuje `user_id = auth.uid()`. Per-type wycofanie zgody **nie modyfikuje** `current_consent_version`.

## Validation Rules
| Pole | Reguła |
|---|---|
| `consent_type` | `IN ('terms_of_service','privacy_policy','cookies')` (CHECK) |
| `version` | NOT NULL — format TBD legalnie (semver / data / hash) |
| `accepted` | NOT NULL boolean |
| `ip_address` | Anonimizowany przed INSERT (motyw 30 RODO) |

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Plik: `src/app/api/consent/route.ts` (już zaimplementowany — używa RPC `record_consent_bundle`).
- `src/lib/ipAnonymize.ts` istnieje (CLAUDE.md) — używać.
- Idempotency cache w MVP: in-memory `Map` per Fluid Compute instance. Production: Vercel KV / Upstash Redis (post-MVP).
- Rate limit (TODO): 5/min/user, 50/dzień/user (append-only — flood = unbounded growth).
- Klient powinien generować świeży `uuid v4` przed każdym kliknięciem „Zaakceptuj"/„Wycofaj"; ten sam klucz na retry.
- Klient **nie powinien** ręcznie aktualizować `current_consent_version` w `user_profiles` — trigger `block_protected_columns_update` cicho ignoruje.
