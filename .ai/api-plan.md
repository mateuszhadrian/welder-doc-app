# REST API Plan — WelderDoc MVP

> **Status:** projekt do implementacji  
> **Wersja dokumentu:** 1.1 · **Data:** 2026-05-08  
> **Powiązane dokumenty:** `.ai/db-plan.md`, `.ai/prd.md`, `.ai/tech-stack.md`, `.ai/architecture-base.md`, `.ai/api-plan-audit.md`, `.ai/api-plan-fix-summary.md`
>
> Plan obejmuje dwie kategorie komunikacji: (A) **Custom Route Handlers** — pliki w `src/app/api/`, wymagające implementacji; (B) **Operacje przez Supabase SDK** — wywołania PostgREST/Auth SDK bezpośrednio z klienta lub Server Components, zabezpieczone przez RLS.
>
> **Changelog v1.1 (2026-05-08):** wprowadzone poprawki na podstawie audytu (`.ai/api-plan-audit.md`). Dodane: `DELETE /api/user/account` (RODO art. 17, C1), `Idempotency-Key` dla `POST /api/consent` (M2), Paddle Customer Portal flow, wrapper `updateProfile()` dla protected columns (M3), nowe sekcje §6 Rate Limiting (M1), §7 Idempotencja (M2 cross-cutting), §8 Wersjonowanie API (M4), §9 Error Mapping (m7), §10 Co poza zakresem (OAuth, post-MVP). Doprecyzowane: read-modify-write dla US-014 (m1), `NEXT_LOCALE` cookie po `PATCH locale` (m2), sortowanie listy dokumentów (m3), limit 5 MB payload (m4), resend confirmation email (m5), soft-target <30s dla `/api/user/export` (m8), konsekwencje pominięcia `auth.getUser()` w handlerach.

---

## 1. Zasoby

| Zasób | Tabela DB | Opis |
|---|---|---|
| Dokument | `public.documents` | Projekt rysunku złącza spawanego (scena JSONB) |
| Profil użytkownika | `public.user_profiles` | Plan, locale, wersja zgody — 1:1 z `auth.users` |
| Subskrypcja | `public.subscriptions` | Historia subskrypcji Paddle — append/update przez webhook |
| Dziennik zgód | `public.consent_log` | Append-only audyt zgód RODO (TOS, PP, cookies) |
| Zdarzenie webhooka | `public.webhook_events` | Idempotencja i audyt webhooków Paddle |

---

## 2. Punkty końcowe API

### 2.1 Custom Route Handlers (`src/app/api/`)

Operacje wymagające dostępu do sekretów serwera, anonimizacji IP lub wywołań `service_role`.

---

#### `POST /api/paddle/webhook`

Obsługuje zdarzenia Paddle Billing (cykl życia subskrypcji, eventy klienta).

**Autoryzacja:** weryfikacja podpisu HMAC-SHA256 z nagłówka `paddle-signature` (`PADDLE_WEBHOOK_SECRET`)

**Nagłówki żądania:**
```
paddle-signature: ts=1746703200;h1=abc123...
Content-Type: application/json
```

**Obsługiwane typy zdarzeń:**
- `subscription.created`, `subscription.activated`, `subscription.updated`
- `subscription.canceled`, `subscription.paused`, `subscription.past_due`
- `customer.created`, `customer.updated`

**Przykładowy ładunek (subscription.activated):**
```json
{
  "event_type": "subscription.activated",
  "event_id": "evt_01abc123",
  "occurred_at": "2026-05-08T12:00:00Z",
  "data": {
    "id": "sub_01abc123",
    "customer": {
      "id": "ctm_01abc123",
      "email": "user@example.com"
    },
    "status": "active",
    "items": [
      { "price": { "id": "pri_monthly_49pln" } }
    ],
    "current_billing_period": {
      "starts_at": "2026-05-08T12:00:00Z",
      "ends_at": "2026-06-08T12:00:00Z"
    }
  }
}
```

**Odpowiedź sukces (200):**
```json
{ "received": true }
```

**Odpowiedź sukces — duplikat (200):**
```json
{ "received": true, "duplicate": true }
```

**Kody błędów:**

| Kod | Opis |
|---|---|
| 400 | `{ "error": "missing_signature" }` — brak nagłówka |
| 400 | `{ "error": "invalid_signature" }` — nieprawidłowy podpis HMAC |
| 400 | `{ "error": "invalid_payload", "message": "..." }` — malformed JSON lub brak `event_id` / `event_type` / `data` (sygnatura była poprawna, ale ciało zdarzenia jest nieprzetwarzalne) |
| 500 | `{ "error": "internal_error", "message": "..." }` — błąd DB |

**Logika przetwarzania:**
1. Weryfikacja podpisu Paddle (`PADDLE_WEBHOOK_SECRET`)
2. `INSERT INTO webhook_events ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id` — idempotencja
3. Puste `RETURNING` → duplikat → HTTP 200 bez efektu biznesowego
4. Przetwarzanie wg `event_type` przez klienta `service_role`:
   - `subscription.*` → upsert w `subscriptions` (na podstawie `paddle_subscription_id`)
   - `customer.*` → aktualizacja `user_profiles.paddle_customer_id`
5. Trigger `subscriptions_after_iu_refresh_plan` automatycznie przelicza `user_profiles.plan`
6. Trigger `subscriptions_after_iu_sync_customer` synchronizuje `paddle_customer_id` z `paddle_customer_snapshot`

**Recovery flow (`customer.*` jako pierwszy webhook):** Paddle nie gwarantuje kolejności `customer.created` vs `subscription.created`.
- `customer.created` jako pierwszy: `lookupUserId` w `handleCustomerEvent` próbuje email lookup (RPC `lookup_user_id_by_email`). Sukces → UPDATE `paddle_customer_id`. Niepowodzenie (email niezarejestrowany lub niezgodny) → orphan log, brak efektu na `user_profiles`. Pierwszy `subscription.created` użyje `customData.user_id` (zalecane, patrz §2.2 PR checklist) lub email; trigger `sync_paddle_customer` wypełni `paddle_customer_id` z `paddle_customer_snapshot`, jeśli wciąż NULL.
- `subscription.created` jako pierwszy: trigger `sync_paddle_customer` wpisuje `paddle_customer_id` do `user_profiles`. Następujący `customer.updated` dla tego użytkownika znajdzie usera przez `paddle_customer_id` lookup (krok 2 priorytetów).

