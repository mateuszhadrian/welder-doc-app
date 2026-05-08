# Schemat bazy danych — WelderDoc (MVP)

> **Status:** projekt zatwierdzony; migracja w repo jako `supabase/migrations/20260507000000_complete_schema.sql`.
> **Wersja dokumentu:** 1.2 · **Data:** 2026-05-08
> **Region instancji Supabase:** `EU (Frankfurt)` (PRD §3.10, GDPR)
> **Powiązane dokumenty:** `.ai/prd.md`, `.ai/tech-stack.md`, `.ai/architecture-base.md` §15, `.ai/supabase-migration-modifications.md`
>
> Greenfield — plik `0001_init.sql` został **fizycznie usunięty** z repo (`git rm supabase/migrations/0001_init.sql`); historię można odczytać przez `git log --all -- supabase/migrations/0001_init.sql`. Migracja `20260507000000_complete_schema.sql` jest **czystym CREATE bez `DROP IF EXISTS`** (decyzja v2 z `supabase-migration-modifications.md` z 2026-05-08, Opcja C). `pnpm supabase db reset` jest wymagany w każdym środowisku, gdzie kiedykolwiek aplikowano stary `0001_init.sql` (czyli dziś: lokalna baza tego dewelopera). Wybór tej formy (zamiast Opcji A z DROP'ami) jest zasadny w stanie pre-implementation projektu — szczegóły i zestawienie z odrzuconymi opcjami w `supabase-migration-modifications.md`.

---

## 1. Lista tabel

### 1.1 `auth.users` (zarządzane przez Supabase Auth)

Nie należy do schematu `public`. Schemat `public` referuje przez FK na `auth.users(id)`. Pole `auth.users.email_confirmed_at` jest wykorzystywane w politykach RLS i w warunku `WITH CHECK` na `documents`.

---

### 1.2 `public.user_profiles`

Profil 1:1 z `auth.users`. Tworzony automatycznie triggerem `on_auth_user_created` (funkcja `handle_new_user`).

| Kolumna | Typ | Ograniczenia | Opis |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `REFERENCES auth.users(id) ON DELETE CASCADE` | Współdzielone PK z `auth.users` |
| `plan` | `TEXT` | `NOT NULL`, `DEFAULT 'free'`, `CHECK (plan IN ('free','pro'))` | Cache efektywnego planu (pochodna z `subscriptions`) |
| `paddle_customer_id` | `TEXT` | `UNIQUE` | Kanoniczny customer ID Paddle (nullable do pierwszego checkoutu) |
| `current_consent_version` | `TEXT` | nullable | Denormalizacja ostatniej zaakceptowanej wersji TOS+PP+cookies |
| `locale` | `TEXT` | `NOT NULL`, `DEFAULT 'pl'`, `CHECK (locale IN ('pl','en'))` | Preferencja UI (PL/EN) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Aktualizowane triggerem `user_profiles_before_update_set_updated_at` |

**Trigger ochrony kolumn:** `user_profiles_before_update_block_protected` — funkcja `block_protected_columns_update()` zeruje zmiany pól `plan`, `paddle_customer_id` oraz `current_consent_version` (`NEW.<col> := OLD.<col>`) gdy żaden z dwóch warunków bypass nie jest spełniony:
1. `current_user = 'postgres'` — rola owner'a wykonującego `SECURITY DEFINER` funkcję (np. `record_consent_bundle()`, `refresh_user_plan_from_subscriptions()`, `sync_paddle_customer()`). Zapis do chronionych kolumn z poziomu DB-side funkcji jest dozwolony bez dodatkowych zabiegów. `current_user` w funkcji `SECURITY DEFINER` zwraca rolę właściciela funkcji (`postgres`), niezależnie od JWT — odróżnia go to od `auth.role()`, które czyta `request.jwt.claims`.
2. `auth.role() = 'service_role'` — bezpośredni klient admin (paddle webhook, crony) z `SUPABASE_SERVICE_ROLE_KEY`. Defensywny `COALESCE(auth.role(), 'anon')` chroni przed nullowym `auth.role()` w surowym `psql` / testach jednostkowych; bez `COALESCE` postgresowa 3-valued logic zewaluowałaby `NULL <> 'service_role'` jako `NULL` i ścieżka ochrony **nie wykonałaby się**, co maskowałoby błąd w testach.

Bypass `current_user = 'postgres'` został dodany w migracji `20260509000000_paddle_webhook_hardening.sql` po problemie code-doc-v6 §2.5 (`record_consent_bundle()` z roli `authenticated` nie aktualizował `current_consent_version`, mimo że jest `SECURITY DEFINER`). Zapisy odbywają się wyłącznie przez funkcje `SECURITY DEFINER` lub `service_role`:
- `plan` — trigger `subscriptions_after_iu_refresh_plan` (kanonicznie) + cron `refresh_expired_plans()` (downgrade po grace period).
- `paddle_customer_id` — trigger `sync_paddle_customer` (z webhooka Paddle) lub bezpośrednio przez webhook handler.
- `current_consent_version` — wyłącznie funkcja `record_consent_bundle()` (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`) wołana atomowo przez route handler `POST /api/consent`; jedna transakcja DB obejmuje bundle insert do `consent_log` oraz `UPDATE user_profiles.current_consent_version`, eliminując okno niespójności audytu RODO art. 7 ust. 1 (każdej wartości `current_consent_version` odpowiada bundle wpisów w `consent_log` z tą samą wersją).

**Webhook handler `app/api/paddle/webhook/route.ts:241-244`** zapisuje `paddle_customer_id` przez `createAdminClient()` (`service_role`), omijając block-trigger przez gałąź `auth.role() = 'service_role'` (App-side bypass). Trigger `sync_paddle_customer` (DB-side bypass przez `current_user = 'postgres'`) działa jako fallback dla przypadku, gdy `customer.*` event nie dociera lub przychodzi po `subscription.*` (rozwiązuje brak gwarancji ordering po stronie Paddle).

---

### 1.3 `public.documents`

Pojedynczy projekt (rysunek) — JSONB blob ze sceną zgodną z kontraktem `documentCodec.ts` (`shapes[]`, `weldUnits[]`, `canvasWidth`, `canvasHeight`, `schemaVersion`).

| Kolumna | Typ | Ograniczenia | Opis |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | |
| `owner_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` | Hard delete (RODO art. 17) |
| `name` | `TEXT` | `NOT NULL`, `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` | Nazwa projektu (PRD US-008) |
| `data` | `JSONB` | `NOT NULL`, `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')`, `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` | Scena (≤ 5 MB raw) |
| `schema_version` | `INT` | `NOT NULL`, `DEFAULT 1` | Synchronizowane triggerem z `data->>'schemaVersion'` |
| `share_token` | `TEXT` | `UNIQUE`, nullable | Rezerwacja post-MVP; format docelowy: `encode(gen_random_bytes(24), 'base64url')` |
| `share_token_expires_at` | `TIMESTAMPTZ` | nullable | Rezerwacja post-MVP (TTL share linka) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Trigger `documents_before_update_set_updated_at` |

**Triggery:**
- `documents_before_iu_sync_schema_version` — `BEFORE INSERT OR UPDATE OF data` — funkcja `sync_schema_version_from_data()` ustawia `NEW.schema_version := COALESCE((NEW.data->>'schemaVersion')::int, NEW.schema_version, 1)`.
- `documents_before_iu_check_free_limit` — `BEFORE INSERT OR UPDATE OF owner_id` — funkcja `check_free_project_limit()` rzuca `RAISE EXCEPTION 'project_limit_exceeded'` gdy plan właściciela = `free` i istnieje już ≥ 1 wiersz dla `owner_id`. Pokrywa też transfer (`UPDATE owner_id`).
- `documents_before_update_set_updated_at` — wspólna funkcja `set_updated_at()`.

---

### 1.4 `public.subscriptions`

**Aktualny stan** każdej subskrypcji Paddle (jeden wiersz per `paddle_subscription_id`, `UNIQUE(paddle_subscription_id)`). Każdy webhook `subscription.*` → **upsert** po `paddle_subscription_id` (`api-plan.md` §2.1) — UPDATE istniejącego wiersza, nie INSERT nowego. Źródło prawdy dla efektywnego planu (`effective_plan()` lookup). Historyczny audit log surowych zdarzeń webhooków leży w `webhook_events.payload` — `subscriptions` to NIE jest append-only history.

| Kolumna | Typ | Ograniczenia | Opis |
|---|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID` | `REFERENCES auth.users(id) ON DELETE SET NULL`, nullable | Po RODO-delete pozostaje audyt billingu |
| `paddle_subscription_id` | `TEXT` | `NOT NULL`, `UNIQUE` | ID subskrypcji w Paddle |
| `paddle_customer_snapshot` | `TEXT` | `NOT NULL` | Kopia in-row na potrzeby audytu po `SET NULL` |
| `status` | `TEXT` | `NOT NULL`, `CHECK (status IN ('trialing','active','past_due','paused','canceled'))` | |
| `plan_tier` | `TEXT` | `NOT NULL`, `CHECK (plan_tier IN ('pro_monthly','pro_annual'))` | Z payloadu Paddle |
| `current_period_start` | `TIMESTAMPTZ` | nullable | |
| `current_period_end` | `TIMESTAMPTZ` | nullable | Grace period dla `canceled` rozwiązuje `effective_plan()` |
| `cancel_at` | `TIMESTAMPTZ` | nullable | Zaplanowane cancel-at-period-end |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Trigger `subscriptions_before_update_set_updated_at` |

**Triggery:**
- `subscriptions_after_iu_sync_customer` — `AFTER INSERT OR UPDATE OF paddle_customer_snapshot, user_id` — funkcja `sync_paddle_customer()`: gdy `user_id IS NOT NULL` i `user_profiles.paddle_customer_id IS NULL` → wpisuje `paddle_customer_snapshot` do `user_profiles.paddle_customer_id` (rozwiązuje brak ordering gwarancji webhooków `customer.created` vs `subscription.created`).
- `subscriptions_after_iu_refresh_plan` — `AFTER INSERT OR UPDATE OF status, current_period_end, user_id` — funkcja `trg_subscriptions_refresh_plan()` przelicza `effective_plan(user_id)` i zapisuje do `user_profiles.plan` przez `refresh_user_plan_from_subscriptions(uid)` (`SECURITY DEFINER`, omija block-trigger). Recovery orphan recordów: gdy `tg_op = 'UPDATE'` i `OLD.user_id IS DISTINCT FROM NEW.user_id`, refresh wykonywany jest **dla obu** wartości — `NEW.user_id` (efektywny plan teraz uwzględnia ten wiersz) oraz `OLD.user_id` (efektywny plan poprzedniego właściciela już nie). Naprawia stale plan poprzedniego właściciela rekordu po manualnym `UPDATE subscriptions SET user_id = ...`. `OF user_id` + recovery semantyka dodane w migracji `20260509000000_paddle_webhook_hardening.sql`.
- `subscriptions_before_update_set_updated_at` — wspólna `set_updated_at()`.

---

### 1.5 `public.consent_log`

Append-only audyt zgód RODO (TOS, Privacy Policy, cookies). Odwołanie zgody = nowy wiersz `accepted = FALSE`.

| Kolumna | Typ | Ograniczenia | Opis |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | |
| `user_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` | RODO art. 17 |
| `consent_type` | `TEXT` | `NOT NULL`, `CHECK (consent_type IN ('terms_of_service','privacy_policy','cookies'))` | |
| `version` | `TEXT` | `NOT NULL` | Format wersji zgody — TBD legalnie (semver / data / hash) |
| `accepted` | `BOOLEAN` | `NOT NULL` | `FALSE` = wycofanie zgody |
| `accepted_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | |
| `ip_address` | `INET` | nullable | Anonimizowany w aplikacji do `/24` (IPv4) lub `/48` (IPv6) przed `INSERT` (motyw 30 RODO) |
| `user_agent` | `TEXT` | nullable | |

**Brak triggera `updated_at` — append-only.**

---

### 1.6 `public.webhook_events`

Audyt techniczny i mechanizm idempotencji webhooków (Paddle, później ewentualnie inne). Brak FK do `auth.users` — niezależny od cyklu życia konta.

| Kolumna | Typ | Ograniczenia | Opis |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | |
| `provider` | `TEXT` | `NOT NULL` | `'paddle'`, w przyszłości np. `'stripe'` |
| `external_event_id` | `TEXT` | `NOT NULL` | ID zdarzenia od providera |
| `event_type` | `TEXT` | `NOT NULL` | Np. `subscription.activated` |
| `payload` | `JSONB` | `NOT NULL` | Surowy payload webhooka |
| `received_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | |
| `processed_at` | `TIMESTAMPTZ` | nullable | Ustawiane po skutecznym przetworzeniu |

**Constraint:** `UNIQUE (provider, external_event_id)` — mechaniczna idempotencja:

```sql
INSERT INTO webhook_events (provider, external_event_id, event_type, payload)
VALUES (...)
ON CONFLICT (provider, external_event_id) DO NOTHING
RETURNING id;
-- pusty RETURNING ⇒ duplikat ⇒ HTTP 200 bez efektu biznesowego
```

**Retencja 90 dni** — cron Vercel `/api/cron/cleanup-webhook-events` (cotygodniowo, `fra1`). **Brak triggera `updated_at` — append-only.**

> **Uwaga TypeScript:** `supabase gen types` mapuje Postgres `INET` na `unknown` (brak natywnego odpowiednika w TS). Supabase REST zwraca `INET` jako `string`. Przy implementacji `/api/consent` użyć wrapper'a:
> ```typescript
> // src/types/supabase-helpers.ts
> import type { Tables } from './database'
> export type ConsentLogRow = Omit<Tables<'consent_log'>, 'ip_address'> & { ip_address: string | null }
> ```

---

## 2. Relacje między tabelami

| Z → Do | Kardynalność | Akcja przy `DELETE` rodzica |
|---|---|---|
| `auth.users` → `user_profiles.id` | 1:1 | `CASCADE` |
| `auth.users` → `documents.owner_id` | 1:N | `CASCADE` |
| `auth.users` → `subscriptions.user_id` | 1:N (historia) | `SET NULL` (audyt billingu, snapshot zachowuje `paddle_customer_snapshot`) |
| `auth.users` → `consent_log.user_id` | 1:N (append-only) | `CASCADE` |
| (brak) → `webhook_events` | brak relacji do użytkowników | n/d |

**Brak relacji wiele-do-wielu w MVP.** Schemat `WeldUnit ↔ Shape` istnieje wyłącznie wewnątrz `documents.data` (JSONB) — każdy `WeldUnit` referuje do `shapes[].id` przez `elementIds[]`/`weldJointId`. Spójność egzekwowana w aplikacji (codec + walidator) — nie ma znaczenia dla schematu SQL.

**Diagram (ASCII):**

```
auth.users ──1:1── user_profiles
   │
   ├──1:N── documents (owner_id, CASCADE)
   ├──1:N── subscriptions (user_id, SET NULL, paddle_customer_snapshot)
   └──1:N── consent_log (user_id, CASCADE, append-only)

webhook_events  (samodzielne, dostęp tylko service_role)
```

---

## 3. Indeksy

| Indeks | Tabela | Definicja | Powód |
|---|---|---|---|
| `documents_pkey` | `documents` | `PRIMARY KEY (id)` | auto |
| `documents_owner_id_updated_at_idx` | `documents` | `(owner_id, updated_at DESC)` | Hot-path listy projektów (PRD US-008) |
| `documents_share_token_key` | `documents` | `UNIQUE (share_token)` | auto przez `UNIQUE` |
| `documents_schema_version_idx` | `documents` | `(schema_version)` (full B-tree) | Wykrywanie projektów do migracji codec'a (skanowanie po `schema_version < N` przy bumpie codec'a) |
| `subscriptions_pkey` | `subscriptions` | `PRIMARY KEY (id)` | auto |
| `subscriptions_paddle_subscription_id_key` | `subscriptions` | `UNIQUE (paddle_subscription_id)` | auto |
| `subscriptions_user_id_status_period_end_idx` | `subscriptions` | `(user_id, status, current_period_end DESC)` | `effective_plan()` lookup |
| `consent_log_pkey` | `consent_log` | `PRIMARY KEY (id)` | auto |
| `consent_log_user_id_type_accepted_at_idx` | `consent_log` | `(user_id, consent_type, accepted_at DESC)` | Wyszukiwanie ostatniej decyzji per typ |
| `webhook_events_pkey` | `webhook_events` | `PRIMARY KEY (id)` | auto |
| `webhook_events_provider_external_event_id_key` | `webhook_events` | `UNIQUE (provider, external_event_id)` | Idempotencja |
| `webhook_events_received_at_idx` | `webhook_events` | `(received_at)` | Cron retencji 90 dni |
| `user_profiles_pkey` | `user_profiles` | `PRIMARY KEY (id)` | auto |
| `user_profiles_paddle_customer_id_key` | `user_profiles` | `UNIQUE (paddle_customer_id)` | auto przez `UNIQUE` |

**Świadomie pominięte w MVP:**
- GIN na `documents.data` — brak query patternu po polach JSON (cała scena czytana naraz).
- Indeks na `documents.created_at` — sortowanie listy odbywa się po `updated_at`.
- Indeks na `consent_log.consent_type` solo — pokryty przez kompozyt z `user_id`.

---

## 4. Zasady PostgreSQL (RLS)

### 4.1 Zasada generalna

- **Wszystkie tabele `public.*` mają `ENABLE ROW LEVEL SECURITY`.**
- Polityki **per-tabela per-operacja** (`FOR SELECT / INSERT / UPDATE / DELETE / ALL`) z explicit `WITH CHECK` tam, gdzie zapis jest dozwolony.
- Append-only osiągane strukturalnie: brak polityki `UPDATE` / `DELETE` ⇒ niedozwolone dla wszystkich poza `service_role` (który omija RLS).
- `webhook_events` — **brak żadnej polityki** ⇒ dostęp wyłącznie z `service_role`.

### 4.2 `documents`

```sql
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_owner_all ON public.documents
  FOR ALL
  TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );
```

Niepotwierdzeni użytkownicy nie zapiszą projektów do chmury (pre-MVP nadużycie rejestracji).

### 4.3 `user_profiles`

```sql
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_authenticated ON public.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY user_profiles_update_authenticated ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
```

`INSERT` realizuje wyłącznie funkcja `handle_new_user()` (`SECURITY DEFINER`). Zmiany pól `plan`, `paddle_customer_id` oraz `current_consent_version` z roli innej niż `service_role` blokuje trigger `block_protected_columns_update()` (zachowuje `OLD` wartości — bez `RAISE EXCEPTION`, by aplikacja mogła swobodnie aktualizować `locale` w jednym `UPDATE`).

### 4.4 `subscriptions`

```sql
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_authenticated ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

Brak polityk `INSERT`/`UPDATE`/`DELETE` ⇒ mutacje wyłącznie z `service_role` (handler webhooka Paddle).

### 4.5 `consent_log`

```sql
ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_log_select_authenticated ON public.consent_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY consent_log_insert_authenticated ON public.consent_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
```

Brak polityk `UPDATE`/`DELETE` ⇒ append-only (RODO art. 7 ust. 1 — historia zgód).

### 4.6 `webhook_events`

```sql
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- brak żadnej CREATE POLICY ⇒ dostęp tylko z service_role
```

### 4.7 Funkcje pomocnicze RLS — `SECURITY DEFINER`

Wszystkie funkcje wywoływane z triggerów (lub z aplikacji w celu ominięcia RLS) ustawione jako:

```sql
CREATE OR REPLACE FUNCTION public.<name>(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
  -- pełne kwalifikacje: public.user_profiles, auth.users, …
$$;
```

**Lista:**
- `public.handle_new_user()` (już z 0001 — recreate)
- `public.set_updated_at()` (już z 0001 — recreate)
- `public.check_free_project_limit()`
- `public.effective_plan(uid UUID) RETURNS TEXT`
- `public.refresh_user_plan_from_subscriptions(uid UUID) RETURNS VOID`
- `public.refresh_expired_plans() RETURNS INT` — wołana z Vercel Cron daily 03:00 UTC
- `public.block_protected_columns_update()`
- `public.sync_schema_version_from_data()`
- `public.sync_paddle_customer()`
- `public.record_consent_bundle(p_user_id UUID, p_version TEXT, p_accepted BOOLEAN, p_ip INET, p_user_agent TEXT) RETURNS VOID` — atomowo wstawia bundle (`terms_of_service` + `privacy_policy` + `cookies`) do `consent_log` i (gdy `p_accepted = true`) aktualizuje `user_profiles.current_consent_version` w jednej transakcji. Egzekwuje `auth.uid() = p_user_id` dla `authenticated`; `service_role` może rejestrować dla dowolnego `user_id`. Wołane wyłącznie z `app/api/consent/route.ts` (`supabase.rpc('record_consent_bundle', ...)`). Migracja: `20260508000000_record_consent_bundle.sql`.
- `public.lookup_user_id_by_email(p_email TEXT) RETURNS UUID` — `STABLE`, `SECURITY DEFINER`, `service_role only` (`REVOKE EXECUTE FROM public; GRANT EXECUTE TO service_role`). Mapuje email na `auth.users.id` przez pojedynczy SELECT. Wykorzystywane przez `paddle/webhook` lookupUserId (4. priorytet kaskady: `customData.user_id` → `paddle_customer_id` → email RPC → null + warning). Skaluje się do dowolnej liczby użytkowników — zastępuje wcześniejsze `auth.admin.listUsers({ perPage: 200 })`, które gubiło użytkowników poza pierwszą stroną paginacji (code-doc-v6 §1.1). `authenticated` nie ma uprawnień (defense-in-depth — uniemożliwia enumerację kont po emailu). Migracja: `20260509000000_paddle_webhook_hardening.sql`.
- `public.trg_subscriptions_refresh_plan()` — funkcja triggera `subscriptions_after_iu_refresh_plan`. Wywołuje `refresh_user_plan_from_subscriptions(NEW.user_id)`; przy `UPDATE` z `OLD.user_id IS DISTINCT FROM NEW.user_id` dodatkowo `refresh_user_plan_from_subscriptions(OLD.user_id)`. Migracja: `20260509000000_paddle_webhook_hardening.sql` (zastępuje wcześniejszy wariant refreshujący tylko `NEW.user_id`).

Mitygacja CVE-2018-1058 (search_path attack): pusty `search_path` + pełne kwalifikacje obiektów.

---

## 5. Dodatkowe uwagi i decyzje projektowe

### 5.1 Persystencja sceny — pojedynczy JSONB

Cała scena (`shapes[]`, `weldUnits[]`, wymiary canvasu, `schemaVersion`) trzymana jako jeden `JSONB` w `documents.data`. Powody:
- **Brak partycjonowania per shape** → atomowy zapis projektu, jedna transakcja, jedna wersja.
- **Historia undo/redo NIE persystowana** — tylko localStorage (PRD US-013 + architecture-base §13).
- **Walidacja struktury na poziomie DB** (`CHECK jsonb_typeof + klucze top-level + 5 MB raw przez `octet_length`) — defense-in-depth obok validatora w aplikacji.
- **Self-describing JSON** (`data->>'schemaVersion'`) realizuje portability RODO art. 20 — eksport = dump kolumny `data`.

### 5.2 Dual `schema_version`

Dwie reprezentacje wersji schematu dokumentu — zsynchronizowane triggerem `sync_schema_version_from_data`:
- Kolumna pierwszej klasy `documents.schema_version INT` — szybkie query/index do wykrywania starych projektów do migracji codec'a.
- Pole `data->>'schemaVersion'` — portable, wewnątrz eksportu RODO.

### 5.3 Limit Free na poziomie DB (pas + szelki)

Aplikacja egzekwuje limit Free=1 projektu w UI, ale identyczny check robi trigger `check_free_project_limit()` (`BEFORE INSERT OR UPDATE OF owner_id`):
- Chroni przed race condition (dwie zakładki).
- Chroni przed bezpośrednim wywołaniem REST API z naruszeniem invariantu.
- Pokrywa scenariusz transferu projektu (`UPDATE owner_id`).
- Komunikat: `RAISE EXCEPTION 'project_limit_exceeded'` — aplikacja rozpoznaje przez `error.message.includes('project_limit_exceeded')` i mapuje na klucz `next-intl`.

### 5.3a Limit 3 elementów Guest/Free — client-side only (świadomy known gap)

PRD §3.1 wymaga **max 3 elementów na scenie** dla Guest/Free. Schemat DB nie egzekwuje tego limitu, ponieważ elementy sceny żyją wewnątrz `documents.data` (JSONB), a nie jako odrębne wiersze — `documents` jest 1 row per projekt, JSONB blob nie ma natywnych ROW-level checków per array element. Egzekwowanie odbywa się wyłącznie w `ShapesSlice.addShape()` (client-side, `architecture-base.md` §6).

**Defense in depth na poziomie DB:** `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` ogranicza całkowity rozmiar sceny do ~5 MB raw — Free user obchodzący frontend nie zapisze setek czy tysięcy shape'ów (ale ~10 000 prostych prostokątów wciąż się mieści). Akceptowalne dla MVP — atak wymaga manualnego SQL/REST i nie ma istotnego biznesowego celu (Free user nie czerpie wartości z dodatkowych elementów bez funkcji Pro).

**Post-MVP (jeśli okaże się potrzebne):** dodać trigger walidujący `BEFORE INSERT OR UPDATE OF data`:

```sql
-- Pseudo:
if (select plan from public.user_profiles where id = new.owner_id) = 'free' then
  if jsonb_array_length(new.data->'shapes') + jsonb_array_length(new.data->'weldUnits') > 3 then
    raise exception 'shape_limit_exceeded';
  end if;
end if;
```

Wstrzymane do pierwszego sygnału obejścia (jeśli wystąpi); wprowadza koszt walidacji JSONB przy każdym save'ie i nie ma jeszcze dowodu, że jest potrzebny.

### 5.4 Subskrypcje — aktualny stan, nie historia

`subscriptions` to tabela **aktualnego stanu** każdej subskrypcji Paddle (jeden wiersz per `paddle_subscription_id`, upsert po każdym webhooku `subscription.*`). Audit log surowych zdarzeń trzymamy w `webhook_events.payload` — to tam siedzi historia "kto/kiedy zmienił". `user_profiles.plan` to **denormalizacja** (cache) — jedyne źródło prawdy efektywnego planu to:

```sql
-- effective_plan(uid):
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = uid
      AND (
        s.status IN ('trialing','active','past_due')
        OR (s.status = 'canceled' AND s.current_period_end > now())
      )
  ) THEN 'pro'
  ELSE 'free'
END;
```

Dwa kanały aktualizacji `user_profiles.plan`:
1. **Real-time** — trigger `subscriptions_after_iu_refresh_plan` po każdym `INSERT`/`UPDATE` statusu lub `current_period_end`.
2. **Time-based** — Vercel Cron `/api/cron/expire-subscriptions` daily 03:00 UTC wywołuje `refresh_expired_plans()` (downgrade użytkowników, dla których `current_period_end` przekroczył `now()` w stanie `canceled`).

### 5.5 `paddle_customer_id` — kanonicznie + snapshot

- **Kanonicznie**: `user_profiles.paddle_customer_id UNIQUE` (jeden customer ↔ jeden user).
- **Snapshot in-row**: `subscriptions.paddle_customer_snapshot NOT NULL` — kopia zachowywana po `ON DELETE SET NULL` na `user_id` (anonimizacja konta nie usuwa rekordu billingu).
- Trigger `sync_paddle_customer()` rozwiązuje brak ordering gwarancji webhooków Paddle (`subscription.created` może przyjść przed `customer.created`).

### 5.6 Migracja gościa do chmury (US-007)

Klient po pierwszym logowaniu wykonuje zwykły `INSERT INTO documents (owner_id, name, data)` przez Supabase JS SDK z payloadem z localStorage. Zabezpieczenia:
- **Trigger `check_free_project_limit`** naturalnie blokuje drugą migrację z innej zakładki dla planu Free.
- **Marker `welderdoc_migrated_at`** w localStorage ustawiany **przed** czyszczeniem `welderdoc_autosave` — idempotentność client-side.
- Dla planu Pro podwójny insert nieszkodliwy (max 2 identyczne projekty — użytkownik usuwa duplikat).

### 5.7 Konwencje nazewnictwa

| Co | Konwencja | Przykład |
|---|---|---|
| Tabele | snake_case, l. mnoga | `documents`, `user_profiles`, `subscriptions`, `webhook_events` |
| Wyjątek | `consent_log` (l. pojedyncza — log) | |
| Kolumny | snake_case | `paddle_customer_id`, `current_period_end` |
| Indeksy | `<table>_<columns>_idx` | `documents_owner_id_updated_at_idx` |
| Indeksy `UNIQUE` (auto) | `<table>_<column>_key` | `subscriptions_paddle_subscription_id_key` |
| Triggery | `<table>_<when>_<event>_<purpose>` | `documents_before_iu_check_free_limit` |
| Funkcje | czasownik + rzeczownik | `check_free_project_limit`, `effective_plan` |
| Schemat | `public` (wszystko poza `auth.*`) | |

**Kolejność triggerów (PostgreSQL alfabetyczna).** PostgreSQL wykonuje triggery o tym samym `BEFORE/AFTER` + tym samym evencie w **kolejności alfabetycznej po nazwie**. Konwencja projektu wymaga, aby przy dodawaniu nowego triggera autor sprawdził, gdzie nowy trigger upadnie leksykograficznie względem istniejących — np. `block_protected_columns_update` na `user_profiles.BEFORE UPDATE` musi być przed `set_updated_at` (czyli trigger nazywa się `user_profiles_before_update_block_protected` < `user_profiles_before_update_set_updated_at` — zaczyna się od `b...` < `s...`). Trigger zerujący chronione kolumny przed update'em `updated_at` ma się odpalić jako pierwszy. Dodanie `user_profiles_before_update_a_validate_locale` wstawiłoby się przed `block_protected` — zwykle niepożądane (walidacja na `new` przed ustawieniem `new` przez block_protected). Przy nazewnictwie nowych triggerów należy dobrać prefix tak, by relatywna kolejność była zgodna z intencją.

### 5.8 Append-only design dla audytu

`consent_log` i `webhook_events` celowo bez:
- Triggera `set_updated_at` (brak kolumny `updated_at`).
- Polityk RLS `UPDATE`/`DELETE` (`consent_log` — niedostępne z `authenticated`; `webhook_events` — w ogóle bez polityk).
- Soft-delete flag — odwołanie zgody = nowy wiersz `accepted = FALSE`.

### 5.9 RODO — mapowanie na schemat

| Wymóg RODO | Realizacja |
|---|---|
| Art. 17 (right to erasure) | `ON DELETE CASCADE` na `documents` i `consent_log`; `SET NULL` na `subscriptions` (audyt finansowy zachowany przez `paddle_customer_snapshot`) |
| Art. 20 (portability) | Self-describing JSON w `documents.data->>'schemaVersion'`; endpoint `/api/user/export` zwraca `documents.data` + `consent_log` per user |
| Art. 7 ust. 1 (audyt zgód) | `consent_log` z wersjami i timestampem |
| Motyw 30 (minimalizacja PII) | Anonimizacja IP (`/24` IPv4, `/48` IPv6) w aplikacji **przed** `INSERT` do `consent_log.ip_address` |
| Lokalizacja danych UE | Region Supabase EU-Frankfurt; `vercel.json regions: ["fra1"]` |

### 5.10 Realtime wyłączony w MVP

Brak `ALTER PUBLICATION supabase_realtime ADD TABLE documents` — odłożone do post-MVP collab. Architektura store'a (Zustand slice'y) gotowa strukturalnie, ale baza nie potrzebuje publikacji bez aktywnej współpracy.

### 5.11 Samodokumentacja przez `COMMENT ON`

Migracja zawiera:
- `COMMENT ON TABLE` per każda tabela (krótki opis).
- `COMMENT ON COLUMN` dla pól non-obvious: `paddle_customer_snapshot`, `share_token`, `share_token_expires_at`, `schema_version`, `current_consent_version`, `paddle_customer_id`, `payload`.

Wykorzystywane przez Supabase Studio i `supabase gen types typescript`.

### 5.12 Greenfield migracja `20260507000000_complete_schema.sql` (Opcja C — czysty CREATE)

Kolejność operacji w pliku (zgodna z komentarzami `step` w SQL):
1. **Funkcje bazowe** — `set_updated_at()`, `handle_new_user()` (`SECURITY DEFINER SET search_path = ''`).
2. **Tabele** w kolejności rodzice → dzieci: `user_profiles → documents → subscriptions → consent_log → webhook_events`.
3. **Indeksy** (w tym pełny B-tree `documents_schema_version_idx` na `schema_version`).
4. **Funkcje biznesowe**: `effective_plan`, `refresh_user_plan_from_subscriptions`, `trg_subscriptions_refresh_plan`, `refresh_expired_plans`, `check_free_project_limit`, `block_protected_columns_update`, `sync_schema_version_from_data`, `sync_paddle_customer`.
5. **Triggery** (`on_auth_user_created` na `auth.users` oraz triggery na tabelach `public.*`).
6. **RLS** `ENABLE` + polityki (per-tabela per-operacja; `webhook_events` bez polityk = service_role only).
7. **`COMMENT ON`** dla samodokumentacji (`supabase gen types`, Studio).

**Brak `DROP IF EXISTS`** — czysty CREATE (decyzja końcowa: Opcja C, v2 z `supabase-migration-modifications.md` z 2026-05-08). Aplikowanie na bazie z poprzednim 0001 wymaga `pnpm supabase db reset` (czyści lokalny stack łącznie z `auth.users` i `supabase_migrations.schema_migrations`). Migracja jest atomowa (jedna transakcja Supabase CLI). Pełne uzasadnienie wyboru tej formy oraz porównanie z odrzuconymi Opcjami A (DROP IF EXISTS + CREATE) i B (podmiana `0001_init.sql`) — w `.ai/supabase-migration-modifications.md`.

### 5.12a Migracje inkrementalne post-greenfield

Po pierwszej greenfield migracji `20260507000000_complete_schema.sql` zastosowano trzy poprawkowe migracje:

- **`20260508000000_record_consent_bundle.sql`** — funkcja `record_consent_bundle()` (`SECURITY DEFINER`) dla atomowego bundle insert do `consent_log` + UPDATE `user_profiles.current_consent_version` w jednej transakcji (rozwiązanie code-doc-v5 §2.7).
- **`20260509000000_paddle_webhook_hardening.sql`** — trzy zmiany:
  1. Nowa funkcja `lookup_user_id_by_email(p_email TEXT) RETURNS UUID` (service_role only) — skaluje email→user_id lookup w paddle webhook, zastępuje paginowane `auth.admin.listUsers` (code-doc-v6 §1.1).
  2. Zaktualizowany `block_protected_columns_update()` — dodany bypass `current_user = 'postgres'` przed istniejącym `auth.role() = 'service_role'`. Pozwala `SECURITY DEFINER` funkcjom (`record_consent_bundle`, `refresh_user_plan_from_subscriptions`, `sync_paddle_customer`) zapisywać do chronionych kolumn bez dodatkowych obejść (code-doc-v6 §2.5).
  3. Zaktualizowany `trg_subscriptions_refresh_plan()` + trigger `subscriptions_after_iu_refresh_plan` (`OF status, current_period_end, user_id` zamiast `OF status, current_period_end`). Recovery orphan recordów — refresh wykonywany dla `OLD.user_id` i `NEW.user_id`, gdy te się różnią (code-doc-v6 §1.2).
- **`20260510000000_fix_consent_version_comment.sql`** — reissuuje `COMMENT ON COLUMN public.user_profiles.current_consent_version` z poprawnym opisem source of write (klient sesji w `/api/consent` route handler + RPC `record_consent_bundle()` wykonująca się jako rola `postgres`, nie `service_role`). Naprawia `pg_description` widoczne w Supabase Studio i potencjalnie w `supabase gen types` — rozwiązanie code-doc-v9 §1.1.

Każda kolejna zmiana schematu/funkcji jest dodawana jako nowa migracja `YYYYMMDDHHmmss_short_description.sql` zgodnie z `db-supabase-migrations.md`.

### 5.13 Kompatybilność ze stackiem

| Element stacku | Decyzja schematu |
|---|---|
| `@supabase/supabase-js` | Wszystkie operacje przez SDK + RLS; `service_role` w `app/api/paddle/webhook/route.ts` oraz `app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts`. `app/api/consent/route.ts` używa **klienta sesji** (`createClient` z `@supabase/ssr`) — RPC `record_consent_bundle()` jest `SECURITY DEFINER` i wykonuje się jako rola `postgres` (właściciel funkcji), nie `service_role`; `SUPABASE_SERVICE_ROLE_KEY` nie jest tu potrzebny. |
| `@supabase/ssr` | Cookies-based session w `src/proxy.ts` + RPC do `effective_plan` przy bootstrapie konta |
| Generowanie typów (`supabase gen types typescript`) | `TEXT + CHECK` zamiast `ENUM` — lepiej mapuje się na unie literałów TS |
| PRD §3.10 (GDPR) | EU-Frankfurt, anonimizacja IP, hard delete |
| `engines.node 22.x` | Nie wpływa na schemat |
| Vercel `fra1` | Cron jobs `/api/cron/expire-subscriptions`, `/api/cron/cleanup-webhook-events` |

### 5.13a Środowiska — email confirmations (dev vs prod)

Polityka RLS na `documents` wymaga `auth.users.email_confirmed_at IS NOT NULL`, więc skuteczność tej ochrony zależy od konfiguracji potwierdzenia emaila w GoTrue (Supabase Auth):

| Środowisko | `enable_confirmations` | Skutek dla `email_confirmed_at` | Czy polityka chroni przed nieaktywnym kontem? |
|---|---|---|---|
| Dev (lokalna baza, `supabase/config.toml`) | `false` | Auto-set na `now()` przy `auth.signUp()` | **NIE** — auto-confirm bypassuje ochronę. Dev wygodny, ale nie da się lokalnie odtworzyć ścieżki niepotwierdzonego konta. |
| Produkcja (Supabase Cloud) | **MUSI być `true`** | `NULL` do momentu kliknięcia linka weryfikacyjnego | TAK — niepotwierdzone konto nie zapisze projektu. |

**Production deploy guardrail:**
- Supabase Cloud → Auth → Settings → **Enable email confirmations = ON**.
- **Confirm email change = ON** (analogicznie dla zmiany emaila w trakcie życia konta).
- **Custom SMTP** (np. Resend, Postmark) skonfigurowany przed pierwszą rejestracją produkcyjną — bez SMTP confirmation maile nie wyjdą i rejestracja będzie zablokowana.
- Bez tej konfiguracji polityka RLS `documents` jest faktycznie bez efektu (auto-confirm), co maskuje `false sense of security`.

Lokalny `supabase/config.toml` zostaje na `enable_confirmations = false` (Inbucket nie jest wymagany do testów rejestracji w MVP); dokument zachowuje świadomość rozjazdu między dev a prod.

### 5.14 Otwarte tematy poza zakresem schematu

(do rozwiązania przy implementacji odpowiednich feature'ów; schemat nie blokuje)

1. ✅ ~~**Timing crona `cleanup-webhook-events`**~~ — domknięte: `0 2 * * 0` (niedziela 02:00 UTC); źródło: `tech-stack.md` §12 + `vercel.json`.
2. **Runtime migracja `data` JSONB między `schemaVersion`** — w `documentCodec.ts` (kod aplikacji); schemat wykrywa stare projekty przez pełny B-tree `documents_schema_version_idx` (skan po `schema_version < N` przy bumpie codec'a).
3. **Tier Supabase/Vercel** — założono Pro (Vercel Cron, region pinning); weryfikacja przy wyborze planów.
4. **RLS dla `share_token` (anon read)** — post-MVP, nowa migracja gdy feature ruszy.
5. **Format `version` w `consent_log`** — decyzja prawno-organizacyjna (semver / data / hash treści).
6. ✅ ~~**Endpoint `/api/user/export` (RODO art. 20)**~~ — kontrakt domknięty w `api-plan.md` §2.1 (`GET /api/user/export`); implementacja Route Handlera TODO.
7. **`lib/ipAnonymize.ts`** — kontrakt zamknięty w `api-plan.md` §2.1 (anonimizacja IP po stronie serwera, motyw 30 RODO); implementacja helpera + test jednostkowy TODO (Vitest, coverage 80% z thresholds).
8. **Mapping `'project_limit_exceeded' → klucz next-intl`** — `src/messages/{pl,en}.json`.
9. ✅ ~~**Handler kolejności webhooków Paddle**~~ — kontrakt lookupu domknięty w `api-plan.md` §2.1 (4-stopniowa kaskada: `customData.user_id` → `paddle_customer_id` → email z payloadu → log warning); implementacja `app/api/paddle/webhook/route.ts` TODO.
10. **Kolumna `thumbnail`/`preview` w `documents`** — odłożona do post-MVP, dorzucona migracją.
11. **PITR/RTO/RPO** — Supabase managed; własna strategia post-MVP.
