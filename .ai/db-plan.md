# Plan schematu bazy danych — WelderDoc MVP

> Dokument projektowy schematu PostgreSQL (Supabase, region EU-Frankfurt).
> Wersja: 1.0 · Data: 2026-05-07 · Status: zatwierdzony do implementacji
>
> Zastępuje wcześniejsze założenia z `.ai/architecture-base.md` §15 (przed-MVP) oraz `supabase/migrations/0001_init.sql`.
> Pełna implementacja w `supabase/migrations/0002_complete_schema.sql` (do wygenerowania osobno).

---

## 1. Przegląd schematu

Pięć tabel w schemacie `public`, plus `auth.users` zarządzane przez Supabase Auth.

```
auth.users (Supabase)
  ├─ 1:1 → user_profiles      (rozszerzenie konta)
  ├─ 1:N → documents          (projekty użytkownika)
  ├─ 1:N → consent_log        (audyt zgód RODO, append-only)
  └─ 1:N → subscriptions      (historia subskrypcji Paddle, ON DELETE SET NULL)

webhook_events                (log idempotencji Paddle, bez FK)
```

---

## 2. Tabele

### 2.1 `user_profiles`

Refresh tabeli z `0001_init.sql`. Rozszerzenie 1:1 do `auth.users`.

| Kolumna | Typ | Constraints | Notatka |
|---|---|---|---|
| `id` | UUID | PK, FK `auth.users(id) ON DELETE CASCADE` | RODO art. 17 |
| `plan` | TEXT | NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')) | Cache zdenormalizowany z `subscriptions`; modyfikowany tylko przez trigger lub `service_role` |
| `paddle_customer_id` | TEXT | UNIQUE | Kanoniczne miejsce; ustawiane przy pierwszym webhooku |
| `current_consent_version` | TEXT | NULL | Quick lookup; pełny audyt w `consent_log` |
| `locale` | TEXT | NOT NULL DEFAULT 'pl' CHECK (locale IN ('pl','en')) | Whitelist PL/EN |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | Trigger `set_updated_at()` |

### 2.2 `documents`

Refresh tabeli z `0001_init.sql`. Projekty zapisane w chmurze; scena trzymana jako pojedynczy JSONB.

| Kolumna | Typ | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT `gen_random_uuid()` |
| `owner_id` | UUID | NOT NULL, FK `auth.users(id) ON DELETE CASCADE` |
| `name` | TEXT | NOT NULL DEFAULT 'Nowy projekt' CHECK (`length(trim(name)) > 0 AND length(name) <= 100`) |
| `data` | JSONB | NOT NULL CHECK (`jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array'`) plus CHECK (`octet_length(data::text) < 5 * 1024 * 1024`) |
| `schema_version` | INT | NOT NULL DEFAULT 1; trigger sync z `data->>'schemaVersion'` |
| `share_token` | TEXT | UNIQUE NULL; format docelowy `encode(gen_random_bytes(24), 'base64url')` (post-MVP) |
| `share_token_expires_at` | TIMESTAMPTZ | NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() — trigger `set_updated_at()` |

### 2.3 `subscriptions` (nowa, historyczna)

Każda subskrypcja Paddle = nowy wiersz. Historia umożliwia audyt zmian planu (Free → Pro miesięczny → anulowanie → ponowny zakup).

| Kolumna | Typ | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT `gen_random_uuid()` |
| `user_id` | UUID | FK `auth.users(id) ON DELETE SET NULL` (audyt po RODO-delete) |
| `paddle_subscription_id` | TEXT | UNIQUE NOT NULL |
| `paddle_customer_snapshot` | TEXT | NOT NULL — kopia ID dla audytu po `SET NULL` |
| `status` | TEXT | NOT NULL CHECK (`status IN ('trialing','active','past_due','paused','canceled')`) |
| `plan_tier` | TEXT | NOT NULL CHECK (`plan_tier IN ('pro_monthly','pro_annual')`) |
| `current_period_start` | TIMESTAMPTZ | NOT NULL |
| `current_period_end` | TIMESTAMPTZ | NOT NULL |
| `cancel_at` | TIMESTAMPTZ | NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() — trigger |