**Lookup użytkownika (kolejność priorytetów):**
1. `payload.data.customData.user_id` — przekazywane z Paddle Checkout (`customData: { user_id }`)
2. Fallback: `user_profiles WHERE paddle_customer_id = payload.data.customer.id` (przez SDK supabase-js)
3. Fallback: `RPC public.lookup_user_id_by_email(p_email)` z emailem z `data.customer?.email ?? data.email` — `SECURITY DEFINER`, `service_role only` (migracja `20260509000000_paddle_webhook_hardening.sql`). `auth.users` **nie jest** wystawiona przez PostgREST (`config.toml [api].schemas` zawiera tylko `public, graphql_public`) — bezpośrednie zapytanie `from('users', { schema: 'auth' })` zwraca `relation does not exist`. RPC opakowuje pojedynczy SELECT po `lower(email)`, skaluje się do dowolnej liczby użytkowników (zastępuje `auth.admin.listUsers({ perPage: 200 })` paginowane). Implementacja: `webhook/route.ts` `lookupUserId()`. **Wymaga**, by przynajmniej jedno z dwóch pól było obecne w payload Paddle. Production payload `customer.created/updated` ma `data.email` top-level; production payload `subscription.*` ma `data.customer.email`. Sandbox webhook test (Paddle Dashboard → Webhooks → „Send test event") może wysyłać payload bez wypełnionego emaila — wtedy fallthrough do kroku 4 (orphan log).
4. Jeśli user nie znaleziony → zapisz `webhook_event`, zaloguj warning, zwróć 200 (webhook może przyjść przed rejestracją; `subscriptions.user_id` pozostaje `NULL` — recovery przez manualny `UPDATE subscriptions SET user_id = ...` później; trigger `subscriptions_after_iu_refresh_plan` automatycznie odświeży `user_profiles.plan` dla nowego właściciela)

---

#### `POST /api/consent`

Rejestruje zgodę użytkownika z anonimizacją adresu IP po stronie serwera (RODO motyw 30).

**Autoryzacja:** aktywna sesja Supabase (`authenticated`), weryfikowana przez `@supabase/ssr`

**Nagłówki żądania:**
```
Content-Type: application/json
Idempotency-Key: <uuid v4>            # zalecany — patrz §7
```

> **Idempotency-Key (M2):** klient powinien generować świeży `uuid v4` przed każdym kliknięciem przycisku „Zaakceptuj"/„Wycofaj". Handler trzyma cache klucz → odpowiedź przez 60 sekund (in-memory `Map` per instancja Fluid Compute w MVP; przeniesienie do Vercel KV / Upstash Redis jest follow-upem przed produkcją — patrz §7). Powtórzony request z tym samym kluczem (np. retry sieciowy lub double-click) zwraca **oryginalną odpowiedź** bez ponownego INSERT-u do `consent_log`. Brak nagłówka = endpoint zachowuje się jak append-only (każde wywołanie = nowy wiersz) — działa, ale klient ponosi ryzyko duplikatów.

**Ładunek żądania (bundle — przy rejestracji):**
```json
{
  "types": ["terms_of_service", "privacy_policy", "cookies"],
  "version": "1.0",
  "accepted": true
}
```

**Ładunek żądania (per-type — wycofanie pojedynczej zgody, np. cookies):**
```json
{
  "consent_type": "cookies",
  "version": "1.0",
  "accepted": false
}
```

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `types` | `Array<"terms_of_service" \| "privacy_policy" \| "cookies">` | jeden z `types` lub `consent_type` | Bundle insert (jeden request → wiele wierszy w jednej transakcji); używane przy rejestracji (US-001) gdzie zgoda na TOS+PP+cookies jest atomowa |
| `consent_type` | `"terms_of_service" \| "privacy_policy" \| "cookies"` | jeden z `types` lub `consent_type` | Pojedynczy typ — używane przy wycofaniu zgody dla konkretnego typu |
| `version` | `string` | tak | Wersja dokumentu zgody (taka sama dla wszystkich elementów bundla) |
| `accepted` | `boolean` | tak | `false` = wycofanie zgody (zwykle z `consent_type`) |

> **Zasada:** dokładnie jedno z `types`/`consent_type` musi być obecne. `types` traktowane jako bundle insert (wszystkie typy w jednej transakcji); `consent_type` jako single-row insert. Endpoint nie pozwala na mieszanie obu pól.

**Odpowiedź (201) — bundle:**
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

> Bundle insert + aktualizacja `user_profiles.current_consent_version` realizowane atomowo w jednej transakcji DB przez funkcję `record_consent_bundle()` (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`). Zmiana `current_consent_version` z poziomu klienta jest zablokowana triggerem `block_protected_columns_update` — patrz §2.2 i `db-plan.md` §1.2 / §4.7.

**Odpowiedź (201) — per-type:**
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

**Kody błędów:**

| Kod | Opis |
|---|---|
| 400 | `{ "error": "invalid_consent_type" }` — wartość spoza `CHECK` (`terms_of_service` / `privacy_policy` / `cookies`) |
| 400 | `{ "error": "invalid_payload" }` — malformed JSON w request body (spójne z `/api/paddle/webhook`) |
| 400 | `{ "error": "missing_fields" }` — brakujące wymagane pola |
| 400 | `{ "error": "ambiguous_payload" }` — równocześnie `types` i `consent_type` lub żadne z nich |
| 400 | `{ "error": "invalid_bundle" }` — `types` zawiera wartości spoza `CHECK` lub duplikaty |
| 400 | `{ "error": "invalid_idempotency_key" }` — `Idempotency-Key` obecny ale nie jest poprawnym UUID v4 |
| 401 | `{ "error": "unauthorized" }` — brak sesji |
| 403 | `{ "error": "unauthorized_consent_target" }` — RPC `record_consent_bundle` rzuca gdy `p_user_id ≠ auth.uid()` (defense-in-depth na wypadek bug'a w handlerze; w obecnej implementacji nieosiągalne, bo handler ustawia `p_user_id = user.id`) |
| 409 | `{ "error": "idempotency_key_conflict" }` — ten sam `Idempotency-Key` użyty w ostatnich 60s ale z **innym payloadem** dla tego samego usera (typowy bug klienta — re-użycie klucza zamiast generowania nowego) |
| 500 | `{ "error": "internal_error" }` |

**Logika:**
1. Weryfikacja sesji przez `createServerClient` z `@supabase/ssr` (cookie-based JWT). Brak sesji → 401.
2. **Idempotency-Key (jeśli obecny):** waliduj jako UUID v4 → 400 jeśli nie. Klucz cache to `${user.id}:${idempotencyKey}` (klucz kolizyjny per user, by nie przeciekać między kontami). Lookup w cache:
   - Trafienie z **identycznym hashem payloadu** (SHA-256 z `JSON.stringify(body)`) → zwróć zapisaną odpowiedź (HTTP status + body), pomiń kroki 3-8.
   - Trafienie z **innym hashem payloadu** → 409 `idempotency_key_conflict`.
   - Brak trafienia → kontynuuj; po wykonaniu zapisz `{ status, body, payloadHash }` w cache z TTL 60s.
3. Walidacja payloadu (dokładnie jedno z `types`/`consent_type`; `types` bez duplikatów; każdy typ w `CHECK` z `consent_log.consent_type`).
4. Pobranie realnego IP z nagłówka `x-forwarded-for` (pierwszy adres) lub `x-real-ip`.
5. Anonimizacja przez `src/lib/ipAnonymize.ts`:
   - IPv4: wyzeruj ostatni oktet (`.0`) → `/24`
   - IPv6: wyzeruj ostatnie 80 bitów → `/48`
6. Pobranie `User-Agent` z nagłówka żądania.
7. **Bundle (`types: [...]`):** atomowo przez `supabase.rpc('record_consent_bundle', { p_user_id, p_version, p_accepted, p_ip, p_user_agent })` — funkcja `SECURITY DEFINER` (migracja `20260508000000_record_consent_bundle.sql`) w **jednej transakcji** wstawia 3 wiersze do `consent_log` i (gdy `p_accepted = true`) aktualizuje `user_profiles.current_consent_version`. Funkcja sama egzekwuje `auth.uid() = p_user_id` dla roli `authenticated` — handler nie potrzebuje service_role. Eliminuje okno niespójności między `consent_log` a `user_profiles` (audyt RODO art. 7 ust. 1).
8. **Per-type (`consent_type: ...`):** pojedynczy `INSERT` przez klienta z sesją. RLS `consent_log_insert_authenticated` egzekwuje `user_id = auth.uid()`. Per-type wycofanie zgody **nie modyfikuje** `current_consent_version` (kolumna nadal wskazuje na ostatnio zaakceptowany bundle — audyt rekonstruuje stan z `consent_log`).

> **Reguła service_role w tym handlerze:** **niepotrzebny** — bundle insert + update `current_consent_version` jest realizowany przez RPC `record_consent_bundle()` (`SECURITY DEFINER`), per-type insert idzie przez klienta z sesją + RLS. Bug w handlerze nie może wymusić zapisu consent dla cudzego `user_id` — funkcja sama waliduje `auth.uid() = p_user_id`.

---

#### `GET /api/user/export`

Eksport wszystkich danych użytkownika (RODO art. 20 — prawo do przenoszenia danych).

**Autoryzacja:** aktywna sesja Supabase

**Parametry zapytania:** brak

**Odpowiedź (200):**
```json
{
  "user_id": "uuid-...",
  "exported_at": "2026-05-08T12:00:00Z",
  "email": "user@example.com",
  "profile": {
    "plan": "pro",
    "locale": "pl",
    "current_consent_version": "1.0",
    "created_at": "2026-01-01T00:00:00Z"
  },
  "documents": [
    {
      "id": "uuid-...",
      "name": "Złącze T 1",
      "created_at": "2026-05-01T10:00:00Z",
      "updated_at": "2026-05-08T09:30:00Z",
      "data": {
        "schemaVersion": 1,
        "canvasWidth": 2970,
        "canvasHeight": 2100,
        "shapes": [],
        "weldUnits": []
      }
    }
  ],
  "consent_log": [
    {
      "consent_type": "terms_of_service",
      "version": "1.0",
      "accepted": true,
      "accepted_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

**Kody błędów:**

| Kod | Opis |
|---|---|
| 401 | `{ "error": "unauthorized" }` |
| 500 | `{ "error": "internal_error" }` |

**Nagłówki odpowiedzi:**
```
Content-Type: application/json
Content-Disposition: attachment; filename="welderdoc-export-2026-05-08.json"
```

**Charakterystyka wydajnościowa (m8):**
- Soft-target: **< 30 s** dla typowego użytkownika (Free → 1 projekt; Pro → ~5-50 projektów). Vercel Fluid Compute domyślnie ma timeout 300 s (`tech-stack.md` §12), więc rezerwa jest komfortowa.
- Hard limit infrastrukturalny: 300 s (Vercel Function timeout).
- **Power user (>100 projektów)** — ryzyko throttle / timeout przy bardzo dużych blob'ach `data` (do 5 MB każdy). Plan post-MVP do rozważenia: streaming response (NDJSON) lub asynchroniczne generowanie do Vercel Blob z linkiem download'em wysyłanym mailem (patrz §10 „Co poza zakresem").
- Rate limit: patrz §6 (TODO przed produkcją — np. 1 request/min/user, 5 requestów/dzień/user, by chronić DB przed nadużyciem).

---

#### `GET /api/health`

Sprawdzenie stanu serwisu (dla CI, monitoringu, Vercel deploy checks).

**Autoryzacja:** brak

**Odpowiedź (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-05-08T12:00:00Z"
}
```

**Odpowiedź (503) — problem z bazą:**
```json
{
  "status": "degraded",
  "timestamp": "2026-05-08T12:00:00Z",
  "checks": {
    "database": "unreachable"
  }
}
```

---

#### `GET /api/cron/expire-subscriptions`

Przelicza `user_profiles.plan` dla użytkowników z przeterminowanymi subskrypcjami. Wywoływany przez Vercel Cron codziennie o 03:00 UTC.

> **Metoda HTTP:** `GET` — Vercel Cron domyślnie wysyła `GET`, więc handler musi eksportować `export async function GET(...)`. Użycie `POST` skutkuje 405 Method Not Allowed i cichym niewykonaniem cronu.

**Autoryzacja:** nagłówek `Authorization: Bearer {CRON_SECRET}`

**`vercel.json` (wymagana konfiguracja):**
```json
{
  "crons": [
    {
      "path": "/api/cron/expire-subscriptions",
      "schedule": "0 3 * * *"
    }
  ]
}
```

**Ładunek żądania:** brak

**Odpowiedź (200):**
```json
{
  "updated": 5,
  "timestamp": "2026-05-08T03:00:00Z"
}
```

**Kody błędów:**

| Kod | Opis |
|---|---|
| 401 | `{ "error": "unauthorized" }` — brak/nieprawidłowy `CRON_SECRET` |
| 500 | `{ "error": "internal_error" }` |

**Logika:** wywołuje DB funkcję `SELECT public.refresh_expired_plans()` przez klienta `service_role`. Funkcja przelicza plan wszystkich użytkowników ze statusem `canceled` i `current_period_end < now()`, zwraca liczbę zaktualizowanych rekordów.

---

#### `GET /api/cron/cleanup-webhook-events`

Usuwa rekordy `webhook_events` starsze niż 90 dni. Wywoływany przez Vercel Cron raz w tygodniu.

> **Metoda HTTP:** `GET` — patrz uwaga przy `GET /api/cron/expire-subscriptions`.

**Autoryzacja:** nagłówek `Authorization: Bearer {CRON_SECRET}`

**`vercel.json` (wymagana konfiguracja):**
```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-webhook-events",
      "schedule": "0 2 * * 0"
    }
  ]
}
```

**Ładunek żądania:** brak

**Odpowiedź (200):**
```json
{
  "deleted": 150,
  "timestamp": "2026-05-08T02:00:00Z"
}
```

**Kody błędów:**

| Kod | Opis |
|---|---|
| 401 | `{ "error": "unauthorized" }` |

**Logika:**
```sql
DELETE FROM webhook_events
WHERE received_at < now() - INTERVAL '90 days'
```
Wykonywane przez klienta `service_role`.

---

#### `DELETE /api/user/account`

Trwale usuwa konto użytkownika (RODO art. 17 — „prawo do bycia zapomnianym"). Wymaga re-autoryzacji hasłem (operacja destrukcyjna, OWASP best practice).

**Autoryzacja:**
1. Aktywna sesja Supabase (`authenticated`) — weryfikowana przez `@supabase/ssr`.
2. **Re-auth:** ponowne podanie hasła w body żądania, weryfikowane przez `signInWithPassword()` na osobnym kliencie (nie nadpisujemy aktywnej sesji).

**Nagłówki żądania:**
```
Content-Type: application/json
```

**Ładunek żądania:**
```json
{
  "password": "AktualneHaslo123",
  "confirmation": "DELETE"
}
```

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `password` | `string` | tak | Aktualne hasło użytkownika — weryfikowane przez `signInWithPassword()` przed delete'm |
| `confirmation` | `"DELETE"` | tak | Literał `"DELETE"` jako extra safety guard (UI wymusza wpisanie tekstu) |

**Odpowiedź sukces (200):**
```json
{
  "deleted": true,
  "user_id": "uuid-...",
  "deleted_at": "2026-05-08T12:00:00Z"
}
```

> Po sukcesie handler usuwa cookies sesji (`Set-Cookie: sb-access-token=; Max-Age=0` itd. przez `supabase.auth.signOut()`), klient powinien zrobić `router.push('/[locale]/account-deleted')`.

**Kody błędów:**

| Kod | Opis |
|---|---|
| 400 | `{ "error": "missing_fields" }` — brak `password` lub `confirmation` |
| 400 | `{ "error": "invalid_confirmation" }` — `confirmation !== "DELETE"` |
| 400 | `{ "error": "invalid_payload" }` — malformed JSON |
| 401 | `{ "error": "unauthorized" }` — brak sesji |
| 401 | `{ "error": "invalid_password" }` — `signInWithPassword()` zwrócił `Invalid login credentials` |
| 429 | `{ "error": "rate_limited" }` — przekroczony limit (Supabase Auth `email_sent` lub własny per-IP, patrz §6) |
| 500 | `{ "error": "internal_error" }` |

**Logika przetwarzania:**
1. Weryfikacja sesji: `auth.getUser()` przez `createServerClient`. Brak sesji → 401.
2. Walidacja payloadu: `password` (string non-empty), `confirmation === "DELETE"`. Naruszenie → 400.
3. **Re-auth:** stwórz tymczasowy klient `createClient()` (z anon key, bez cookies tej sesji) i wywołaj `signInWithPassword({ email: user.email, password })`. Niepowodzenie → 401 `invalid_password`.
   > Używamy osobnej instancji klienta, żeby weryfikacja hasła nie wpłynęła na cookies aktywnej sesji (gdyby user anulował delete — sesja nadal działa).
4. **Hard delete:** `createAdminClient(SUPABASE_SERVICE_ROLE_KEY).auth.admin.deleteUser(user.id)`. Wyzwala kaskadę DB (`db-plan.md` §5.9):
   - `documents` → `ON DELETE CASCADE` (usunięte)
   - `consent_log` → `ON DELETE CASCADE` (usunięte)
   - `user_profiles` → `ON DELETE CASCADE` (usunięte; `auth.users.id` to FK)
   - `subscriptions.user_id` → `ON DELETE SET NULL` (zachowane dla audytu billingu Paddle, ale anonimizowane)
   - `webhook_events` → bez zmian (zachowuje payload Paddle do retencji 90 dni)
5. `supabase.auth.signOut()` na server clientie → wyczyszczenie cookies.
6. Zwróć 200 z timestamp'em.

**Bezpieczeństwo i compliance:**
- Re-auth chroni przed delete'm na porzuconej sesji (kawiarnia, cudzy laptop).
- `confirmation: "DELETE"` jest defensywną warstwą UX — UI powinien wymagać wpisania `DELETE` w polu tekstowym.
- Rate limit Supabase Auth `sign_in_sign_ups` ogranicza brute-force re-auth do 30/5 min/IP (patrz §6).
- Operacja jest **nieodwracalna** — żadnego soft-delete'u w MVP. Audit log w `webhook_events` (zachowuje `customer.*` i `subscription.*` z payloadem) jest jedyną pozostałą po użytkowniku informacją (anonimizowana po `user_id = NULL`).
- Klient powinien wyświetlić ostrzeżenie z konkretną listą usuwanych danych (projekty, ustawienia, historia zgód) przed otwarciem formularza.

> **Implementacja klienta (UX):** dwuetapowa modal — krok 1: ostrzeżenie + lista skasowanych zasobów; krok 2: `password` + `confirmation` ("Wpisz `DELETE` aby potwierdzić"). Po sukcesie: redirect do `/[locale]/account-deleted` (publiczna strona z linkiem do utworzenia nowego konta, bez sesji).

---

### 2.2 Operacje przez Supabase SDK

Operacje CRUD wykonywane bezpośrednio przez `@supabase/supabase-js` na kliencie lub w Server Components. Row Level Security zapewnia izolację danych. Używany klient: anon key + sesja użytkownika.

URL bazowy PostgREST: `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`

---

#### Uwierzytelnianie (Supabase Auth SDK)

**Rejestracja (US-001):**
```typescript
// Krok 1: Utwórz konto (trigger DB automatycznie tworzy user_profiles)
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'MinimalneHaslo123'
})

// Krok 2: Zapisz zgodę — pojedynczy bundle (TOS + PP + cookies) w jednej transakcji
// Handler anonimizuje IP, INSERT-uje 3 wiersze do consent_log i ustawia
// user_profiles.current_consent_version atomowo (przez SECURITY DEFINER po stronie serwera).
await fetch('/api/consent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    types: ['terms_of_service', 'privacy_policy', 'cookies'],
    version: '1.0',
    accepted: true
  })
})

