# API Endpoint Implementation Plan: POST /api/consent

## 1. Endpoint Overview

`POST /api/consent` rejestruje zgodę użytkownika RODO (Terms of Service, Privacy Policy, cookies) z **anonimizacją adresu IP po stronie serwera** (motyw 30 RODO). Endpoint obsługuje dwa warianty wywołania w jednym kontrakcie:

- **Wariant A (bundle)** — atomowy zapis trzech wpisów (`terms_of_service` + `privacy_policy` + `cookies`) podczas rejestracji (US-001) realizowany przez RPC `record_consent_bundle()` (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`). RPC w tej samej transakcji aktualizuje `user_profiles.current_consent_version`, gdy `accepted = true`.
- **Wariant B (per-type)** — pojedynczy zapis (np. wycofanie cookies w cookie banner) wstawiany bezpośrednio do `consent_log` przez klient sesyjny + RLS. Per-type **nie modyfikuje** `current_consent_version`.

Endpoint jest jedynym dopuszczalnym wejściem do `consent_log`; trigger DB `block_protected_columns_update` blokuje próbę bezpośredniej aktualizacji `user_profiles.current_consent_version` z roli `authenticated`.

Plik route handlera: `src/app/api/consent/route.ts` (już zaimplementowany; do uzupełnienia: walidacja `Idempotency-Key` z 60-sekundowym cache, opisana niżej w §9).

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `/api/consent`
- **Routing:** Custom Route Handler (`src/app/api/consent/route.ts`). Matcher proxy w `src/proxy.ts` wyklucza `/api/*` — handler **musi** wywołać `auth.getUser()` jako pierwsze działanie po stworzeniu klienta sesyjnego, by odświeżyć cookies i zapisać `Set-Cookie` w `NextResponse`.
- **Headers:**
  - `Content-Type: application/json` (wymagany)
  - `Idempotency-Key: <uuid v4>` (opcjonalny, zalecany — patrz §6 idempotencja)
  - `Cookie: sb-access-token=…; sb-refresh-token=…` (sesja Supabase, ustawiana przez `@supabase/ssr`)
- **Parameters:**
  - **Required (body):**
    - `version: string` (non-empty)
    - `accepted: boolean`
    - **Dokładnie jedno z:** `types: ConsentType[]` lub `consent_type: ConsentType` (XOR)
  - **Optional:** brak — wszystkie pola spoza powyższych są ignorowane.
- **Request Body — Wariant A (bundle):**

  ```json
  {
    "types": ["terms_of_service", "privacy_policy", "cookies"],
    "version": "1.0",
    "accepted": true
  }
  ```

- **Request Body — Wariant B (per-type):**

  ```json
  {
    "consent_type": "cookies",
    "version": "1.0",
    "accepted": false
  }
  ```

- **Walidacja deklaratywna:**
  - `types` — `Array<ConsentType>`, bez duplikatów (porównanie przez `Set.size`), niepuste, każdy element w `('terms_of_service','privacy_policy','cookies')`.
  - `consent_type` — pojedyncza wartość z tego samego enum.
  - `version` — non-empty string. (Format wersji — semver / data / hash — jest TBD na poziomie produktu, nie endpointu.)
  - `accepted` — boolean.
  - `Idempotency-Key` — jeśli obecny, musi pasować do regexa UUID v4: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.

## 3. Used Types

Wszystkie typy DTO i Command Models są zdefiniowane w `src/types/api.ts` — handler **importuje istniejące typy**, nie redefiniuje ich lokalnie:

| Typ                              | Rola                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `ConsentType`                    | Union `'terms_of_service' \| 'privacy_policy' \| 'cookies'`        |
| `RecordConsentBundleCommand`     | Body wariantu A: `{ types: [ConsentType, …], version, accepted }`  |
| `RecordConsentSingleCommand`     | Body wariantu B: `{ consent_type, version, accepted }`             |
| `RecordConsentCommand`           | Discriminated union obu komend (typ wejściowy walidatora)          |
| `ConsentInsertedItemDto`         | Pojedyncza pozycja w `inserted[]`                                  |
| `RecordConsentBundleResponseDto` | Body 201 dla wariantu A                                            |
| `RecordConsentSingleResponseDto` | Body 201 dla wariantu B                                            |
| `ConsentApiErrorCode`            | Union kodów błędów (zaweża `TypedApiErrorDto<ConsentApiErrorCode>`)|
| `TypedApiErrorDto<T>`            | Generyczny error envelope (`{ error: T, message?: string }`)       |

Lokalnie w handlerze **nie** wprowadzać własnych typów `BundleBody` / `SingleBody` (obecnie istnieją jako duplikaty) — zastąpić ich użycie typami z `@/types/api`.

## 4. Response Details

### 201 Created — Wariant A (bundle)

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

### 201 Created — Wariant B (per-type)

```json
{
  "id": 45,
  "user_id": "uuid-…",
  "consent_type": "cookies",
  "version": "1.0",
  "accepted": false,
  "accepted_at": "2026-05-08T12:00:00Z"
}
```

### Mapowanie statusów

| Status | Kiedy                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- |
| 201    | Sukces (bundle lub per-type)                                                                   |
| 400    | `invalid_payload`, `missing_fields`, `ambiguous_payload`, `invalid_bundle`, `invalid_consent_type`, `invalid_idempotency_key` |
| 401    | `unauthorized` (brak / wygasła sesja Supabase)                                                 |
| 403    | `unauthorized_consent_target` (RPC zgłasza, gdy `p_user_id ≠ auth.uid()` — defense-in-depth)   |
| 409    | `idempotency_key_conflict` (ten sam klucz w 60 s, inny payload)                                |
| 500    | `internal_error` (błąd DB / RPC / nieoczekiwany throw)                                         |

Body błędu zawsze zgodne z `TypedApiErrorDto<ConsentApiErrorCode>`: `{ "error": "<code>" }` (opcjonalnie `message` — w MVP pomijamy, klient mapuje `error` na i18n key).

## 5. Data Flow

```
Client (Next.js page lub cookie banner)
  ↓ POST /api/consent  + Cookie: sb-access-token=…
  ↓ Body: RecordConsentBundleCommand | RecordConsentSingleCommand
  ↓
Route Handler  src/app/api/consent/route.ts
  │
  ├─[1]─ JSON.parse → 400 invalid_payload jeśli throw
  │
  ├─[2]─ Walidacja kształtu (XOR types/consent_type, version, accepted) → 400
  │
  ├─[3]─ createClient() z @/lib/supabase/server
  │      auth.getUser()  ← MUSI być pierwsze (refresh cookies, /api/* poza proxy matcherem)
  │      → 401 unauthorized jeśli brak user
  │
  ├─[4]─ (opcjonalnie) Idempotency-Key:
  │       a. walidacja UUID v4 → 400 invalid_idempotency_key
  │       b. lookup w in-memory Map  cache.get(`${user.id}:${key}`)
  │          • hit z tym samym sha256(body) → return cached.response
  │          • hit z innym hashem        → 409 idempotency_key_conflict
  │          • miss                      → kontynuuj, zapisz po sukcesie
  │
  ├─[5]─ Anonimizacja IP (src/lib/ipAnonymize.ts):
  │       pickForwardedFor(x-forwarded-for) ?? x-real-ip → anonymizeIp()
  │       IPv4 → /24 (ostatni oktet 0)
  │       IPv6 → /48 (zerowanie 80 LSB)
  │
  ├─[6a]─ BUNDLE (types[]):
  │        supabase.rpc('record_consent_bundle', {
  │          p_user_id: user.id, p_version, p_accepted, p_ip, p_user_agent
  │        })
  │        Postgres: SECURITY DEFINER, jako rola postgres
  │          • CHECK auth.uid() = p_user_id (lub service_role bypass) → RAISE unauthorized_consent_target
  │          • INSERT 3× consent_log w jednej transakcji
  │          • UPDATE user_profiles.current_consent_version = p_version (gdy accepted)
  │
  │        SELECT id, consent_type, version, accepted, accepted_at
  │          FROM consent_log
  │          WHERE user_id = $1 AND version = $2 AND consent_type IN ($types)
  │          ORDER BY id ASC LIMIT N    ← RLS filtruje user_id = auth.uid()
  │
  │        SELECT current_consent_version
  │          FROM user_profiles
  │          WHERE id = $1
  │
  │        → 201 RecordConsentBundleResponseDto
  │
  └─[6b]─ PER-TYPE (consent_type):
           supabase.from('consent_log').insert({...}).select().single()
           RLS: consent_log_insert_authenticated  user_id = auth.uid()
           → 201 RecordConsentSingleResponseDto
```

**Krytyczne interakcje DB:**

- `consent_log` (append-only; RLS SELECT+INSERT dla `authenticated`; brak UPDATE/DELETE — niezależnie od ścieżki).
- `user_profiles.current_consent_version` — modyfikowane **wyłącznie** przez RPC `record_consent_bundle()` (gałąź `current_user = 'postgres'` omija trigger `block_protected_columns_update`); klient sesyjny bezpośredniej aktualizacji nie wykona (CLAUDE.md, `api-plan.md` §2.2).
- RPC posiada `SECURITY DEFINER` — dzięki temu mimo że wywołujemy klientem sesyjnym (`anon` JWT z claim `authenticated`), zapis odbywa się jako rola właściciela funkcji (`postgres`).

## 6. Security Considerations

- **Authentication:** Sesja Supabase weryfikowana przez `@supabase/ssr` (`createServerClient` w `src/lib/supabase/server.ts`). `auth.getUser()` to **pierwsza** operacja po utworzeniu klienta — bez tego cookies nie zostaną odświeżone (matcher proxy wyklucza `/api/*`).
- **Authorization:**
  - Klient sesyjny + RLS (`consent_log_insert_authenticated`: `user_id = auth.uid()`).
  - RPC `record_consent_bundle()` ma własną kontrolę: rzuca `unauthorized_consent_target`, gdy `p_user_id ≠ auth.uid()` dla `authenticated` (defense-in-depth — w obecnym handlerze nieosiągalne, bo zawsze ustawiamy `p_user_id = user.id`).
  - Endpoint **nie używa** `service_role` (w przeciwieństwie do `/api/paddle/webhook` i `/api/cron/*`). `SUPABASE_SERVICE_ROLE_KEY` nie powinien być importowany w tym pliku.
- **Input validation:**
  - JSON parsing w try/catch → `invalid_payload` (nie ujawniamy treści exception).
  - Whitelist enum `ConsentType` (`'terms_of_service' | 'privacy_policy' | 'cookies'`) zarówno w payloadzie, jak i w bundle array (każdy element).
  - XOR enforcement na poziomie aplikacji (nie polegamy na DB CHECK constraint).
  - Deduplikacja `types` przez `new Set(types).size === types.length`.
  - `Idempotency-Key`: regex UUID v4 — nieprawidłowy format = 400 (klient mógłby wysłać string podatny na collision).
- **IP anonymization (RODO motyw 30):**
  - **Obowiązkowa** przed jakimkolwiek INSERT — używać `anonymizeIp()` z `src/lib/ipAnonymize.ts` (już istnieje + ma testy jednostkowe).
  - Surowy IP **nigdy** nie trafia do bazy ani do logów (`console.error` nie loguje pełnego adresu).
- **Header injection / spoofing:**
  - `x-forwarded-for` na Vercel jest ustawiany przez edge proxy — pierwsza wartość to klient. Używamy `pickForwardedFor()`, który bierze pierwszy element listy (CSV).
  - `User-Agent` zapisywany 1:1 (nullable, max długość ograniczona przez Postgres TEXT — brak limitu, ale RLS chroni przed eksfiltracją cudzych wpisów).
- **Rate limiting (TODO post-MVP):**
  - 5 req/min/user, 50 req/dzień/user — append-only tabela rośnie nieograniczenie.
  - W MVP brak; zaplanowane w `api-plan.md` §11. Idempotency-Key 60 s częściowo łagodzi flood.
- **Idempotency cache zagrożenia:**
  - In-memory `Map` per Fluid Compute instance — między instancjami brak współdzielenia (akceptowalne w MVP; kolejny request może powtórzyć insert na innej instancji, ale `consent_log` jest append-only i RODO art. 7 wymaga audytu, więc duplikat jest mniejszym złem niż utrata zapisu).
  - Klucz cache zawsze prefiksowany `user.id:` — jeden klucz nie może kolidować między użytkownikami.
  - TTL 60 s realizowany przez `setTimeout` lub timestamp + lazy cleanup; preferowany lazy cleanup, by uniknąć leaków timerów.

## 7. Error Handling

| Scenariusz                                                                                  | Status | Body                                              |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `await request.json()` throw                                                                | 400    | `{ "error": "invalid_payload" }`                  |
| Body nie jest obiektem / brak `version` / brak `accepted`                                   | 400    | `{ "error": "missing_fields" }`                   |
| Jednocześnie `types` i `consent_type` LUB żadne z dwóch                                     | 400    | `{ "error": "ambiguous_payload" }`                |
| `types` nie jest tablicą / pusta tablica / duplikaty                                        | 400    | `{ "error": "invalid_bundle" }`                   |
| `types[i]` lub `consent_type` poza enum                                                     | 400    | `{ "error": "invalid_consent_type" }`             |
| `Idempotency-Key` obecny ale niezgodny z UUID v4                                            | 400    | `{ "error": "invalid_idempotency_key" }`          |
| Brak sesji (`getUser()` zwraca `null`)                                                      | 401    | `{ "error": "unauthorized" }`                     |
| RPC `record_consent_bundle` rzuca `unauthorized_consent_target`                             | 403    | `{ "error": "unauthorized_consent_target" }`      |
| `Idempotency-Key` cache hit z innym SHA-256 hashem payloadu                                 | 409    | `{ "error": "idempotency_key_conflict" }`         |
| RPC zwraca `error` inny niż `unauthorized_consent_target`                                   | 500    | `{ "error": "internal_error" }`                   |
| `supabase.from('consent_log').insert(...).select().single()` zwraca `error`                 | 500    | `{ "error": "internal_error" }`                   |
| `supabase.from('user_profiles').select('current_consent_version').single()` zwraca `error`  | 500    | `{ "error": "internal_error" }`                   |
| Nieoczekiwany throw w try/catch globalnym                                                   | 500    | `{ "error": "internal_error" }`                   |

**Logowanie błędów:**

- Brak dedykowanej tabeli `error_log` w schemacie. W razie 500:
  - `console.error('[POST /api/consent]', { code, message: err.message, hint: err.hint, path: err.code })` — Vercel zbiera do Functions Logs (retention 7 dni na hobby / 30 dni na pro).
  - **Nigdy** nie logować surowego `request.body`, `user_id`, ani anonimizowanego IP w `console.error` — wystarczą kody błędów (`error.code`, `error.hint`).
- Dla 400/401/403/409 logowanie pomijamy (sygnał klienta, nie błąd serwera) — chyba że dodamy w przyszłości debug-level logging za feature flagiem.

**Ścieżka mapowania błędów Postgres:**

- W docelowej implementacji `src/lib/supabase/errors.ts` (istnieje stub w `api-plan.md` §9; nie zaimplementowany) wprowadzi `mapPostgrestError(err)`. Do tego czasu sprawdzamy `err.message?.includes('unauthorized_consent_target')` jako jedyny string-match (zgodnie z istniejącym kodem) — pozostałe błędy → `internal_error`. Po implementacji `errors.ts` zastąpić tę gałąź `mapPostgrestError`.

## 8. Performance Considerations

- **Endpoint nie jest hot-path** — wywoływany 1× przy rejestracji + sporadycznie przy zmianie zgód. Brak potrzeby agresywnej optymalizacji.
- **Bundle insert atomowo w jednym round-tripie do DB** dzięki RPC — eliminuje 3× INSERT + 1× UPDATE z aplikacji oraz okno niespójności audytu RODO art. 7 ust. 1.
- **Dwa dodatkowe SELECT-y po RPC** (`consent_log` × `user_profiles`) — koszt akceptowalny dla rejestracji; alternatywa (RPC zwracający rekordy + `current_consent_version` w jednym RETURNS TABLE) jest możliwa, ale wymagałaby zmiany sygnatury RPC i nowej migracji — odłożone post-MVP.
- **Indeksy**: `consent_log` powinien mieć indeks `(user_id, version, consent_type)` dla SELECT po bundle (sprawdzić `db-plan.md`; jeśli go brak — dodać w kolejnej migracji).
- **Idempotency cache** (in-memory `Map`):
  - Dostęp O(1).
  - Cleanup lazy: przy każdym `get`, jeśli `entry.expiresAt < now` → `delete`. Bez `setInterval` (uniknięcie leaków na zimnym Lambdzie).
  - Limit rozmiaru ~1000 wpisów per instancja; po przekroczeniu LRU eviction (oczyszczanie najstarszego). W MVP nawet zwykły `Map` wystarczy — Fluid Compute resetuje stan między cold-startami.
- **Region `fra1`** (Vercel) collocated z Supabase EU-Frankfurt — RTT do DB ~5–15 ms.
- **Cold start**: Route Handler w runtime Node.js; brak ciężkich importów (Konva itd. nie wchodzą tutaj). Bundle ~50 KB.

## 9. Implementation Steps

> Plik `src/app/api/consent/route.ts` **istnieje** i pokrywa większość logiki. Poniższe kroki opisują (1) refaktor istniejącego kodu pod typy z `@/types/api` i (2) dodanie brakujących elementów (idempotency, mapowanie błędów docelowe).

### Krok 1 — Przepiąć handler na typy z `@/types/api`

W `src/app/api/consent/route.ts`:

- Usunąć lokalne `BundleBody`, `SingleBody`, `CONSENT_TYPES`, `ConsentType`, `isConsentType`.
- Zaimportować z `@/types/api`:
  ```ts
  import type {
    ConsentType,
    RecordConsentBundleCommand,
    RecordConsentSingleCommand,
    RecordConsentBundleResponseDto,
    RecordConsentSingleResponseDto,
    ConsentApiErrorCode,
    TypedApiErrorDto
  } from '@/types/api';
  ```
- Zdefiniować lokalnie tylko `const CONSENT_TYPES: readonly ConsentType[] = ['terms_of_service','privacy_policy','cookies']` (DRY z type guard).
- Zmienić sygnaturę helpera `err`:
  ```ts
  function err(code: ConsentApiErrorCode, status: number) {
    return NextResponse.json<TypedApiErrorDto<ConsentApiErrorCode>>({ error: code }, { status });
  }
  ```
  → kompilator wymusza, by każdy zwracany kod należał do `ConsentApiErrorCode`.

### Krok 2 — Dodać walidację `Idempotency-Key`

Dodać do route handlera:

```ts
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotencyKey = request.headers.get('idempotency-key');
if (idempotencyKey !== null && !UUID_V4.test(idempotencyKey)) {
  return err('invalid_idempotency_key', 400);
}
```

Kolejność walidacji: **przed** `auth.getUser()` (cheaper) — ale po JSON.parse, bo do hashowania payloadu potrzebny jest body.

### Krok 3 — Wyekstrahować idempotency cache do `src/lib/idempotency.ts`

Nowy plik (poza `route.ts`, by ułatwić testowanie i potencjalne dzielenie z innymi route'ami w przyszłości):

```ts
// src/lib/idempotency.ts
type CacheEntry = { payloadHash: string; status: number; body: unknown; expiresAt: number };
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export type IdempotencyResult =
  | { kind: 'hit'; status: number; body: unknown }
  | { kind: 'conflict' }
  | { kind: 'miss' };

export function lookupIdempotency(key: string, payloadHash: string): IdempotencyResult {
  const entry = cache.get(key);
  if (!entry) return { kind: 'miss' };
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return { kind: 'miss' };
  }
  if (entry.payloadHash !== payloadHash) return { kind: 'conflict' };
  return { kind: 'hit', status: entry.status, body: entry.body };
}

export function storeIdempotency(key: string, payloadHash: string, status: number, body: unknown): void {
  cache.set(key, { payloadHash, status, body, expiresAt: Date.now() + TTL_MS });
}

export async function hashPayload(body: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

`crypto.subtle` jest dostępny w Node 22 globalnie (Web Crypto). Klucz cache ZAWSZE z prefiksem `user.id:` (handler przygotowuje pełny string).

### Krok 4 — Zintegrować idempotency w handlerze

Po `auth.getUser()` (mamy `user.id`):

```ts
if (idempotencyKey) {
  const payloadHash = await hashPayload(body);
  const cacheKey = `${user.id}:${idempotencyKey}`;
  const result = lookupIdempotency(cacheKey, payloadHash);
  if (result.kind === 'conflict') return err('idempotency_key_conflict', 409);
  if (result.kind === 'hit') return NextResponse.json(result.body, { status: result.status });
  // miss → kontynuuj; po sukcesie wywołać storeIdempotency(cacheKey, payloadHash, 201, responseBody)
}
```

W obu gałęziach (bundle / per-type) **przed** `return NextResponse.json(...)` zapisać do cache, jeśli `idempotencyKey` był obecny.

### Krok 5 — Wzmocnić walidację XOR i kształt body

Obecna walidacja jest poprawna, ale zaostrzyć kolejność komunikatów (jednoznaczne case-by-case):

1. `typeof body !== 'object' || body === null` → `missing_fields`.
2. `hasTypes && hasSingle` → `ambiguous_payload`.
3. `!hasTypes && !hasSingle` → `ambiguous_payload`.
4. `version` brak / nie-string / pusty → `missing_fields`.
5. `accepted` brak / nie-boolean → `missing_fields`.
6. (bundle) `!Array.isArray(types)` lub `types.length === 0` lub duplikaty → `invalid_bundle`.
7. (bundle) element spoza enum → `invalid_consent_type`.
8. (per-type) `consent_type` spoza enum → `invalid_consent_type`.

### Krok 6 — Mapowanie błędów RPC na typed errors (przyszłość)

Po implementacji `src/lib/supabase/errors.ts` zastąpić obecny string-match:

```ts
if (rpcError) {
  if (rpcError.message?.includes('unauthorized_consent_target')) {
    return err('unauthorized_consent_target', 403);
  }
  return err('internal_error', 500);
}
```

na:

```ts
if (rpcError) {
  const mapped = mapPostgrestError(rpcError);
  if (mapped.business === BusinessError.UnauthorizedConsentTarget) {
    return err('unauthorized_consent_target', 403);
  }
  console.error('[POST /api/consent] RPC error', { code: rpcError.code, hint: rpcError.hint });
  return err('internal_error', 500);
}
```

Dopóki `errors.ts` nie istnieje — pozostawić obecną implementację, ale dodać `console.error` z polami `code`, `hint`, **bez** treści `message` (mogłaby zawierać dane domenowe).

### Krok 7 — Dodać testy jednostkowe

Pliki testowe (`vitest`, `jsdom`):

- `src/lib/idempotency.test.ts` — happy path (miss → store → hit), conflict, TTL expiry, hash determinism dla równoważnych obiektów.
- `src/app/api/consent/route.test.ts` — handler z mockowanym `createClient` (`@/lib/supabase/server`):
  - bundle 201 z 3 wpisami + `current_consent_version`,
  - per-type 201,
  - 400 dla każdego kodu walidacji (parametryzowany `it.each`),
  - 401 gdy `auth.getUser()` zwraca `null`,
  - 403 gdy RPC zwraca message z `unauthorized_consent_target`,
  - 409 dla idempotency conflict,
  - 500 gdy `select` po RPC zwraca error,
  - asercja, że `anonymizeIp()` zostało wywołane z headers (mock przez `vi.spyOn`),
  - asercja, że `auth.getUser()` zostało wywołane **przed** `rpc()`/`from()`.

Coverage thresholds dla `src/lib/**` i `src/app/api/**` (jeśli rozszerzymy `vitest.config.ts`): lines 80, branches 70.

### Krok 8 — Test E2E (Playwright)

Po implementacji UI rejestracji (US-001) dodać `e2e/consent-bundle.spec.ts`:

- Rejestracja → assertion: 3 wiersze w `consent_log` po stronie DB (przez admin client w setup helper).
- Cookie banner withdrawal → 1 wiersz `accepted = false`, `current_consent_version` niezmienione.

### Krok 9 — Smoke test ręczny

```bash
# 1. Logowanie + zapisanie cookie sesyjnego
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"…"}'

# 2. Bundle
curl -b cookies.txt -X POST http://localhost:3000/api/consent \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"types":["terms_of_service","privacy_policy","cookies"],"version":"1.0","accepted":true}'

# 3. Per-type withdrawal
curl -b cookies.txt -X POST http://localhost:3000/api/consent \
  -H "Content-Type: application/json" \
  -d '{"consent_type":"cookies","version":"1.0","accepted":false}'

# 4. Brak sesji (oczekiwane 401)
curl -X POST http://localhost:3000/api/consent \
  -H "Content-Type: application/json" \
  -d '{"types":["terms_of_service","privacy_policy","cookies"],"version":"1.0","accepted":true}'
```

### Krok 10 — Code review checklist (PR)

Przed merge do `main`:

- [ ] Importy z `@/types/api` (zero lokalnych re-definicji `ConsentType`).
- [ ] `auth.getUser()` jako pierwsza operacja po `createClient()`.
- [ ] Brak `SUPABASE_SERVICE_ROLE_KEY` / `createAdminClient` w pliku.
- [ ] `anonymizeIp()` wywołane przed każdym INSERT.
- [ ] `console.error` nie loguje surowego IP, body ani user_id (tylko `code`, `hint`).
- [ ] Wszystkie kody błędów należą do `ConsentApiErrorCode` (TS sprawdza dzięki helperowi `err`).
- [ ] Idempotency cache zaimplementowane w osobnym pliku (`src/lib/idempotency.ts`) — testy pokrywają TTL i conflict.
- [ ] Conventional Commit (`feat(api): add idempotency to POST /api/consent` lub `refactor(api): use shared types in /api/consent`).