**Reguła „efektywny plan Pro":** `status IN ('trialing','active','past_due')` LUB `(status = 'canceled' AND current_period_end > now())`. Pakowana w funkcję `effective_plan(user_id)`.

### 2.4 `consent_log` (nowa, append-only)

Audyt zgód RODO. Odwołanie zgody = nowy wiersz z `accepted = false` (immutable history).

| Kolumna | Typ | Constraints |
|---|---|---|
| `id` | UUID | PK DEFAULT `gen_random_uuid()` |
| `user_id` | UUID | FK `auth.users(id) ON DELETE CASCADE` |
| `consent_type` | TEXT | NOT NULL CHECK (`consent_type IN ('terms_of_service','privacy_policy','cookies')`) |
| `version` | TEXT | NOT NULL — np. '2026-05-01' lub semver |
| `accepted` | BOOLEAN | NOT NULL — odwołanie zgody = nowy wiersz `false` |
| `accepted_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `ip_address` | INET | NULL — anonimizowany /24 (IPv4) / /48 (IPv6) w aplikacji przed INSERT |
| `user_agent` | TEXT | NULL |

**Append-only:** brak `updated_at`, brak policy UPDATE/DELETE.

### 2.5 `webhook_events` (nowa, idempotencja Paddle)

Log zdarzeń webhookowych zapewniający idempotencję (Paddle gwarantuje at-least-once delivery).

| Kolumna | Typ | Constraints |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `provider` | TEXT | NOT NULL — np. 'paddle' |
| `external_event_id` | TEXT | NOT NULL |
| `event_type` | TEXT | NOT NULL |
| `payload` | JSONB | NOT NULL |
| `received_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `processed_at` | TIMESTAMPTZ | NULL |
| | | `UNIQUE (provider, external_event_id)` |

**Bez RLS policies** — dostęp wyłącznie przez `service_role`. Retencja 90 dni (cron cleanup).

---

## 3. Indeksy

```sql
CREATE INDEX documents_owner_id_updated_at_idx
  ON documents (owner_id, updated_at DESC);

CREATE INDEX documents_schema_version_idx
  ON documents (schema_version)
  WHERE schema_version < <CURRENT_VERSION>;  -- partial, na potrzeby migracji

CREATE INDEX subscriptions_user_status_period_idx
  ON subscriptions (user_id, status, current_period_end DESC);

CREATE INDEX consent_log_user_type_time_idx
  ON consent_log (user_id, consent_type, accepted_at DESC);

CREATE INDEX webhook_events_received_at_idx
  ON webhook_events (received_at);
```

**Implicit (z `UNIQUE`, nie trzeba dublować):**
- `documents (share_token)`
- `subscriptions (paddle_subscription_id)`
- `user_profiles (paddle_customer_id)`
- `webhook_events (provider, external_event_id)`

**Świadomie pominięte:**
- GIN na `documents.data` (brak query-patternu w MVP, koszt utrzymania > wartość).
- Indeks na `webhook_events (event_type)` (analityka rzadka, full scan na 90-dniowych danych tani).

---

## 4. RLS — polityki bezpieczeństwa

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `documents` | `owner_id = auth.uid()` | `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` | jak INSERT (WITH CHECK) | `owner_id = auth.uid()` |
| `user_profiles` | `id = auth.uid()` | — (auto przez trigger `handle_new_user`) | `id = auth.uid()` + trigger blokujący kolumny `plan`, `paddle_customer_id` dla nie-`service_role` | — |
| `subscriptions` | `user_id = auth.uid()` | brak (`service_role` only) | brak | brak |
| `consent_log` | `user_id = auth.uid()` | `user_id = auth.uid()` | brak (append-only) | brak (append-only) |
| `webhook_events` | brak | brak | brak | brak |