// Krok 3: NIE aktualizuj current_consent_version z klienta. Kolumna jest chroniona
// triggerem block_protected_columns_update (db-plan §1.2) — bezpośredni UPDATE
// z roli `authenticated` jest cicho ignorowany. Wyłącznym writerem jest handler
// /api/consent przez RPC record_consent_bundle() (SECURITY DEFINER, wykonuje się
// jako rola `postgres` — bypass triggera przez gałąź current_user = 'postgres').
```

Odpowiedź sukces `signUp()`:
```json
{
  "user": {
    "id": "uuid-...",
    "email": "user@example.com",
    "email_confirmed_at": null
  },
  "session": null
}
```

> **Uwaga:** `session` jest `null` jeśli włączone jest potwierdzenie e-mail (domyślne w Supabase). Po kliknięciu linku weryfikacyjnego sesja jest tworzona.

**Ponowne wysłanie maila weryfikacyjnego (US-001 follow-up, m5):**
```typescript
// UI flow „Nie dostałem maila — wyślij ponownie" po rejestracji
const { error } = await supabase.auth.resend({
  type: 'signup',
  email: 'user@example.com'
})
```

> **Rate limit:** Supabase Auth ogranicza wysyłki do `email_sent = 4 / godzinę / IP` (konfiguracja w `supabase/config.toml`, patrz §6). Klient powinien pokazać countdown 60s na przycisku „Wyślij ponownie", a po przekroczeniu limitu wyświetlić komunikat „Spróbuj ponownie za godzinę".

**Logowanie (US-002):**
```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'MinimalneHaslo123'
})
```

Odpowiedź sukces: obiekt `{ user, session }`. Po zalogowaniu aplikacja wczytuje profil i sprawdza `welderdoc_autosave` w localStorage (migracja US-007).

> **Locale redirect po sign-in (`architecture-base.md` §17):** Server Component `[locale]/layout.tsx` (lub dedykowany `LocaleGuard`) musi po zalogowaniu wywołać:
> 1. `auth.getUser()` — pobierz aktualnego usera (pierwsze wywołanie odświeży JWT cookies).
> 2. `supabase.from('user_profiles').select('locale').eq('id', user.id).single()` — pobierz autorytatywne locale.
> 3. Porównaj `pathname` locale (z `params.locale`) z `user.locale`. Jeśli różne → `redirect('/' + user.locale + restOfPath)`.
>
> **Powód:** użytkownik mógł zarejestrować się na `/pl/...`, ustawić `locale = 'en'`, a potem zalogować na innym urządzeniu z URL'em `/pl/...`. Bez tego guarda wylądowałby w polskim UI mimo preferencji EN. Cookie `NEXT_LOCALE` częściowo to pokrywa (cross-tab), ale guard w layout zabezpiecza cross-device.

**Wylogowanie (US-003):**
```typescript
const { error } = await supabase.auth.signOut()
```

**Reset hasła — wysyłka linka (US-004):**
```typescript
const { error } = await supabase.auth.resetPasswordForEmail('user@example.com', {
  redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/[locale]/auth/callback?next=/reset-password`
})
```

**Reset hasła — ustawienie nowego (US-004):**
```typescript
// Wywołane po powrocie z linka resetującego (PKCE flow)
const { error } = await supabase.auth.updateUser({
  password: 'NoweHaslo456'
})
```

---

#### Dokumenty

**Lista dokumentów użytkownika (US-008, US-010):**

```
GET /rest/v1/documents
  ?select=id,name,created_at,updated_at
  &owner_id=eq.{uid}
  &order=updated_at.desc
  &limit=50
  &offset=0
```

```typescript
const { data, error, count } = await supabase
  .from('documents')
  .select('id, name, created_at, updated_at', { count: 'exact' })
  .eq('owner_id', userId)
  .order('updated_at', { ascending: false })
  .range(offset, offset + limit - 1)
```

Odpowiedź (200):
```json
[
  {
    "id": "uuid-...",
    "name": "Złącze T 1",
    "created_at": "2026-05-01T10:00:00Z",
    "updated_at": "2026-05-08T09:30:00Z"
  }
]
```

Nagłówek paginacji PostgREST: `Content-Range: 0-49/3` (offset-limit/total).

---

**Pobranie pełnych danych dokumentu (canvas):**

```
GET /rest/v1/documents
  ?id=eq.{id}
  &select=id,name,data,schema_version,created_at,updated_at
```

```typescript
const { data, error } = await supabase
  .from('documents')
  .select('id, name, data, schema_version, created_at, updated_at')
  .eq('id', documentId)
  .single()
```

Odpowiedź (200):
```json
{
  "id": "uuid-...",
  "name": "Złącze T 1",
  "data": {
    "schemaVersion": 1,
    "canvasWidth": 2970,
    "canvasHeight": 2100,
    "shapes": [],
    "weldUnits": []
  },
  "schema_version": 1,
  "created_at": "2026-05-01T10:00:00Z",
  "updated_at": "2026-05-08T09:30:00Z"
}
```

---

**Utworzenie dokumentu (US-008):**

```
POST /rest/v1/documents
Content-Type: application/json
Prefer: return=representation
```

```typescript
const { data, error } = await supabase
  .from('documents')
  .insert({
    owner_id: userId,
    name: 'Nowy projekt',
    data: {
      schemaVersion: 1,
      canvasWidth: 2970,
      canvasHeight: 2100,
      shapes: [],
      weldUnits: []
    }
  })
  .select()
  .single()
```

Odpowiedź (201): pełny rekord dokumentu.

Błąd przekroczenia limitu Free (500 z kodem DB P0001):
```json
{
  "code": "P0001",
  "message": "project_limit_exceeded",
  "details": null,
  "hint": null
}
```
Aplikacja wykrywa przez `error.message.includes('project_limit_exceeded')` i mapuje na klucz `next-intl`.

---

**Aktualizacja dokumentu (US-009 autozapis, US-013 rename):**

```
PATCH /rest/v1/documents?id=eq.{id}
Content-Type: application/json
Prefer: return=representation
```

```typescript
// Zmiana nazwy (US-013)
const { data, error } = await supabase
  .from('documents')
  .update({ name: 'Nowa nazwa' })
  .eq('id', documentId)
  .select()
  .single()

// Zapis sceny (US-009)
const { data, error } = await supabase
  .from('documents')
  .update({ data: canvasDocument })
  .eq('id', documentId)
  .select('id, name, updated_at')
  .single()
```

Odpowiedź (200): zaktualizowany rekord.

> **Zmiana rozmiaru canvasu (US-014, m1) — read-modify-write na blob `data`:** pola `canvasWidth` i `canvasHeight` żyją **wewnątrz** JSONB `data`, nie jako kolumny. PostgREST nie wspiera atomic JSONB-merge w jednym żądaniu — wymagana sekwencja read → modify → write:
> ```typescript
> // Krok 1: pobierz obecny blob
> const { data: doc } = await supabase
>   .from('documents')
>   .select('data')
>   .eq('id', documentId)
>   .single()
> if (!doc) throw new Error('not_found')
>
> // Krok 2: zmodyfikuj canvas dimensions w pamięci (zachowując shapes/weldUnits)
> const updated = { ...doc.data, canvasWidth: 4000, canvasHeight: 3000 }
>
> // Krok 3: PATCH całego blob'a
> await supabase
>   .from('documents')
>   .update({ data: updated })
>   .eq('id', documentId)
> ```
> Race condition: między krokiem 1 a 3 inna zakładka może nadpisać `data`. W MVP akceptowalne (single-user/single-tab dominujący), post-MVP rozważyć optimistic concurrency przez `updated_at` w klauzuli `eq`.

> **Sortowanie listy dokumentów (m3):** PostgREST query param `order` akceptuje dowolne pole z `select` — sortowanie po `name` (alfabetycznie) lub `created_at` (data utworzenia) jest możliwe bez zmian backend, np. `?order=name.asc` lub `?order=created_at.desc`. Domyślny widok listy projektów używa `updated_at.desc` (najświeższe edycje na górze).

> **Limit wielkości payloadu (m4):** db-plan §1.3 wymusza `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` — **5 MB raw**. Naruszenie zwraca PostgREST 400 z `code: '23514'` (check_violation). Klient powinien preflight'ować: `if (JSON.stringify(canvasDocument).length > 5 * 1024 * 1024) abort()`. Mapping kodu → komunikatu i18n: patrz §9 (Error Mapping).

---

**Usunięcie dokumentu (US-011):**

```
DELETE /rest/v1/documents?id=eq.{id}
```

```typescript
const { error } = await supabase
  .from('documents')
  .delete()
  .eq('id', documentId)
```

Odpowiedź (204): brak treści.

---

**Duplikowanie dokumentu — operacja dwuetapowa (US-012):**

```typescript
// Krok 1: odczytaj oryginał
const { data: original, error: readError } = await supabase
  .from('documents')
  .select('name, data')
  .eq('id', originalId)
  .single()

if (readError) throw readError

// Krok 2: utwórz kopię
const { data: copy, error: createError } = await supabase
  .from('documents')
  .insert({
    owner_id: userId,
    name: `${original.name} (kopia)`,
    data: original.data
  })
  .select()
  .single()

// Trigger check_free_project_limit automatycznie blokuje dla Free plan
// error.message === 'project_limit_exceeded' → toast z CTA do upgrade
```

---

#### Profil użytkownika

**Pobranie profilu (plan, locale, wersja zgody):**

```
GET /rest/v1/user_profiles
  ?id=eq.{uid}
  &select=id,plan,locale,current_consent_version,created_at,updated_at
```

```typescript
const { data: profile, error } = await supabase
  .from('user_profiles')
  .select('id, plan, locale, current_consent_version, created_at, updated_at')
  .eq('id', userId)
  .single()
```

Odpowiedź (200):
```json
{
  "id": "uuid-...",
  "plan": "free",
  "locale": "pl",
  "current_consent_version": "1.0",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-05-08T09:00:00Z"
}
```

**Kiedy używać cache vs RPC:**
- **Standardowo:** odczytuj `user_profiles.plan` (cache aktualizowany przez triggery DB) — wystarczy przy starcie sesji i nawigacji.
- **RPC `effective_plan()`:** wywołuj wyłącznie po powrocie ze strony płatności Paddle (gdy webhook mógł jeszcze nie dotrzeć) lub gdy podejrzewasz desynchronizację.

```typescript
// Standardowy odczyt planu (przy starcie sesji / zalogowaniu)
const { data: profile } = await supabase
  .from('user_profiles')
  .select('plan, locale, current_consent_version')
  .eq('id', userId)
  .single()

// RPC — tylko po powrocie z checkout Paddle
const { data: effectivePlan } = await supabase
  .rpc('effective_plan', { uid: userId })
// Zwraca: 'free' | 'pro'
```

---

**Aktualizacja ustawień użytkownika (US-050 locale, consent_version):**

```
PATCH /rest/v1/user_profiles?id=eq.{uid}
Content-Type: application/json
Prefer: return=representation
```

```typescript
const { data, error } = await supabase
  .from('user_profiles')
  .update({ locale: 'en' })
  .eq('id', userId)
  .select()
  .single()
```

Odpowiedź (200): zaktualizowany profil.

> **Uwaga:** Kolumny `plan`, `paddle_customer_id` oraz `current_consent_version` są chronione triggerem `block_protected_columns_update()`. Próba ich zmiany przez rolę `authenticated` jest cicho ignorowana — stare wartości zostają zachowane bez błędu, co umożliwia aktualizację `locale` w tym samym żądaniu. Wyłączny writer dla `current_consent_version` to handler `POST /api/consent` przez RPC `record_consent_bundle()` (`SECURITY DEFINER`, wykonuje się jako rola `postgres` — bypass triggera przez gałąź `current_user = 'postgres'`, migracja `20260509000000_paddle_webhook_hardening.sql`).

> **Wrapper `updateProfile()` w `lib/supabase/profile.ts` (M3) — zalecane:** klient nie powinien polegać na cichej blokadzie triggera DB. Stwórz cienki wrapper, który filtruje protected fields **przed** wysyłką PATCH-a i loguje warning w `process.env.NODE_ENV === 'development'`. Trigger DB pozostaje jako defense-in-depth na wypadek omyłkowego użycia surowego klienta.
>
> ```typescript
> // src/lib/supabase/profile.ts
> import type { Database } from '@/types/database.types'
> import { createClient } from './client'
>
> const PROTECTED_FIELDS = ['plan', 'paddle_customer_id', 'current_consent_version'] as const
> type UserProfileUpdate = Database['public']['Tables']['user_profiles']['Update']
> type SafeUpdate = Omit<UserProfileUpdate, typeof PROTECTED_FIELDS[number]>
>
> export async function updateProfile(userId: string, patch: SafeUpdate) {
>   if (process.env.NODE_ENV === 'development') {
>     const leak = Object.keys(patch).filter((k) => (PROTECTED_FIELDS as readonly string[]).includes(k))
>     if (leak.length > 0) {
>       console.warn(`[updateProfile] Protected fields silently dropped: ${leak.join(', ')}`)
>     }
>   }
>   const safe: Record<string, unknown> = {}
>   for (const [k, v] of Object.entries(patch)) {
>     if (!(PROTECTED_FIELDS as readonly string[]).includes(k)) safe[k] = v
>   }
>   return createClient()
>     .from('user_profiles')
>     .update(safe)
>     .eq('id', userId)
>     .select()
>     .single()
> }
> ```
>
> **Zasada:** komponenty nigdy nie używają `supabase.from('user_profiles').update(...)` bezpośrednio — zawsze przez `updateProfile()`. Wymuszone code-review (lint rule do dodania post-MVP). TypeScript `SafeUpdate` egzekwuje to statycznie — próba `updateProfile(uid, { plan: 'pro' })` jest błędem kompilacji.

> **Po `PATCH locale` — synchronizacja stanu klienta (m2):** `user_profiles.locale` jest **autorytatywnym źródłem** preferencji językowej, ale `next-intl` rozstrzyga locale przez kombinację URL prefix + cookie `NEXT_LOCALE`. Po pomyślnym PATCH-u klient musi:
> 1. Ustawić cookie: `document.cookie = 'NEXT_LOCALE=' + newLocale + '; path=/; max-age=31536000; samesite=lax'` (1 rok TTL).
> 2. (Opcjonalnie) `localStorage.setItem('welderdoc_locale_preference', newLocale)` — używane przed sign-in jako fallback (`architecture-base.md` §17).
> 3. Wykonać `router.replace('/' + newLocale + pathname.replace(/^\/(pl|en)/, ''))` lub `window.location.href = ...` aby przeładować stronę z nowym locale w URL.
>
> **Konsekwencja pominięcia cookie:** layout root sprawdza `pathname locale ≠ user.locale` i zrobi redirect — działa, ale dodaje round-trip. Cookie eliminuje redirect na pierwszym requeście po zmianie języka.

---

#### Subskrypcje

**Pobranie historii subskrypcji (US-044):**

```
GET /rest/v1/subscriptions
  ?user_id=eq.{uid}
  &select=id,status,plan_tier,current_period_start,current_period_end,cancel_at,created_at
  &order=created_at.desc
```

```typescript
const { data: subscriptions, error } = await supabase
  .from('subscriptions')
  .select('id, status, plan_tier, current_period_start, current_period_end, cancel_at, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
```

Odpowiedź (200):
```json
[
  {
    "id": "uuid-...",
    "status": "active",
    "plan_tier": "pro_monthly",
    "current_period_start": "2026-05-01T00:00:00Z",
    "current_period_end": "2026-06-01T00:00:00Z",
    "cancel_at": null,
    "created_at": "2026-05-01T00:00:00Z"
  }
]
```

> Wyłącznie odczyt. Mutacje wyłącznie przez `POST /api/paddle/webhook` z `service_role`.

---

#### Dziennik zgód

**Pobranie historii zgód:**

```
GET /rest/v1/consent_log
  ?user_id=eq.{uid}
  &select=consent_type,version,accepted,accepted_at
  &order=accepted_at.desc
```

```typescript
const { data: consentLog, error } = await supabase
  .from('consent_log')
  .select('consent_type, version, accepted, accepted_at')
  .eq('user_id', userId)
  .order('accepted_at', { ascending: false })
```

Odpowiedź (200):
```json
[
  {
    "consent_type": "terms_of_service",
    "version": "1.0",
    "accepted": true,
    "accepted_at": "2026-01-01T00:00:00Z"
  },
  {
    "consent_type": "cookies",
    "version": "1.0",
    "accepted": false,
    "accepted_at": "2026-03-01T00:00:00Z"
  }
]
```

> INSERT wyłącznie przez `POST /api/consent` (Route Handler z anonimizacją IP). Tabela jest append-only — brak UPDATE/DELETE.

---

#### Checkout Paddle (US-045) — inicjalizacja po stronie klienta

Upgrade do Pro nie wymaga Route Handlera — realizowany przez `@paddle/paddle-js` SDK inline:

```typescript
import { initializePaddle } from '@paddle/paddle-js'

const paddle = await initializePaddle({
  environment: process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production',
  token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!
})

// Otwarcie checkout
await paddle?.Checkout.open({
  items: [{ priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY! }],
  customer: { email: userEmail },
  customData: { user_id: userId }  // przekazywane do webhooka
})
```

Po pomyślnej płatności Paddle wysyła webhook do `POST /api/paddle/webhook`, który aktualizuje subskrypcję i plan.

---

#### Customer Portal Paddle (anulowanie / zmiana planu) — inline po stronie klienta

Self-service zarządzanie subskrypcją (anulowanie, zmiana metody płatności, faktury) realizowane przez Paddle Customer Portal SDK — bez własnego Route Handlera.

```typescript
import { initializePaddle } from '@paddle/paddle-js'

const paddle = await initializePaddle({
  environment: process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production',
  token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!
})

// US-044 follow-up: przycisk „Zarządzaj subskrypcją" na stronie ustawień
// dostępny tylko gdy subscriptions[0].status IN ('active','trialing','past_due')
await paddle?.CustomerPortal.open({
  customerId: paddleCustomerId  // pobrane z user_profiles.paddle_customer_id
})
```

> **Wymagania:** `user_profiles.paddle_customer_id` musi być wypełnione — synchronizowane przez trigger `subscriptions_after_iu_sync_customer` po pierwszym webhook'u `subscription.created/customer.created` (patrz §2.1 sekcja `POST /api/paddle/webhook`). Jeśli `paddle_customer_id IS NULL` (orphan / pre-webhook), przycisk „Zarządzaj subskrypcją" musi być ukryty lub wyświetlać komunikat „Synchronizujemy płatność, spróbuj za chwilę".
>
> **Anulowanie:** odbywa się w UI Paddle (Customer Portal), nie wymaga własnego endpointu. Po kliknięciu „Cancel" Paddle wysyła `subscription.canceled` webhook do `POST /api/paddle/webhook`, który ustawia `subscriptions.status = 'canceled'` i `cancel_at`. Trigger `subscriptions_after_iu_refresh_plan` oraz `GET /api/cron/expire-subscriptions` (daily 03:00 UTC) zarządzają downgrade'm `user_profiles.plan = 'free'` po `current_period_end`.
>
> **Alternatywne ścieżki rozważone i odrzucone:** (1) własny Route Handler `GET /api/paddle/customer-portal` zwracający URL przez Paddle API — wymaga dodatkowego sekretu serwerowego (`PADDLE_API_KEY`) i opóźnia otwarcie portalu o jeden round-trip; (2) email do support — narusza self-service expectation typowe dla SaaS i nie skaluje się przy >100 użytkownikach.

---

## 3. Uwierzytelnianie i autoryzacja

### Mechanizm uwierzytelniania

| Mechanizm | Zastosowanie |
|---|---|
| **Supabase Auth JWT** | Wszystkie operacje na danych użytkownika |
| **`PADDLE_WEBHOOK_SECRET`** | Weryfikacja podpisów webhooków Paddle |
| **`CRON_SECRET`** | Zabezpieczenie endpointów `/api/cron/*` |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Webhook handler (`/api/paddle/webhook`), crony (`/api/cron/*`) — tylko server-side. `/api/consent` **NIE** używa tego klucza: handler operuje na sesji JWT (`createClient` z `@supabase/ssr`), a RPC `record_consent_bundle()` (`SECURITY DEFINER`) wykonuje się jako rola `postgres`, niezależnie od wywołującego — patrz §2.1 ostatni akapit oraz `db-plan.md` §1.2 (bypass `current_user = 'postgres'` w `block_protected_columns_update`). |

**Zarządzanie sesją:**
- `src/proxy.ts` — middleware chain: `updateSession()` → `next-intl` routing
- Kolejność jest obowiązkowa: Supabase musi odświeżyć token **przed** routingiem locale
- Ciasteczka: httpOnly, zarządzane przez `@supabase/ssr`
- Access token TTL: 1 godzina; refresh token TTL: 1 miesiąc

**Weryfikacja sesji w Route Handlerach:**
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // ...
}
```

> **Krytyczne — `auth.getUser()` jest jedynym mechanizmem refresh'a tokenu w Route Handlerach.** Matcher proxy w `src/proxy.ts` wyklucza `/api/*` (`architecture-base.md` §16), więc middleware **nie** odświeża cookies przed wejściem do handlera. Pominięcie `auth.getUser()` na początku każdego authenticated handlera oznacza:
> - operowanie na cookie z poprzedniego requesta — możliwa ekspiracja po godzinie (TTL access tokenu) i niespodziewany 401 dla legalnego usera mimo aktywnej sesji w przeglądarce.
> - brak walidacji JWT przeciw Supabase Auth — `getSession()` (alternatywa) **nie weryfikuje** podpisu tokenu, co dla operacji destrukcyjnych (delete, payment) jest niewystarczające.
> 
> **Zasada:** każdy handler w `src/app/api/` wymagający sesji wywołuje `auth.getUser()` jako pierwsze działanie po stworzeniu klienta. Brak tego wywołania = bug bezpieczeństwa.

**Re-autoryzacja dla operacji destrukcyjnych:**

`DELETE /api/user/account` (RODO art. 17, §2.1) wymaga ponownego podania hasła (re-auth) — sesja JWT jest niewystarczająca. Wzorzec:

```typescript
// Tymczasowy klient (osobna instancja, by nie nadpisać cookies aktywnej sesji)
import { createClient } from '@supabase/supabase-js'

const tempClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const { error } = await tempClient.auth.signInWithPassword({
  email: user.email!,
  password: payload.password
})
if (error) return Response.json({ error: 'invalid_password' }, { status: 401 })
// → przejdź do hard delete przez admin client
```

Powód: `signInWithPassword()` na server clientie (z cookies) **nadpisałby** aktywną sesję — gdyby user anulował delete później, byłby wylogowany. Tymczasowy klient bez cookies izoluje weryfikację.

**Klient service_role (tylko server-side, z sekretem):**
```typescript
import { createClient } from '@supabase/supabase-js'
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

### Poziomy dostępu

| Poziom | Endpointy | Implementacja |
|---|---|---|
| **Publiczny** | `GET /api/health` | Brak weryfikacji |
| **Authenticated** | Operacje SDK, `POST /api/consent`, `GET /api/user/export` | Supabase Auth JWT + RLS |
| **Authenticated + re-auth** | `DELETE /api/user/account` | Supabase Auth JWT + ponowna weryfikacja hasła przez tymczasowy `signInWithPassword()` |
| **Email potwierdzony** | Operacje na `documents` | RLS: `email_confirmed_at IS NOT NULL` |
| **Service Role** | `POST /api/paddle/webhook`, `GET /api/cron/*`, krok 2 `DELETE /api/user/account` (admin.deleteUser) | `SUPABASE_SERVICE_ROLE_KEY` (omija RLS) |
| **Cron Secret** | `GET /api/cron/*` | `Authorization: Bearer {CRON_SECRET}` |

### Row Level Security

| Tabela | Operacje | Warunek |
|---|---|---|
| `documents` | ALL | `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` |
| `user_profiles` | SELECT, UPDATE | `id = auth.uid()` |
| `subscriptions` | SELECT | `user_id = auth.uid()` |
| `consent_log` | SELECT, INSERT | `user_id = auth.uid()` |
| `webhook_events` | brak polityk | tylko `service_role` |

> **TODO defense-in-depth (audit follow-up, opcjonalne):** rozważyć dodanie `AND email_confirmed_at IS NOT NULL` do polityki `consent_log_insert_authenticated` — chroni przed flood'em consent_log przez konta utworzone przez magic link bez potwierdzenia emaila. Wymaga migracji DB (`db-plan.md` §4.5). Niska priorytet — flow rejestracji w MVP wymusza email confirmation przed jakąkolwiek interakcją z `/api/consent` (consent jest częścią rejestracji, nie post-confirmation).

---

## 4. Walidacja i logika biznesowa

### Dokumenty — walidacja wejścia

| Pole | Reguła | Źródło |
|---|---|---|
| `name` | niepuste po trim, max 100 znaków | `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` |
| `data` | musi być obiektem JSONB | `CHECK (jsonb_typeof(data) = 'object')` |
| `data` | musi zawierać klucze `schemaVersion`, `shapes`, `weldUnits` | `CHECK (data ? 'schemaVersion' AND ...)` |
| `data.shapes` | musi być tablicą | `CHECK (jsonb_typeof(data->'shapes') = 'array')` |
| `data.weldUnits` | musi być tablicą | `CHECK (jsonb_typeof(data->'weldUnits') = 'array')` |
| `data` | max 5 MB raw | `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` — przy naruszeniu PostgREST zwraca 400 z `code: '23514'` (mapping w §9 Error Mapping) |

> **Klient powinien preflight'ować:**
> - `name`: `name.trim().length` ∈ [1, 100] przed POST/PATCH (zwięzły komunikat „Nazwa nie może być pusta" / „Maks. 100 znaków" zamiast generic check_violation z DB).
> - `data`: `JSON.stringify(canvasDocument).length` < 5 \* 1024 \* 1024 (typowo niemożliwe do osiągnięcia w UX — projekt z setkami shapes), ale guard chroni przed nieskończoną pętlą sequence-mode.

Triggerowana automatycznie walidacja:
- `sync_schema_version_from_data` — synchronizuje `schema_version` z `data->>'schemaVersion'` (BEFORE INSERT OR UPDATE)
- `check_free_project_limit` — rzuca `project_limit_exceeded` przy próbie przekroczenia limitu 1 projektu dla planu `free` (BEFORE INSERT OR UPDATE OF owner_id)

### Profil użytkownika — walidacja

| Pole | Reguła |
|---|---|
| `locale` | `CHECK (locale IN ('pl', 'en'))` |
| `plan` | `CHECK (plan IN ('free', 'pro'))`, read-only dla `authenticated` (trigger `block_protected_columns_update`) |
| `paddle_customer_id` | UNIQUE, read-only dla `authenticated` (trigger `block_protected_columns_update`) |
| `current_consent_version` | read-only dla `authenticated` — wyłącznym writerem jest `POST /api/consent` przez RPC `record_consent_bundle()` |

### Hasło — walidacja (Supabase Auth / GoTrue)

PRD US-001 wymaga „min. 8 znaków". Walidacja egzekwowana **server-side przez GoTrue** (Supabase Auth), konfiguracja w `supabase/config.toml`:

```toml
[auth.password]
min_length = 8
# Opcjonalnie (post-MVP, jeśli wymagana wyższa siła):
# required_characters = "lower_upper_letters_digits"  # lub "lower_upper_letters_digits_symbols"
```

> **Klient powinien preflight'ować** długość ≥ 8 i wyświetlać miernik siły hasła (UX), ale autorytatywna walidacja jest po stronie GoTrue. Próba `signUp` z hasłem < 8 znaków zwraca `AuthApiError: Password should be at least 6 characters` (lub skonfigurowanego minimum) — błąd musi być zmapowany w UI na komunikat i18n.

### Zgody — walidacja i wymagania RODO

| Pole | Reguła |
|---|---|
| `consent_type` | `CHECK (consent_type IN ('terms_of_service', 'privacy_policy', 'cookies'))` |
| `version` | NOT NULL — **TODO format**: db-plan §5.14 punkt 5 odkłada decyzję między semver (`"1.0"`), datą (`"2026-05-08"`) a hashem treści (`"sha256:..."`). Do podjęcia z legal/compliance przed produkcją. Plan API obecnie przyjmuje arbitralny string — po decyzji dodać walidację (regex lub enum). |
| `accepted` | NOT NULL |
| `ip_address` | Anonimizacja **przed** INSERT: IPv4 → `/24`, IPv6 → `/48` (RODO motyw 30) |
| append-only | Brak polityk UPDATE/DELETE — każde wycofanie zgody = nowy wiersz `accepted = FALSE` |
| idempotency | Klient powinien wysyłać `Idempotency-Key` header (uuid v4) — patrz §7. Zapobiega duplikatom przy retry/double-click. |

### Subskrypcje — walidacja webhooków

| Pole | Reguła |
|---|---|
| `status` | `CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled'))` |
| `plan_tier` | `CHECK (plan_tier IN ('pro_monthly', 'pro_annual'))` |
| `paddle_subscription_id` | UNIQUE — uniemożliwia duplikaty przy `ON CONFLICT DO NOTHING` |

### Efektywny plan użytkownika

Denormalizacja: `user_profiles.plan` jest cache'em obliczanym przez DB, nigdy bezpośrednio przez API.

```sql
-- Logika: effective_plan(uid)
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = uid
      AND (
        s.status IN ('trialing', 'active', 'past_due')
        OR (s.status = 'canceled' AND s.current_period_end > now())
      )
  ) THEN 'pro'
  ELSE 'free'
END;
```

Kanały aktualizacji planu:
1. **Real-time** — trigger `subscriptions_after_iu_refresh_plan` po każdym INSERT/UPDATE
2. **Time-based** — `GET /api/cron/expire-subscriptions` daily 03:00 UTC

### Limit elementów na scenie (plan enforcement)

Limit 3 elementów dla Guest/Free egzekwowany wyłącznie client-side w `ShapesSlice.addShape()`. Nie ma triggera DB (elementy sceny to stan wewnątrz JSONB, nie osobne wiersze).

### Idempotencja webhooków Paddle

```sql
INSERT INTO webhook_events (provider, external_event_id, event_type, payload)
VALUES ('paddle', $event_id, $event_type, $payload)
ON CONFLICT (provider, external_event_id) DO NOTHING
RETURNING id;
-- pusty RETURNING → duplikat → HTTP 200 bez efektu biznesowego
```

### Migracja gościa do chmury (US-007)

Sekwencja kliencka po zalogowaniu gdy `welderdoc_autosave` istnieje w localStorage:

```typescript
1. Pobierz scenę z localStorage
2. POST /rest/v1/documents (INSERT) ze sceną
3. Sukces:
   - Zapisz localStorage.setItem('welderdoc_migrated_at', now()) PRZED czyszczeniem
   - Usuń localStorage.removeItem('welderdoc_autosave')
   - Toast: "Projekt zapisany w chmurze"
4. Błąd 'project_limit_exceeded':
   - Toast: "[i18n] project_limit_during_migration" z CTA do upgrade
   - Zachowaj localStorage (nie czyść) — użytkownik może kupić Pro i ponowić
5. Inny błąd:
   - Toast z możliwością ponowienia
   - Zachowaj localStorage
```

Trigger `check_free_project_limit` zabezpiecza przed race condition (dwie zakładki).

### Weryfikacja CRON_SECRET

```typescript
// src/app/api/cron/[name]/route.ts
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  // ...
}
```

Vercel Cron automatycznie przekazuje ten nagłówek gdy `CRON_SECRET` jest ustawiony w zmiennych środowiskowych projektu.

---

## 5. Zmienne środowiskowe

Pełna lista zmiennych wraz z opisem i scopem w `tech-stack.md` §13. Zmienne wymagane przez endpointy z tego dokumentu: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY`, `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `SUPABASE_PROJECT_ID`.

---

## 6. Rate Limiting

> **Status MVP:** częściowo zaimplementowane (Supabase Auth) + udokumentowane TODO przed produkcją (`/api/consent`, `/api/user/export`, `/api/user/account`). Realne wektory nadużyć i strategia obrony — patrz audyt `.ai/api-plan-audit.md` §5 M1.

### 6.1 Supabase Auth — wbudowane limity

Konfiguracja w `supabase/config.toml` (rate limity per IP, egzekwowane przez GoTrue):

```toml
[auth.rate_limit]
# Maile (sign-up confirmation, reset password, magic link, email change)
email_sent = 4              # 4 maile / godzinę / IP

# Logowania, rejestracje, reset password attempts
sign_in_sign_ups = 30       # 30 prób / 5 min / IP

# Token refresh (krytyczne dla aktywnych sesji)
token_refresh = 150         # 150 / 5 min / IP

# Anonymous sign-ins (jeśli włączone — w MVP wyłączone)
# anonymous_users = 30      # 30 / godzinę / IP
```

> **Skuteczność:** chroni przed brute-force loginu, mass sign-up, mail-flood na linku resetującym, enumeracją emaili. Brakująca warstwa — limity per zalogowany user (Supabase nie patrzy na JWT, tylko na IP).

### 6.2 Custom Route Handlers — TODO przed produkcją

Limity zalogowanych userów wymagają zewnętrznego stanu (Vercel KV / Upstash Redis) — **nie implementowane w MVP**, ale każdy handler ma wskazany target:

| Endpoint | Proponowany limit | Powód |
|---|---|---|
| `POST /api/consent` | 5 / min / user, 50 / dzień / user | Append-only tabela; flood = unbounded growth (cron tego nie czyści, audit log) |
| `GET /api/user/export` | 1 / min / user, 5 / dzień / user | Kosztowne (read całego `documents.data` + `consent_log`); ryzyko obciążenia DB |
| `DELETE /api/user/account` | 3 / godzinę / IP, 1 / dobę / user | Operacja destrukcyjna; chroni przed mass-account-deletion oraz brute-force re-auth (w połączeniu z `sign_in_sign_ups` z §6.1) |
| `POST /api/paddle/webhook` | brak (zewnętrzny webhook) | Paddle ma własny rate limit; HMAC chroni przed forge'm; idempotency chroni przed retry |
| `GET /api/cron/*` | brak (CRON_SECRET) | Tylko Vercel Cron może wywołać |
| `GET /api/health` | 60 / min / IP (DDoS guard) | Publiczny endpoint, ryzyko abuse jako keep-alive ping |

> **Wzorzec implementacji (TODO):** Vercel Marketplace → Upstash Redis → `@upstash/ratelimit` (sliding window). Przykład:
> ```typescript
> import { Ratelimit } from '@upstash/ratelimit'
> import { Redis } from '@upstash/redis'
>
> const ratelimit = new Ratelimit({
>   redis: Redis.fromEnv(),
>   limiter: Ratelimit.slidingWindow(5, '1 m'),
>   prefix: 'api:consent'
> })
>
> const { success } = await ratelimit.limit(`user:${user.id}`)
> if (!success) return Response.json({ error: 'rate_limited' }, { status: 429 })
> ```
> Wymaga zmiennych: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — auto-provisioned przy instalacji integracji Upstash w Vercel.

### 6.3 Bot/abuse defense — alternatywy

| Opcja | Pokrycie | Decyzja MVP |
|---|---|---|
| **Vercel BotID** | Anty-bot na sign-up / reset password forms | TODO — rozważyć przed publicznym launchem (lekkie, brak dodatkowego sekretu) |
| **Cloudflare Turnstile / hCaptcha** | Captcha na sign-up | Out-of-scope MVP — Supabase Auth `email_sent` limit wystarczy do private beta |
| **Vercel WAF rules** | Generic DDoS / IP block | Wbudowane w Vercel Pro plan, włączane bez kodu |

---

## 7. Idempotencja

Plan stosuje **dwa różne wzorce** idempotencji w zależności od kierunku komunikacji:

### 7.1 Webhook Paddle — DB UNIQUE constraint

`POST /api/paddle/webhook` (§2.1) używa kolumny `webhook_events.external_event_id` z constraintem `UNIQUE (provider, external_event_id)`:

```sql
INSERT INTO webhook_events (provider, external_event_id, event_type, payload)
VALUES ('paddle', $event_id, $event_type, $payload)
ON CONFLICT (provider, external_event_id) DO NOTHING
RETURNING id;
-- pusty RETURNING → duplikat → HTTP 200 bez efektu biznesowego
```

> **Powód wyboru:** Paddle gwarantuje unikalność `event_id` per webhook. UNIQUE w DB jest atomowy, transakcyjny, nie wymaga zewnętrznego cache'u, działa nawet po restarcie / cold start. Idealne dla webhooków (retry'e Paddle przy 5xx).

### 7.2 Klient → Route Handler — Idempotency-Key header

`POST /api/consent` (§2.1) i potencjalnie inne mutacyjne endpointy używają nagłówka `Idempotency-Key`:

```
POST /api/consent
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

**Algorytm po stronie serwera:**

1. Walidacja klucza: format UUID v4. Brak nagłówka = brak idempotency (dozwolone, ale nie zalecane).
2. Klucz cache: `${user.id}:${idempotencyKey}`.
3. Hash payloadu: `crypto.subtle.digest('SHA-256', body)` (bez nagłówków).
4. Lookup w cache (TTL 60s):
   - **Trafienie z identycznym hashem** → zwróć zapisaną odpowiedź (status + body) bez wykonywania logiki biznesowej.
   - **Trafienie z innym hashem** → 409 `idempotency_key_conflict` (klient bug: re-użycie klucza).
   - **Brak trafienia** → wykonaj normalnie, zapisz `{ status, body, payloadHash }` w cache.

**Storage cache:**

| Faza | Storage | Uwagi |
|---|---|---|
| MVP single-instance | In-memory `Map` per Fluid Compute instance | Działa dla większości przypadków (Vercel Fluid Compute reuse'uje instancje), ale klucz może być nieobecny w innej instancji → klient powtórzy logikę. Akceptowalne dla MVP — duplikaty 409 są błędem klienta, nie utrata idempotency. |
| Production | Vercel KV / Upstash Redis | Wymaga `UPSTASH_REDIS_REST_URL` lub `KV_REST_API_URL` (auto-provisioned). Cross-instance, persistent. |

**Klient (UX):**

```typescript
// Generuj klucz raz przy otwarciu formularza (lub na pierwszej próbie zapisu).
// NIE generuj nowego klucza na retry — to neguje idempotency.
const idempotencyKey = crypto.randomUUID()

await fetch('/api/consent', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey
  },
  body: JSON.stringify({ types: [...], version: '1.0', accepted: true })
})
// Retry przy timeoutu/5xx → ten sam klucz → serwer zwróci pierwotną odpowiedź
// Nowy submit (np. wycofanie zgody później) → nowy klucz → nowy wpis w consent_log
```

### 7.3 PostgREST CRUD — ufamy unikalności klucza biznesowego

Operacje SDK (`POST /rest/v1/documents`, `PATCH /rest/v1/documents`) **nie wymagają** osobnej idempotency — UI guard (`disabled` button podczas pending request) wystarczy w MVP. Ryzyko duplikatów jest niskie (UPSERT w PATCH; INSERT z autosave debouncuje).

---

## 8. Wersjonowanie API

### 8.1 Strategia MVP

Endpointy MVP są **bez prefiksu wersji** — `/api/consent`, `/api/paddle/webhook`, `/api/user/export` itd. Powód: dla aplikacji typu „pierwszy użytkownik = pierwszy klient" prefix `/v1` to over-engineering, generuje koszt (zmiana ścieżek route handlers, vercel.json `crons[]`, Paddle webhook URL w Dashboard) bez korzyści.

### 8.2 Strategia breaking change

Pierwsza zmiana niekompatybilna wstecz wprowadza **drugą wersję pod prefiksem**:

```
src/app/api/consent/route.ts        → v1 (zachowany w trybie maintenance)
src/app/api/v2/consent/route.ts     → v2 (nowy schemat)
```

Migracja klientów: deprecation notice (3 miesiące) → klient frontend aktualizowany do v2 → v1 zostawiony do wygaśnięcia sesji najstarszych userów (typowo ~1 miesiąc) → usunięcie v1.

### 8.3 Specjalny przypadek — webhook Paddle

`POST /api/paddle/webhook` jest **najmniej elastyczny** — Paddle pamięta URL w Dashboard. Zmiana ścieżki wymaga koordynacji:

1. Stwórz `/api/v2/paddle/webhook` (nowy schemat).
2. W Paddle Dashboard zaktualizuj URL na nowy + uruchom „resend last 7 days events" do nowego endpointu.
3. Stary endpoint zostaw przez 1 tydzień (Paddle retry'e 5xx do 1h, ale lepiej pewnie).
4. Po potwierdzeniu zerowych requestów na v1 → usuń.

**Backward-compatible changes** (dodanie pola, dodanie typu zdarzenia, rozszerzenie enuma) — nie wymagają v2.
**Breaking changes** (usunięcie pola, zmiana nazwy/typu, zmiana semantyki) — wymagają v2.

### 8.4 Mapowanie Supabase SDK

Operacje przez `@supabase/supabase-js` używają wersjonowania PostgREST i Auth managed przez Supabase — nie wymagamy własnego prefiksu. Breaking change w Supabase API (rzadkie) jest komunikowany przez Supabase, migrację wykonujemy na poziomie zależności (`supabase-js` major version bump).

---

## 9. Error Mapping

> **Cel:** zastąpić kruchy wzorzec `error.message.includes('project_limit_exceeded')` deterministycznym mapowaniem `error.code` + nazwa funkcji DB → enum BusinessError. Plik docelowy: `src/lib/supabase/errors.ts`.

### 9.1 Architektura

```typescript
// src/lib/supabase/errors.ts (szkic — implementacja w fazie kodowania)

import type { PostgrestError, AuthError } from '@supabase/supabase-js'

export enum BusinessError {
  // Documents
  PROJECT_LIMIT_EXCEEDED = 'project_limit_exceeded',
  DOCUMENT_PAYLOAD_TOO_LARGE = 'document_payload_too_large',
  DOCUMENT_NAME_INVALID = 'document_name_invalid',
  DOCUMENT_DATA_SHAPE_INVALID = 'document_data_shape_invalid',

  // Consent
  CONSENT_TYPE_INVALID = 'consent_type_invalid',
  CONSENT_VERSION_MISSING = 'consent_version_missing',
  CONSENT_TARGET_UNAUTHORIZED = 'consent_target_unauthorized',

  // Profile
  PROFILE_LOCALE_INVALID = 'profile_locale_invalid',

  // Auth
  INVALID_CREDENTIALS = 'invalid_credentials',
  EMAIL_NOT_CONFIRMED = 'email_not_confirmed',
  EMAIL_ALREADY_REGISTERED = 'email_already_registered',
  PASSWORD_TOO_WEAK = 'password_too_weak',

  // Generic
  UNAUTHORIZED = 'unauthorized',
  RATE_LIMITED = 'rate_limited',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown'
}

export interface MappedError {
  business: BusinessError
  message: string                   // i18n key
  rawCode?: string
  rawMessage?: string
}

export function mapPostgrestError(err: PostgrestError | null): MappedError | null {
  if (!err) return null

  // P0001 = RAISE EXCEPTION z funkcji/triggera DB
  if (err.code === 'P0001') {
    if (err.message.includes('project_limit_exceeded')) {
      return { business: BusinessError.PROJECT_LIMIT_EXCEEDED, message: 'errors.project_limit_exceeded', rawCode: err.code, rawMessage: err.message }
    }
    if (err.message.includes('unauthorized_consent_target')) {
      return { business: BusinessError.CONSENT_TARGET_UNAUTHORIZED, message: 'errors.consent_target_unauthorized', rawCode: err.code, rawMessage: err.message }
    }
  }

  // 23514 = check_violation (CHECK constraint)
  if (err.code === '23514') {
    if (err.message.includes('octet_length')) {
      return { business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE, message: 'errors.document_payload_too_large', rawCode: err.code }
    }
    if (err.message.includes('length(trim(name))') || err.message.includes('length(name)')) {
      return { business: BusinessError.DOCUMENT_NAME_INVALID, message: 'errors.document_name_invalid', rawCode: err.code }
    }
    if (err.message.includes('jsonb_typeof')) {
      return { business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID, message: 'errors.document_data_shape_invalid', rawCode: err.code }
    }
    if (err.message.includes('locale')) {
      return { business: BusinessError.PROFILE_LOCALE_INVALID, message: 'errors.profile_locale_invalid', rawCode: err.code }
    }
    if (err.message.includes('consent_type')) {
      return { business: BusinessError.CONSENT_TYPE_INVALID, message: 'errors.consent_type_invalid', rawCode: err.code }
    }
  }

  // 23502 = not_null_violation
  if (err.code === '23502' && err.message.includes('version')) {
    return { business: BusinessError.CONSENT_VERSION_MISSING, message: 'errors.consent_version_missing', rawCode: err.code }
  }

  return { business: BusinessError.UNKNOWN, message: 'errors.unknown', rawCode: err.code, rawMessage: err.message }
}

export function mapAuthError(err: AuthError | null): MappedError | null {
  if (!err) return null
  switch (err.message) {
    case 'Invalid login credentials':
      return { business: BusinessError.INVALID_CREDENTIALS, message: 'errors.invalid_credentials' }
    case 'Email not confirmed':
      return { business: BusinessError.EMAIL_NOT_CONFIRMED, message: 'errors.email_not_confirmed' }
    case 'User already registered':
      return { business: BusinessError.EMAIL_ALREADY_REGISTERED, message: 'errors.email_already_registered' }
    default:
      if (err.message.toLowerCase().includes('password') && err.message.toLowerCase().includes('characters')) {
        return { business: BusinessError.PASSWORD_TOO_WEAK, message: 'errors.password_too_weak' }
      }
      return { business: BusinessError.UNKNOWN, message: 'errors.unknown', rawMessage: err.message }
  }
}
```

### 9.2 Użycie w komponentach

```typescript
// Przed (kruchy string-match):
if (error?.message.includes('project_limit_exceeded')) {
  toast.error(t('errors.project_limit_exceeded'))
}

// Po (deterministyczny mapping):
import { mapPostgrestError, BusinessError } from '@/lib/supabase/errors'

const mapped = mapPostgrestError(error)
if (mapped?.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
  toast.error(t(mapped.message))  // 'errors.project_limit_exceeded'
  showUpgradeCTA()
}
```

### 9.3 Klucze i18n

`src/messages/{pl,en}.json` musi zawierać sekcję `errors.*` ze wszystkimi kluczami z BusinessError. Brakujący klucz = fallback na `errors.unknown`.

### 9.4 Konsekwencje zmian DB

Zmiana brzmienia `RAISE EXCEPTION` w funkcji DB (np. `'project_limit_exceeded'` → `'too_many_projects'`) **wymaga** synchronicznej aktualizacji `mapPostgrestError`. PR z migracją DB musi też dotykać `errors.ts` — code review lint rule.

---

## 10. Co poza zakresem

Endpointy / funkcje świadomie odłożone na post-MVP. Decyzje udokumentowane w PRD i decyzjach architektonicznych.

| Funkcja | Powód | Plan długoterminowy |
|---|---|---|
| **OAuth providers** (Google, GitHub) | PRD §3.2 wymienia jako „opcjonalnie". MVP używa email+password. Callback URL `/[locale]/auth/callback` już istnieje (reset password) — będzie reuse'owany dla OAuth. | Post-MVP: konfiguracja w Supabase Auth Dashboard, dodanie `signInWithOAuth({ provider: 'google' })` w UI, walidacja kontracji email z istniejącym kontem. |
| **Vercel Queues dla webhooków Paddle** | Webhook jest już idempotentny + szybki (1-2 SQL roundtrips). Queue dodaje opóźnienie. | Rozważyć przy >10k zdarzeń/dzień. |
| **Vercel Runtime Cache dla `GET /rest/v1/documents` listy** | Workload niski (free user = 1 projekt, pro user = ~50). Cache invalidation przy POST/PATCH/DELETE komplikuje. | Rozważyć przy >1000 aktywnych użytkowników z dużymi listami. |
| **Async export do Vercel Blob + email link** | MVP soft-target <30s wystarczy (patrz §2.1 `/api/user/export`). | Wprowadzić gdy 95th percentile czasu eksportu przekroczy 60s lub user feedback wymusza. |
| **Vercel BotID / Cloudflare Turnstile** | Supabase Auth `email_sent` rate limit pokrywa publiczną fazę beta. | Włączyć przed publicznym launchem na cold-traffic landing page. |
| **Customer Portal jako Route Handler** | SDK inline (`paddle.CustomerPortal.open()`) wystarczy. | Jeśli Paddle wymusi server-side flow, dodać `GET /api/paddle/customer-portal`. |
| **Soft-delete konta z grace period** | MVP używa hard delete (RODO art. 17, prosty model). | Rozważyć 30-day grace period dla user-friendliness, ale wymaga zmian w schemacie (`deleted_at` nullable column + scheduled cleanup job). |
| **Streaming response dla `/api/user/export`** | Soft-target <30s pokrywa typowych userów. | Wprowadzić przy power-userach z >100 projektami. |
| **API versioning prefix `/api/v1/`** | Single-version w MVP wystarczy. | Wprowadzić przy pierwszym breaking change (patrz §8). |
| **Idempotency-Key na innych endpointach niż `/api/consent`** | Inne mutacyjne endpointy mają niskie ryzyko duplikatów (UI debounce + UPSERT). | Dodać do `DELETE /api/user/account` jeśli pojawi się żądanie retry-safe delete'u. |
| **Vercel KV / Upstash Redis dla rate limiting + idempotency cache** | MVP używa in-memory (per-instance). | Auto-provisioned przy instalacji integracji w Vercel Marketplace. Wymagane przed produkcją. |