**Reguły:**
- Wszystkie polityki używają `WITH CHECK` tam, gdzie operacja zmienia dane (zapobiega atakowi „przepisz `owner_id` na cudzy").
- `documents` INSERT/UPDATE waliduje `email_confirmed_at IS NOT NULL` — chroni przed rejestracją na cudzy mail i zapisem projektów przed potwierdzeniem.
- Append-only osiągamy strukturalnie (brak policy UPDATE/DELETE = `authenticated` nie wykona, niezależnie od WHERE).
- `webhook_events` bez żadnej policy = całkowita blokada dostępu klienckiego; dostęp wyłącznie z handlera webhook (`service_role`).

---

## 5. Triggery i funkcje

### 5.1 Funkcje pomocnicze

| Funkcja | Cel | Security |
|---|---|---|
| `set_updated_at()` | Auto `updated_at` (z `0001_init.sql`) | INVOKER |
| `handle_new_user()` | Auto `INSERT user_profiles` przy rejestracji (z `0001_init.sql`, refresh) | DEFINER, `SET search_path = ''` |
| `effective_plan(user_id UUID) RETURNS TEXT` | Mapowanie subscription → plan ('free' \| 'pro') | DEFINER, STABLE, `SET search_path = ''` |
| `check_free_project_limit()` | Trigger BEFORE INSERT/UPDATE OF `owner_id` ON `documents` — blokada limitu Free | DEFINER, `SET search_path = ''`, `RAISE EXCEPTION 'project_limit_exceeded' USING ERRCODE = 'P0001'` |
| `block_protected_user_profile_columns()` | Trigger BEFORE UPDATE ON `user_profiles` — `NEW.plan := OLD.plan`, `NEW.paddle_customer_id := OLD.paddle_customer_id` dla nie-`service_role` | INVOKER |
| `refresh_user_plan_from_subscription()` | Trigger AFTER INSERT/UPDATE ON `subscriptions` — synchronizuje `user_profiles.plan` przez `effective_plan()` | DEFINER, `SET search_path = ''` |
| `sync_paddle_customer()` | Trigger AFTER INSERT ON `subscriptions` — ustawia `user_profiles.paddle_customer_id` jeśli NULL, rzuca `paddle_customer_mismatch` przy konflikcie | DEFINER, `SET search_path = ''` |
| `sync_schema_version()` | Trigger BEFORE INSERT/UPDATE OF `data` ON `documents` — kopiuje `data->>'schemaVersion'` do kolumny | INVOKER |
| `refresh_expired_plans()` | Wywoływana z cron `/api/cron/expire-subscriptions` — ustawia `plan = 'free'` dla wygasłych Pro w `user_profiles` | DEFINER, `SET search_path = ''` |

**Zabezpieczenie CVE-2018-1058:** wszystkie funkcje `SECURITY DEFINER` deklarujemy z `SET search_path = ''`, a wszystkie referencje do tabel w pełni kwalifikujemy (`public.user_profiles`, `auth.users`).

### 5.2 Lista triggerów

```
documents_before_insert_or_update_check_limit       → check_free_project_limit
documents_before_insert_or_update_sync_schema       → sync_schema_version
documents_set_updated_at (z 0001)                   → set_updated_at
user_profiles_before_update_block_protected         → block_protected_user_profile_columns
user_profiles_set_updated_at                        → set_updated_at
subscriptions_after_insert_or_update_refresh_plan   → refresh_user_plan_from_subscription
subscriptions_after_insert_sync_customer            → sync_paddle_customer
subscriptions_set_updated_at                        → set_updated_at
on_auth_user_created (z 0001)                       → handle_new_user
```

`consent_log` i `webhook_events` — bez triggerów (append-only, brak `updated_at`).

---

## 6. ON DELETE — graf kaskadowania

```
auth.users DELETE
  ├─→ user_profiles  CASCADE  (RODO art. 17)
  ├─→ documents      CASCADE  (RODO art. 17)
  ├─→ consent_log    CASCADE  (RODO art. 17)
  └─→ subscriptions  SET NULL (audyt billingowy, paddle_customer_snapshot zachowany)

webhook_events — brak FK, niezależny log techniczny
```

**Argument:** kompletny hard-delete treści użytkownika (RODO „prawo do bycia zapomnianym"), z zachowaniem zdeanonimizowanych danych billingowych. Paddle jako Merchant of Record trzyma autorytatywne dokumenty rozliczeniowe, my mamy techniczny ślad rekonsyliacji.

---

## 7. Cron jobs (Vercel)

Konfiguracja w `vercel.json` (`crons` array). Brak `pg_cron` (Supabase nie włącza domyślnie + kontrola po stronie aplikacji jest deterministyczna i obserwowalna).

| Endpoint | Częstotliwość | Cel |
|---|---|---|
| `/api/cron/expire-subscriptions` | dziennie 03:00 UTC, region `fra1` | Wywołuje `refresh_expired_plans()` — zamyka cicho wygasłe Pro |
| `/api/cron/cleanup-webhook-events` | tygodniowo | `DELETE FROM webhook_events WHERE received_at < now() - interval '90 days'` |

---

## 8. Migracja gościa do chmury (PRD US-007)

**Mechanizm dwuwarstwowy:**

1. **Aplikacyjny:** klient wykonuje zwykły `INSERT` przez Supabase SDK z `localStorage` payload jako `data`. Po sukcesie ustawia w `localStorage` flag `welderdoc_migrated_at: <ISO>` przed wyczyszczeniem `welderdoc_autosave`. localStorage jest współdzielony między zakładkami tej samej przeglądarki — druga zakładka po reload-zie zobaczy flag i pominie migrację.
2. **Bazodanowy:** trigger `check_free_project_limit` blokuje drugi `INSERT` dla planu Free (`project_limit_exceeded`); dla planu Pro to nieproblem (oczekiwane = wiele projektów). Edge case podwójnej migracji w mikrosekundowym oknie race → natural fallback przez DB trigger.

**Brak dedykowanej funkcji SQL** — migracja jest zwykłym INSERT-em, RLS zapewnia `owner_id = auth.uid()`.

---

## 9. Decyzje cross-cutting (rejestr)

| Decyzja | Wybór | Runda |
|---|---|---|
| Subskrypcje: osobna tabela | `subscriptions` z cyklem życia Paddle | R1 #1 |
| ENUM vs TEXT+CHECK | TEXT + CHECK (łatwiejsza ewolucja) | R1 #2 |
| Limit projektów Free | Trigger `check_free_project_limit` (race-safe) | R1 #3 |
| Soft vs hard delete projektów | Hard (`DELETE`) — MVP | R1 #4 |
| Indeksowanie listy projektów | `(owner_id, updated_at DESC)` | R1 #5 |
| Walidacja `data` JSONB | CHECK strukturalny + 5 MB limit | R1 #6 |
| RLS hardening | `WITH CHECK` + email_confirmed_at | R1 #7 |
| `share_token` format | base64url(24 bytes) post-MVP, kolumna zarezerwowana | R1 #8 |
| Audyt zgód | Tabela `consent_log` (append-only) | R1 #9 |
| Webhook idempotencja | Tabela `webhook_events` z UNIQUE | R1 #10 |
| Statusy subscription | trialing/active/past_due/paused/canceled + grace period | R2 #1 |
| Synchronizacja `plan` | Trigger + cron daily | R2 #2 |
| Łańcuch CASCADE | documents/consent_log CASCADE; subscriptions SET NULL | R2 #3 |
| Trigger limitu obejmuje UPDATE | Tak, custom error message `project_limit_exceeded` | R2 #4 |
| Blokada self-update planu | Trigger nadpisujący `NEW = OLD` dla nie-`service_role` | R2 #5 |
| Rozmiar `data` JSONB | `octet_length(data::text) < 5 MB` | R2 #6 |
| Granulacja zgód | terms_of_service + privacy_policy + cookies | R2 #7 |
| Retencja webhook_events | 90 dni, cron cleanup | R2 #8 |
| Constraints na `name` | length 1–100, trim | R2 #9 |
| Thumbnail w MVP | Nie | R2 #10 |
| `subscriptions` jako historia | Tak (multi-row per user) | R3 #1 |
| `paddle_customer_id` kanoniczne | `user_profiles`, snapshot w `subscriptions` | R3 #2 |
| Migracja gościa | Klient SDK + `localStorage.welderdoc_migrated_at` flag | R3 #3, #4 |
| Dual `schema_version` | Kolumna + JSON, trigger sync | R3 #5 |
| Realtime Supabase | Wyłączone w MVP | R3 #6 |
| `updated_at` triggers | documents/user_profiles/subscriptions; nie consent_log/webhook_events | R3 #7 |
| Plik migracji | Pojedynczy `0002_complete_schema.sql` (greenfield refresh) | R3 #8 |
| Konwencje nazewnictwa | snake_case, plural tables, `<table>_<columns>_idx` | R3 #9 |
| Email confirmation guard | RLS `WITH CHECK` z subquery do `auth.users.email_confirmed_at` | R3 #10 |
| `locale` whitelist | CHECK (locale IN ('pl','en')) | R4 #1 |
| Anonimizacja IP | Truncate /24 (IPv4) / /48 (IPv6) w aplikacji | R4 #2 |
| RLS per-operacja | Tak dla append-only i `user_profiles`; FOR ALL dla `documents` | R4 #3 |
| Indeksy audyt | `consent_log (user_id, consent_type, accepted_at DESC)`; `webhook_events (received_at)` | R4 #4 |
| `SECURITY DEFINER` + `search_path = ''` | Tak (CVE-2018-1058 mitigation) | R4 #5 |
| `COMMENT ON` | Tabele i kluczowe kolumny | R4 #6 |
| Paddle webhook ordering | Nie zakładać kolejności; trigger sync + handler resilience | R4 #7 |
| Indeks na `share_token` | Wystarczy implicit z UNIQUE | R4 #8 |
| Kolejność DROP w migracji | Explicit child → parent, bez CASCADE | R4 #9 |

---

## 10. Plan migracji `0002_complete_schema.sql`

**Lokalizacja:** `supabase/migrations/0002_complete_schema.sql` (pojedynczy plik, atomowa migracja, greenfield refresh).

**Struktura:**

```sql
-- Header: nagłówek z linkiem do .ai/db-plan.md i opisem zmian względem 0001

-- 1. DROP w kolejności child → parent (bez CASCADE)
DROP TABLE IF EXISTS public.webhook_events;
DROP TABLE IF EXISTS public.consent_log;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.documents;
DROP TABLE IF EXISTS public.user_profiles;

-- 2. DROP funkcji (CASCADE usuwa zależne triggery)
DROP FUNCTION IF EXISTS public.handle_new_user CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at CASCADE;

-- 3. CREATE FUNCTION
--    set_updated_at, handle_new_user, effective_plan,
--    check_free_project_limit, block_protected_user_profile_columns,
--    refresh_user_plan_from_subscription, sync_paddle_customer,
--    sync_schema_version, refresh_expired_plans

-- 4. CREATE TABLE
--    user_profiles, documents, subscriptions, consent_log, webhook_events

-- 5. CREATE INDEX (nie-implicit)

-- 6. ENABLE RLS + CREATE POLICY (per-tabela, per-operacja)

-- 7. CREATE TRIGGER

-- 8. COMMENT ON TABLE / COMMENT ON COLUMN (samodokumentacja)
```

**Plik 0001_init.sql** zostawiamy nietknięty (historyczny ślad).

---

## 11. Konwencje nazewnictwa

- **Case:** `snake_case` wszędzie (zgodne z Supabase TS gen).
- **Tabele:** liczba mnoga (`documents`, `subscriptions`, `user_profiles`, `webhook_events`); wyjątek `consent_log` (log).
- **Indeksy:** `<table>_<columns>_idx`, np. `documents_owner_id_updated_at_idx`.
- **Triggery:** `<table>_<when>_<event>_<purpose>`, np. `documents_before_insert_or_update_check_limit`.
- **Funkcje:** czasownik + rzeczownik, np. `effective_plan`, `check_free_project_limit`.
- **Schema:** wszystko w `public`.

---

## 12. Mapping na PRD i `architecture-base.md`

| Wymóg | Implementacja |
|---|---|
| PRD §3.1 plany (Free/Pro) + limity | `user_profiles.plan` + trigger `check_free_project_limit` |
| PRD §3.1 watermark Guest/Free | Aplikacyjnie po sprawdzeniu `user_profiles.plan` |
| PRD §3.2 reset hasła, OAuth | Supabase Auth (out-of-the-box) |
| PRD US-007 migracja gościa | Klient SDK + flag `welderdoc_migrated_at` (sekcja 8) |
| PRD US-010 lista projektów | Indeks `documents_owner_id_updated_at_idx` |
| PRD US-011 usuwanie projektu | Hard `DELETE` + RLS owner check |
| PRD §3.8 `shareToken` post-MVP | Zarezerwowana kolumna `share_token` + `share_token_expires_at` |
| PRD §3.10 GDPR (consent) | Tabela `consent_log` z 3 typami zgód |
| PRD §3.10 region EU Frankfurt | Wymóg infrastrukturalny (Supabase config + `fra1` w `vercel.json`) |
| Architecture-base §13 `CanvasDocument` | `documents.data` JSONB + `documents.schema_version` |
| Architecture-base §13 historia poza Supabase | Brak tabeli `history` — tylko `localStorage` |
| Architecture-base §14 plany subskrypcyjne | `user_profiles.plan` + `subscriptions` jako historia |
| Architecture-base §16 webhook Paddle | `/api/paddle/webhook` + idempotencja przez `webhook_events` |

---

## 13. Tematy świadomie poza schematem DB

- **Treść Polityki Prywatności i Regulaminu** (legal — własne pliki w `public/legal/` lub osobne strony).
- **Implementacja `/api/cron/*`** (kod aplikacji, `app/api/cron/`).
- **Webhook handler Paddle** (kod aplikacji, `app/api/paddle/webhook/route.ts`).
- **Runtime migracja `documentCodec`** dla `schemaVersion < N` (kod, `src/lib/documentCodec.ts`).
- **Generowanie typów TypeScript** (`npx supabase gen types typescript`).
- **Lighthouse CI / Sentry / branding** (poza zakresem zgodnie z `.ai/init-project-setup-analysis.md`).
- **Thumbnail/preview projektów** (świadomie odrzucone w MVP).
- **Realtime Supabase** (włączenie post-MVP gdy realna współpraca wejdzie do roadmapy).

---

## 14. Procedura zmian

Każda zmiana schematu w tym dokumencie wymaga:

1. Aktualizacji niniejszego dokumentu z wpisem w changelog na końcu.
2. Aktualizacji `.ai/architecture-base.md` §15 (synchronicznie).
3. Wygenerowania nowej migracji `supabase/migrations/00NN_*.sql`.
4. Regeneracji `src/types/database.ts` (`pnpm supabase:types`).

---

## 15. Changelog

- **1.0** (2026-05-07): Pierwsza wersja zatwierdzona; bazuje na 4 rundach pytań i rekomendacji (40 decyzji łącznie). Zastępuje schemat z `architecture-base.md` §15 oraz migrację `0001_init.sql`. Implementacja przez `0002_complete_schema.sql` — do wygenerowania osobno.
