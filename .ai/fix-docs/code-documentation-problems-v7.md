# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v7)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 7.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, `.ai/code-documentation-problems-v6.md`, kod w `src/`, `supabase/migrations/{20260507000000_complete_schema, 20260508000000_record_consent_bundle, 20260509000000_paddle_webhook_hardening}.sql`, `supabase/config.toml`, `vercel.json`, `.github/workflows/ci.yml`, `scripts/verify-routes.sh`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig.json`, `next.config.ts`, `CLAUDE.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation domeny shape'ów. Warstwa API (5 Route Handlerów) zaimplementowana. Dodano migrację `20260509000000_paddle_webhook_hardening.sql`, która naprawia większość 🔴 z v6 (skalowanie lookup'u w paddle webhook + recovery orphan recordów + bypass `block_protected_columns_update` dla `SECURITY DEFINER`). Logika domeny (shapes, weld-units, store slices, components canvas) wciąż nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v6

| # v6 | Tytuł | Status (v7) | Komentarz |
|---|---|---|---|
| 1.1 | Paddle webhook `lookupUserId` — 200-user limit | ✅ **Naprawione** | Migracja `20260509000000_paddle_webhook_hardening.sql` wprowadziła `public.lookup_user_id_by_email(p_email)` (`SECURITY DEFINER`, `service_role only`); webhook (linia 252) używa `supabase.rpc('lookup_user_id_by_email', ...)`. Skaluje się do dowolnej liczby użytkowników. |
| 1.2 | Orphan `subscriptions.user_id = NULL` recovery | ✅ **Naprawione** | Migracja `20260509000000` zmieniła trigger `subscriptions_after_iu_refresh_plan` na `OF status, current_period_end, user_id` + `trg_subscriptions_refresh_plan` odświeża plan **zarówno dla `OLD.user_id`** (gdy zmienił się), **jak i `NEW.user_id`**. Manualny `UPDATE subscriptions SET user_id = ...` poprawnie aktualizuje `user_profiles.plan`. |
| 1.3 | `pnpm verify:routes` nie wpięte w CI | ✅ **Naprawione** | `.github/workflows/ci.yml:35` dodało `- run: pnpm verify:routes` w jobie `lint-and-typecheck`. Hard-stop merge przy regresji route handlerów. |
| 2.1 | `count: 'exact'` na INSERT + dead branch | ✅ **Naprawione** | `webhook/route.ts:135-155` używa `upsert + ignoreDuplicates`; pusta tablica wynikowa = duplikat. Bez fragile `error.code === '23505'` matchingu. |
| 2.2 | `processed_at` UPDATE non-atomic z dispatchem | ✅ **Naprawione** | `webhook/route.ts:117-127` — dispatch (subscription/customer event) **przed** insertem do `webhook_events`; `processed_at` ustawiane w jednym INSERT z idempotency markerem. Cicha utrata zdarzeń przy częściowej awarii wyeliminowana. |
| 2.3 | `Point` cykl typowy canvas-kit ↔ shapes/_base | ✅ **Naprawione** | `Point` przeniesiony do `src/canvas-kit/primitives.ts:20-23`; `src/shapes/_base/types.ts:8-12` re-eksportuje go z `@/canvas-kit`. Kierunek geometria → domena (zgodnie z §22.7). |
| 2.4 | Limit elementów Free/Guest — brak DB enforcement | 🟢 **Świadomie odroczone (udokumentowane)** | `db-plan.md` §5.3a (linie 337–354) jawnie dokumentuje brak triggera + propozycję post-MVP. Akceptowalne dla MVP. |
| 2.5 | `record_consent_bundle` blocked by `block_protected_columns_update` | ✅ **Naprawione** | Migracja `20260509000000` rozszerzyła `block_protected_columns_update`: dodała bypass `current_user = 'postgres'` (rola owner'a wykonującej `SECURITY DEFINER` funkcji). Komentarz w migracji 20260508 jasno tłumaczy zależność (linie 9–13). |
| 2.6 | `architecture-base.md` §15 duplikuje DDL | ✅ **Naprawione** | §15 (linie 1133–1169) zawiera teraz wyłącznie diagram + listę tabel + cross-reference do `db-plan.md`. Brak duplikatu DDL. |
| 2.7 | `pnpm supabase:types:local` skrypt | ✅ **Naprawione** | `package.json:21` ma `supabase:types:local`; `CLAUDE.md` linia 30 udokumentowała różnicę REMOTE vs LOCAL. |
| 3.1 | `consent_log.ip_address: unknown` w generowanych typach | 🟢 **Wciąż OK** | Workaround udokumentowany; wrapper potrzebny dopiero przy pierwszym SELECT z `ip_address`. |
| 3.2 / 3.3 | E2E smoke / `vitest-canvas-mock` weak assertions | 🟢 **Wciąż OK** | Bez zmian. |
| 3.4 | Paddle webhook brak `console.warn` przy orphan lookup | ✅ **Naprawione** | `webhook/route.ts:183-189, 217-223` — dodane `console.warn(...)` z `eventId`, `eventType`, `customerId`, `email` dla obu typów eventów. |
| 3.5 | JSON.parse fail → `'invalid_signature'` zamiast `'invalid_payload'` | ✅ **Naprawione (Opcja B)** | `webhook/route.ts:103` — zostaje kod `invalid_signature`, ale dodano `message: 'malformed JSON in payload'` dla diagnostyki. |
| 3.6 | Komentarz "kanoniczne źródło: src/shapes/_base/types.ts" | ✅ **Naprawione** | `architecture-base.md` §22.1 (linia 1430–1432) jawnie tłumaczy: „kierunek zależności geometria → domena, nie odwrotnie". |
| 3.7 | `tech-stack.md` §6 brak `withNextIntl` w przepisie | ✅ **Naprawione** | `tech-stack.md` linie 102–117 zawiera pełen przepis z `createNextIntlPlugin` + `export default withNextIntl(config)`. |
| 3.8 | Alphabetical trigger ordering — brak konwencji w `db-plan.md` | ✅ **Naprawione** | `db-plan.md` §5.7 (linia 405) dodało paragraf „Kolejność triggerów (PostgreSQL alfabetyczna)" z przykładem `b... < s...` dla `block_protected` przed `set_updated_at`. |
| 3.9 | `vitest.config.ts` `include` pattern | ✅ Bez zmian | Spójne z dokumentacją. |

**Wniosek:** **15 z 17 problemów v6 naprawionych** (vs 14/16 v5 → v6). Pozostałe 2 to świadome workaroundy (3.1) i akceptowalne stany pre-implementation (3.2 / 3.3). Migracja `20260509000000_paddle_webhook_hardening.sql` rozwiązuje wszystkie 3 🔴 z v6 jednocześnie. Najwartościowszy delta v6 → v7: zamknięcie ścieżek cichego błędu w paddle webhook (skalowanie + atomowość + recovery) i hardening `block_protected_columns_update`.

Poniżej: **nowe problemy zidentyfikowane w v7** — większość z nich to **dryf dokumentacji** względem migracji `20260509000000`, której zawartość nie została odzwierciedlona w `db-plan.md`/`api-plan.md`/`CLAUDE.md`.

---

## 1. 🔴 Krytyczne

### 1.1 (NOWY) `CLAUDE.md` jest istotnie nieaktualny — opisuje stan sprzed implementacji warstwy API i `ipAnonymize`

**Problem:**

`CLAUDE.md` linia 9:

```
**Currently implemented in `src/lib/`:** `snapEngine.ts` (stub with pure-function signatures); `supabase/{client,server,middleware}.ts` (the three Supabase client variants per `tech-stack.md` §7). Architecture §3 lists future helpers (`documentCodec.ts`, `captureGeometry.ts`, `shapeBounds.ts`, `exportEngine.ts`, `overlapDetector.ts`, `ipAnonymize.ts`) — none implemented yet. Only `src/app/api/health/route.ts` exists; the cron, paddle webhook, consent, and user/export handlers (`api-plan.md` §2.1) are still TODO.
```

**Stan faktyczny (weryfikacja `find /Users/.../src -type f`):**

- `src/lib/ipAnonymize.ts` **istnieje** (95 linii, pełna implementacja IPv4 `/24` + IPv6 `/48`).
- `src/lib/ipAnonymize.test.ts` **istnieje** (test jednostkowy co-locowany).
- Wszystkie 5 Route Handlerów w `src/app/api/` **istnieje:**
  - `consent/route.ts` (149 linii)
  - `cron/cleanup-webhook-events/route.ts`
  - `cron/expire-subscriptions/route.ts`
  - `health/route.ts`
  - `paddle/webhook/route.ts` (258 linii)
  - `user/export/route.ts`

CLAUDE.md przedstawia stan **z połowy v5** (przed implementacją API + `ipAnonymize`). Wszystkie te zmiany weszły w v5→v6 i v6→v7, a CLAUDE.md nie został zaktualizowany.

**Konsekwencje:**

- 🔴 **CLAUDE.md jest pierwszym plikiem czytanym przez agenta przy każdej nowej sesji** (auto-injected w system prompcie). Każda przyszła sesja Claude Code dostaje na wejściu fałszywy obraz stanu projektu — co prowadzi do:
  - Sugestii „dodać brakujący `/api/consent`" (już istnieje).
  - Implementowania `ipAnonymize.ts` od nowa (już ma testy + użycie w handlerze).
  - Niewłaściwej oceny gdzie szukać błędów (np. „handler nie istnieje" zamiast „w handlerze jest bug").
- Reszta CLAUDE.md (architecture invariants, conventions, hooks) jest poprawna — to specyficznie sekcja „Project state" jest stale.

**Rozwiązanie:**

Zaktualizować `CLAUDE.md` linie 7–9 do odzwierciedlenia obecnego stanu:

```markdown
**Currently implemented in `src/lib/`:** `snapEngine.ts` (stub with pure-function signatures);
`supabase/{client,server,middleware}.ts` (the three Supabase client variants per `tech-stack.md` §7);
`ipAnonymize.ts` (RODO IPv4 `/24` + IPv6 `/48` — used by `/api/consent`); contract test
`tests/store/shape-update-contract.test.ts` (CI gate for `AllShapeGeometry` scaffold).
Architecture §3 lists future helpers (`documentCodec.ts`, `captureGeometry.ts`, `shapeBounds.ts`,
`exportEngine.ts`, `overlapDetector.ts`) — none implemented yet.

All 5 Route Handlers exist (`api-plan.md` §2.1):
- `src/app/api/health/route.ts`
- `src/app/api/consent/route.ts` (uses RPC `record_consent_bundle`)
- `src/app/api/user/export/route.ts`
- `src/app/api/paddle/webhook/route.ts` (HMAC verify, idempotent upsert, dispatch-before-marker)
- `src/app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts`

Three Supabase migrations are applied: `20260507000000_complete_schema.sql`,
`20260508000000_record_consent_bundle.sql`, `20260509000000_paddle_webhook_hardening.sql`.
Domain layer (shapes, weld-units, store slices, canvas components) is not yet implemented.
```

**Rekomendacja:** **Pilne** — drobna edycja, ale eliminuje powtarzający się footgun przy każdej nowej sesji Claude. ~10 minut roboczogodzin, 1 PR.

---

### 1.2 (NOWY) `db-plan.md` §4.7 nie wymienia `lookup_user_id_by_email` ani zmienionej semantyki `block_protected_columns_update` po migracji `20260509`

**Problem:**

Migracja `20260509000000_paddle_webhook_hardening.sql` wprowadziła **dwie nowe lub zmienione funkcje** + **jedną zmienioną definicję triggera**, ale `db-plan.md` §4.7 (lista funkcji `SECURITY DEFINER`) nie odzwierciedla żadnej z tych zmian.

**Brakujące w `db-plan.md`:**

1. **Funkcja `public.lookup_user_id_by_email(p_email TEXT) RETURNS UUID`** (linie 25–41 migracji) — `SECURITY DEFINER`, `service_role only` (jawne `revoke execute ... from public; grant execute ... to service_role`). Wywołana z `paddle/webhook/route.ts:252`. Nie istnieje w `db-plan.md` §4.7 (linie 297–308) — lista kończy się na `record_consent_bundle()`.

2. **Zaktualizowana funkcja `public.block_protected_columns_update()`** (linie 60–81 migracji) — dodano bypass `if current_user = 'postgres' then return new; end if;` przed istniejącym sprawdzaniem `auth.role() = 'service_role'`. Krytyczne dla:
   - `record_consent_bundle()` (`SECURITY DEFINER`) → UPDATE `user_profiles.current_consent_version`.
   - `refresh_user_plan_from_subscriptions()` → UPDATE `user_profiles.plan`.
   - `sync_paddle_customer()` → UPDATE `user_profiles.paddle_customer_id`.
   
   `db-plan.md` §1.2 linia 34 dokumentuje **starą semantykę**: „gdy rola JWT ≠ `service_role`" (tylko jeden bypass). Nie wspomina o `current_user = 'postgres'`.

3. **Zaktualizowany `trg_subscriptions_refresh_plan()`** (linie 94–112 migracji) — dodano refresh dla **`OLD.user_id`** gdy `tg_op = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id`. Naprawia recovery orphan recordów (poprzednia implementacja refreshowała tylko `NEW.user_id`).

4. **Zaktualizowany trigger `subscriptions_after_iu_refresh_plan`** (linie 114–117 migracji) — dodano `user_id` do listy kolumn `OF status, current_period_end, user_id`. `db-plan.md` §1.4 linia 84 wciąż mówi `OF status, current_period_end` (bez `user_id`).

5. **Cała migracja `20260509000000`** nie jest wymieniona w `db-plan.md` §5.12 (Greenfield migracja) — sekcja kończy się na opisie pierwszej migracji `20260507000000`.

**Konsekwencje:**

- 🔴 **Implementator czytający `db-plan.md`** nie wie, że:
  - Może wywołać RPC `lookup_user_id_by_email` z webhook handlera (lub innego service-role endpointu) i zna jego sygnaturę.
  - `SECURITY DEFINER` funkcje, które piszą do chronionych kolumn `user_profiles`, **już nie wymagają** dodatkowych obejść (przed migracją `20260509` wymagałyby `set_config('request.jwt.claims', ...)` lub innego hacka).
  - Manualne łatanie orphan `subscriptions.user_id` przez `UPDATE` **automatycznie odświeża** `user_profiles.plan` (przed migracją `20260509` wymagałoby ręcznego `SELECT public.refresh_user_plan_from_subscriptions(uid)`).
- 🟡 Migracja `20260509000000` jest „niewidoczna" w dokumentacji projektu — przegląd `db-plan.md` sugeruje, że jest jedna migracja schematu + jedna migracja consent bundle. Operations team przy postmortemie sięgnie po `db-plan.md` i nie zobaczy zmian.

**Rozwiązanie:**

Dopisać do `db-plan.md`:

**§1.2 linia 34** — zaktualizować akapit „Trigger ochrony kolumn":

```markdown
**Trigger ochrony kolumn:** `user_profiles_before_update_block_protected` —
funkcja `block_protected_columns_update()` zeruje zmiany pól `plan`,
`paddle_customer_id` oraz `current_consent_version` (`NEW.<col> := OLD.<col>`)
gdy żaden z dwóch warunków bypass nie jest spełniony:
1. `current_user = 'postgres'` — rola owner'a wykonującego `SECURITY DEFINER`
   funkcję (np. `record_consent_bundle()`, `refresh_user_plan_from_subscriptions()`,
   `sync_paddle_customer()`). Zapis do chronionych kolumn z poziomu DB-side
   funkcji jest dozwolony bez dodatkowych zabiegów.
2. `auth.role() = 'service_role'` — bezpośredni klient admin (paddle webhook,
   crony) z `SUPABASE_SERVICE_ROLE_KEY`.

Defensywny `COALESCE(auth.role(), 'anon')` chroni przed nullowym `auth.role()`
w surowym `psql` / testach jednostkowych. Bypass `current_user = 'postgres'`
był dodany w migracji `20260509000000_paddle_webhook_hardening.sql` po
problemie code-doc-v6 §2.5 (`record_consent_bundle` nie aktualizował
`current_consent_version` z poziomu wywołania `authenticated`).
```

**§1.4 linia 84** — zaktualizować trigger `subscriptions_after_iu_refresh_plan`:

```markdown
- `subscriptions_after_iu_refresh_plan` — `AFTER INSERT OR UPDATE OF
  status, current_period_end, user_id` — funkcja `trg_subscriptions_refresh_plan()`
  przelicza `effective_plan(uid)` i zapisuje do `user_profiles.plan` przez
  `refresh_user_plan_from_subscriptions(uid)` (`SECURITY DEFINER`).
  Recovery orphan recordów: gdy `OLD.user_id IS DISTINCT FROM NEW.user_id`,
  refresh wykonywany jest **dla obu** wartości — naprawia stale plan
  poprzedniego właściciela rekordu. Migracja: `20260509000000_paddle_webhook_hardening.sql`.
```

**§4.7** — dodać do listy:

```markdown
- `public.lookup_user_id_by_email(p_email TEXT) RETURNS UUID` — `STABLE`,
  `SECURITY DEFINER`, `service_role only` (`REVOKE EXECUTE FROM public;
  GRANT EXECUTE TO service_role`). Mapuje email na `auth.users.id`.
  Wykorzystywane przez `paddle/webhook` lookupUserId (4. priorytet:
  customData → paddle_customer_id → email RPC → null + warning).
  Skaluje się do dowolnej liczby użytkowników (zastępuje `auth.admin.listUsers`
  paginowane do 200 — code-doc-v6 §1.1).
  Migracja: `20260509000000_paddle_webhook_hardening.sql`.
```

**§5.12 (Greenfield migracja)** — dodać akapit o migracjach inkrementalnych:

```markdown
### 5.12a Migracje inkrementalne post-greenfield

Po pierwszej greenfield migracji `20260507000000_complete_schema.sql`
zastosowano dwie poprawkowe migracje:

- `20260508000000_record_consent_bundle.sql` — funkcja `record_consent_bundle()`
  dla atomowego bundle insert + UPDATE `current_consent_version`
  (rozwiązanie code-doc-v5 §2.7).
- `20260509000000_paddle_webhook_hardening.sql` — funkcja `lookup_user_id_by_email()`,
  zaktualizowany `block_protected_columns_update()` (bypass `current_user = 'postgres'`),
  zaktualizowany `trg_subscriptions_refresh_plan()` + trigger
  (refresh OLD.user_id, OF user_id) (rozwiązanie code-doc-v6 §1.1, §1.2, §2.5).

Każda kolejna zmiana schematu/funkcji jest dodawana jako nowa migracja
`YYYYMMDDHHmmss_short_description.sql` zgodnie z `db-supabase-migrations.md`.
```

**Rekomendacja:** **Pilne**. Dryf dokumentacji vs migracji jest cichym problemem — obecny czytelnik `db-plan.md` **nie zobaczy**, że trigger został zmieniony, dopóki nie sięgnie po SQL. Kosztorys: ~30 minut.

---

## 2. 🟡 Istotne

### 2.1 (NOWY) `api-plan.md` §2.1 lookup priority opisuje SQL bezpośrednio na `auth.users` — implementacja używa RPC `lookup_user_id_by_email`

**Problem:**

`api-plan.md` §2.1 (linie 100–104) — sekcja „Lookup użytkownika":

```
1. `payload.data.customData.user_id` — przekazywane z Paddle Checkout
2. Fallback: `user_profiles WHERE paddle_customer_id = payload.data.customer.id`
3. Fallback: `auth.users WHERE email = payload.data.customer.email`
4. Jeśli user nie znaleziony → zapisz `webhook_event`, zaloguj warning, zwróć 200
```

Krok 3 mówi „auth.users WHERE email = ..." — sugeruje, że można po prostu zapytać `auth.users` bezpośrednio przez SDK supabase-js (PostgREST). Faktycznie:

- `auth.users` **nie jest wystawione** przez PostgREST domyślnie (`config.toml` `[api].schemas = ["public", "graphql_public"]` — bez `auth`).
- Implementacja `webhook/route.ts:246-254` używa RPC `supabase.rpc('lookup_user_id_by_email', { p_email: email })` — funkcja `SECURITY DEFINER` z migracji `20260509000000`, która jest opakowaniem na `auth.users`.

**Konsekwencje:**

- 🟡 Implementator czytający spec może próbować zapisać `await supabase.from('users', { schema: 'auth' }).select('id').eq('email', email).single()` — i otrzyma `relation "auth.users" does not exist` (PostgREST nie widzi schematu `auth`).
- Nowy developer próbujący zrozumieć kontrakt webhook'a nie wie, że istnieje dedykowana funkcja DB do tego lookup'u — może zaczepić się o pierwszą interpretację specu i marnować czas.
- Brak cross-reference między `api-plan.md` §2.1 a migracją `20260509000000` lub `db-plan.md` §4.7 (sama §4.7 też nie wymienia `lookup_user_id_by_email` — patrz §1.2 v7).

**Rozwiązanie:**

Zaktualizować `api-plan.md` §2.1 sekcja „Lookup użytkownika":

```markdown
**Lookup użytkownika (kolejność priorytetów):**
1. `payload.data.customData.user_id` — przekazywane z Paddle Checkout
   (`customData: { user_id }`)
2. Fallback: `user_profiles WHERE paddle_customer_id = payload.data.customer.id`
   (przez SDK supabase-js)
3. Fallback: `RPC public.lookup_user_id_by_email(p_email)` — `SECURITY DEFINER`,
   `service_role only` (migracja `20260509000000_paddle_webhook_hardening.sql`).
   `auth.users` NIE jest wystawiona przez PostgREST — bezpośrednie zapytanie
   `from('users', { schema: 'auth' })` zwraca `relation does not exist`.
   Implementacja: `webhook/route.ts:246-254`.
4. Jeśli user nie znaleziony → zapisz `webhook_event`, zaloguj warning,
   zwróć 200 (webhook może przyjść przed rejestracją; `subscriptions.user_id`
   pozostaje NULL — recovery przez manualny UPDATE później).
```

**Rekomendacja:** drobna poprawka w obecnej iteracji. Ułatwia onboarding implementatora kolejnych route handlerów.

---

### 2.2 (NOWY) `db-plan.md` RLS policies używają konwencji `_self_*`/`_owner_*`, migracje używają `_authenticated` suffix — drift między spec'em a kodem

**Problem:**

`db-plan.md` §4 zawiera literalne `CREATE POLICY` z nazwami:

| Polityka w `db-plan.md` | Lokalizacja |
|---|---|
| `documents_owner_all` | §4.2 linia 209 |
| `user_profiles_self_select` | §4.3 linia 235 |
| `user_profiles_self_update` | §4.3 linia 239 |
| `subscriptions_owner_select` | §4.4 linia 252 |
| `consent_log_owner_select` | §4.5 linia 264 |
| `consent_log_owner_insert` | §4.5 linia 268 |

Migracja `20260507000000_complete_schema.sql` używa **innych nazw** (zgodnych z konwencją z `db-supabase-migrations.md` §38–41 „granular per-rola"):

| Polityka w migracji | Linia |
|---|---|
| `documents_owner_all` | 454 ✅ (jedyna spójna) |
| `user_profiles_select_authenticated` | 429 |
| `user_profiles_update_authenticated` | 437 |
| `subscriptions_select_authenticated` | 478 |
| `consent_log_select_authenticated` | 490 |
| `consent_log_insert_authenticated` | 497 |

`api-plan.md` §2.1 linia 187 używa nazwy z migracji (`consent_log_insert_authenticated`), więc dryf jest **wewnątrz** dokumentacji (`db-plan.md` ↔ `api-plan.md`), nie tylko między dokumentacją a kodem.

**Konsekwencje:**

- 🟡 Operations team analizujący problem RLS (np. „dlaczego mój INSERT do `consent_log` jest blokowany?") sięga po `db-plan.md`, znajduje `consent_log_owner_insert` — szuka tej nazwy w `pg_policies` i nie znajduje. Marnuje czas na podejrzenie braku polityki.
- Migracje w przyszłości — nowy developer dodający politykę dla `share_token` (post-MVP, `db-plan.md` §5.14) skopiuje konwencję z `db-plan.md` (`documents_anon_share_token_select` → poprawne) lub `_owner_share_token_select` (niespójne z istniejącą migracją). Wybór konwencji per-PR utrudnia code review.
- `db-supabase-migrations.md` §38-41 jest **konwencją projektową** — wymaga `granular per-rola`, co implikuje suffix `_authenticated`/`_anon`/`_service_role`. Migracja jest zgodna, `db-plan.md` nie.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zaktualizować `db-plan.md` §4.x do **dokładnych nazw z migracji**. Zmiana mechaniczna (~6 linii):

```diff
-CREATE POLICY user_profiles_self_select ON public.user_profiles
+CREATE POLICY user_profiles_select_authenticated ON public.user_profiles
   FOR SELECT TO authenticated
   USING (id = auth.uid());

-CREATE POLICY user_profiles_self_update ON public.user_profiles
+CREATE POLICY user_profiles_update_authenticated ON public.user_profiles
   FOR UPDATE TO authenticated
   ...

-CREATE POLICY subscriptions_owner_select ON public.subscriptions
+CREATE POLICY subscriptions_select_authenticated ON public.subscriptions
   ...

-CREATE POLICY consent_log_owner_select ON public.consent_log
+CREATE POLICY consent_log_select_authenticated ON public.consent_log
   ...

-CREATE POLICY consent_log_owner_insert ON public.consent_log
+CREATE POLICY consent_log_insert_authenticated ON public.consent_log
   ...
```

**Opcja B:** rename'ować polityki w migracji do nazw z `db-plan.md`. Wymaga nowej migracji `2026XXXX_rename_policies.sql` (`DROP POLICY ... CREATE POLICY ...`). Dla MVP brak korzyści — semantyka identyczna, koszt vs zysk niekorzystny.

**Rekomendacja:** Opcja A. Dokumentacja goni kod (kod jest prawdą), zachowuje konwencję `db-supabase-migrations.md` §38-41.

---

### 2.3 (NOWY) `consent` route handler — bundle response SELECT race przy szybkich powtórnych wywołaniach

**Problem:**

`src/app/api/consent/route.ts:92-105`:

```typescript
const { data: inserted, error: selectError } = await supabase
  .from('consent_log')
  .select('id, consent_type, version, accepted, accepted_at')
  .eq('user_id', user.id)
  .eq('version', bundleBody.version)
  .in('consent_type', bundleBody.types)
  .order('accepted_at', { ascending: false })
  .limit(bundleBody.types.length);
```

Po RPC `record_consent_bundle()` (która wstawia 3 wiersze atomowo), handler robi **drugie zapytanie SELECT**, by zwrócić `inserted: [...]` w response body. Filtr: `user_id = auth.uid() AND version = X AND consent_type IN (...)`.

**Edge case:** użytkownik wywołuje `/api/consent` szybko (np. dwukrotne kliknięcie przycisku zgody w UI):

1. **Request A:** `record_consent_bundle(version='1.0', accepted=true)` → 3 wiersze z `accepted=true`.
2. **Request B (rozpoczyna się równolegle):** `record_consent_bundle(version='1.0', accepted=true)` → kolejne 3 wiersze z `accepted=true`.
3. SELECT w request A z `LIMIT 3 ORDER BY accepted_at DESC` może zwrócić **mix wierszy** z A i B, jeśli `accepted_at` (DEFAULT now()) generuje wartości w mikrosekundowych różnicach.

Praktycznie: SELECT zwraca 3 najnowsze wiersze z (accepted, version), więc:
- Jeśli A i B wstawiły w tej samej milisekundzie — SELECT może wziąć 2 wiersze z B + 1 z A.
- Identyfikatory `id` w response body nie odpowiadają wierszom wstawionym przez **konkretny request**.

**Konsekwencje:**

- 🟡 Klient otrzymuje response z `inserted[].id` które mogą nie być id wierszy wstawionych przez **ten** request. Dla MVP to bez znaczenia (klient nie używa tych id), ale dla audytu RODO art. 7 ust. 1 może być mylące.
- Spec `api-plan.md` §2.1 odpowiedź (linie 141–151) implikuje 1:1 mapping request → response.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zmienić sygnaturę `record_consent_bundle()` na `RETURNS SETOF consent_log` — RPC zwraca wstawione wiersze bezpośrednio. Eliminuje second-trip + race window:

```sql
-- nowa migracja: 2026XXXX_consent_bundle_returns.sql
create or replace function public.record_consent_bundle(...)
returns setof public.consent_log
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ... walidacja jak wcześniej

  return query
  insert into public.consent_log (...)
  values (...), (...), (...)
  returning *;

  if p_accepted then
    update public.user_profiles set ... where id = p_user_id;
  end if;
end;
$$;
```

Handler uproszczony do:
```typescript
const { data: inserted } = await supabase.rpc('record_consent_bundle', {...});
return NextResponse.json({ inserted, current_consent_version: ... }, { status: 201 });
```

**Opcja B:** ignorować edge case — w UI debounce'ować przycisk zgody (zapobiega podwójnemu klikowi). Tańsze. Wystarczy w MVP, bo zgody odbywają się jednorazowo przy rejestracji + ewentualnie przy revocation w settings.

**Rekomendacja:** **Opcja B w MVP, Opcja A przed launch'em produkcyjnym.** Opcja A wymaga migracji DB; jeśli mamy okazję (np. przy następnej zmianie consent), zrobić obie.

---

### 2.4 (NOWY) `consent` route — odpowiedź dla `accepted: false` zwraca `current_consent_version: null` — niezgodne z semantyką dokumentacji

**Problem:**

`consent/route.ts:106-112`:

```typescript
return NextResponse.json(
  {
    inserted: inserted ?? [],
    current_consent_version: bundleBody.accepted ? bundleBody.version : null,
  },
  { status: 201 }
);
```

`api-plan.md` §2.1 linia 187:
> Per-type wycofanie zgody **nie modyfikuje** `current_consent_version` (kolumna nadal wskazuje na ostatnio zaakceptowany bundle — audyt rekonstruuje stan z `consent_log`).

Implementacja jest zgodna z migracją `20260508000000_record_consent_bundle.sql:62-66` — UPDATE wykonywany tylko gdy `p_accepted = true`. Dla revocation `current_consent_version` w bazie pozostaje **bez zmian** (np. wciąż `'1.0'` po wywołaniu z `accepted: false`).

Ale response body zwraca `current_consent_version: null` (gdy `accepted: false`) — co sugeruje klientowi, że **w bazie jest teraz `null`**. Poprawne semantyki to:
- `current_consent_version` w response = **aktualna wartość po operacji** (czyli odczyt z DB lub passthrough z bundle, gdy update się wydarzył).

**Konsekwencje:**

- 🟡 Klient odbierający response po revocation może odczytać `current_consent_version: null` i:
  - Zaktualizować lokalny state na „brak aktywnej zgody" — co jest niepoprawne: użytkownik nadal **ma** zaakceptowaną wersję, tylko wycofał ją (revocation = nowy wpis `accepted=false`).
  - Pokazać modal „Zaakceptuj zgodę" przy następnej akcji — co jest UX-błędem (użytkownik może nie chcieć ponownie się angażować).
- Architecture §14 linia 1107 mówi: „przy każdym zalogowaniu pobierz `user_profiles.current_consent_version`" — implikuje, że **DB jest source of truth**, nie response z `/api/consent`. Ale duplikacja sygnałów (`null` w response vs faktyczna wartość w DB) wprowadza dwoistość.

**Rozwiązanie:**

**Opcja A (zalecana):** zwrócić aktualną wartość z DB w response — niezależnie od `accepted`:

```typescript
const { data: profile } = await supabase
  .from('user_profiles')
  .select('current_consent_version')
  .eq('id', user.id)
  .single();

return NextResponse.json(
  {
    inserted: inserted ?? [],
    current_consent_version: profile?.current_consent_version ?? null,
  },
  { status: 201 }
);
```

Trzecie request do DB (po RPC i SELECT consent_log), ale zapewnia spójność.

**Opcja B:** doprecyzować spec — `current_consent_version` w response = wartość **po pomyślnym update** lub **`null` gdy update się nie wykonał** (semantyka „delta vs state"). Wymaga aktualizacji `api-plan.md` §2.1 linia 153 i edukacji klienta.

**Opcja C:** włączyć `current_consent_version` jako pole zwracane przez `record_consent_bundle()` (RPC RETURNS TABLE). Spina z §2.3 v7.

**Rekomendacja:** Opcja C jeśli przy okazji robimy refactor §2.3 (RPC RETURNING). W przeciwnym razie Opcja A — drobna zmiana, eliminuje semantyczny mismatch.

---

### 2.5 (NOWY) `webhook/route.ts:107-113` — niewykryty `event_id`/`event_type` zwraca `'invalid_signature'`, mylące diagnostycznie

**Problem:**

```typescript
const eventId = payload.event_id;
const eventType = payload.event_type;
const data = payload.data;

if (!eventId || !eventType || !data) {
  // Bez identyfikatora zdarzenia idempotencja nie działa — odrzucamy jako bad signature/payload.
  return err('invalid_signature', 400);
}
```

Komentarz mówi „bad signature/payload", ale kod błędu zwraca `invalid_signature`. Sygnatura webhook'a została **już zwalidowana** linijkę wyżej (`verifySignature(...)` linia 95). Brak `event_id` w body nie ma związku z weryfikacją podpisu.

Analogiczny problem do v6 §3.5 (rozwiązanego dla JSON.parse fail dodaniem `message: 'malformed JSON in payload'`). Tutaj dodano komentarz, ale **nie dodano `message`** rozróżniającego ten przypadek od faktycznego `invalid_signature`.

**Konsekwencje:**

- 🟢 W logach Vercel `400 invalid_signature` może oznaczać 3 rzeczy:
  1. Brak / zły format `paddle-signature` header → `missing_signature`.
  2. `verifySignature()` zwróciło `false` → `invalid_signature` (bez message).
  3. JSON.parse fail → `invalid_signature` + `message: 'malformed JSON in payload'`.
  4. **Brak `event_id` / `event_type` / `data`** → `invalid_signature` (bez message — nieodróżnialne od pkt 2!).

Diagnostyka problemu „dlaczego paddle webhooki padają z 400" wymaga dodania message w przypadku 4.

**Rozwiązanie:**

Dodać message diagnostyczny analogicznie do JSON.parse fail:

```diff
 if (!eventId || !eventType || !data) {
-  return err('invalid_signature', 400);
+  return err('invalid_signature', 400, 'missing event_id, event_type or data');
 }
```

Lub bardziej radykalnie — nowy kod błędu `'invalid_payload'`:

```diff
 if (!eventId || !eventType || !data) {
-  return err('invalid_signature', 400);
+  return err('invalid_payload', 400, 'missing event_id, event_type or data');
 }
```

I rozszerzyć `api-plan.md` §2.1 tabelę kodów błędów:

```diff
 | 400 | `{ "error": "missing_signature" }` — brak nagłówka |
 | 400 | `{ "error": "invalid_signature" }` — nieprawidłowy podpis |
+| 400 | `{ "error": "invalid_payload", "message": "..." }` — malformed JSON lub brak event_id/event_type/data |
 | 500 | `{ "error": "internal_error", "message": "..." }` — błąd DB |
```

Kompatybilne z v6 §3.5 fixem (JSON.parse też mógłby przejść z `invalid_signature` na `invalid_payload`).

**Rekomendacja:** drobna refaktoryzacja. Można wziąć przy okazji innej zmiany w handlerze.

---

### 2.6 (NOWY) `architecture-base.md` §22.6 ostrzeżenie o singleton CanvasShell — `setActiveStage` nadpisuje cicho

**Problem:**

`architecture-base.md` §22.6 (linia 1547) — opis ograniczenia obecnej implementacji:

> **Ograniczenie aktualnej implementacji (`impl-konva/activeStage.ts`):** referencja do bieżącego `Stage` trzymana jest w **module-level singleton** ustawianym przez `CanvasShell` przy mount/unmount. Konsekwencje, o których konsument musi wiedzieć:
> - W drzewie React może istnieć **co najwyżej jedna** `CanvasShell` na raz — kilka instancji (np. preview + main canvas obok siebie) wzajemnie nadpisałoby singleton, a `rasterize()` operowałby na ostatnio zamontowanym Stage'u.

Architektura jasno mówi „nadpisałoby singleton". Implementacja `src/canvas-kit/impl-konva/activeStage.ts:11-13`:

```typescript
export function setActiveStage(stage: Konva.Stage | null): void {
  activeStage = stage;
}
```

Bez żadnego logowania / asercji / dev-mode warningu. Druga `CanvasShell` w drzewie nadpisze pierwszą i `rasterize()` zacznie zwracać wynik z **niespodziewanej** instancji — bez sygnału, że to się stało.

**Konsekwencje:**

- 🟡 Future `CanvasShell` użytkowanie w preview / mini-map / split-view (nie w MVP, ale prawdopodobne post-MVP) złamie się cicho. Pierwszy bug typu „eksport pokazuje thumbnail zamiast głównego canvasu" wymagał będzie ręcznego śledzenia race.
- Dev-mode warning zająłby ~3 linie kodu, byłby informational tylko (nie throw'em).

**Rozwiązanie:**

```typescript
export function setActiveStage(stage: Konva.Stage | null): void {
  if (process.env.NODE_ENV !== 'production' && stage !== null && activeStage !== null && activeStage !== stage) {
    console.warn(
      'canvas-kit: multiple CanvasShell instances detected — last mount wins. ' +
      'rasterize() will operate on the most recently mounted Stage. ' +
      'See architecture-base.md §22.6 for context.'
    );
  }
  activeStage = stage;
}
```

Bez throw'a (eskalacja błędu w runtime crashowałaby aplikację), tylko warning w devtools. Test jednostkowy niepotrzebny — warning ma wyłącznie wartość diagnostyczną.

**Rekomendacja:** drobna defensywna poprawka. Niska pilność (single-instance jest realny w MVP), ale prosty hedge przeciwko przyszłej regresji. Można dorzucić do najbliższego PR-a touchującego canvas-kit.

---

## 3. 🟢 Drobne

### 3.1 (przeniesione z v6 §3.1) `consent_log.ip_address: unknown` w generowanych typach — wciąż aktywne

**Status:** wciąż aktywne, ale wpływ ograniczony. `src/types/database.ts:43` ma `ip_address: unknown`. `/api/consent` write path przekazuje `ip_address: ip` (string) — TS akceptuje string do unknown. Wrapper `ConsentLogRow` z `db-plan.md` §1.6 będzie potrzebny dopiero gdy ktoś będzie czytać `ip_address`. `/api/user/export` (linia 28-32) selecty `consent_type, version, accepted, accepted_at` — bez `ip_address`. Akceptowalne.

---

### 3.2 (przeniesione z v6 §3.2) E2E smoke heading bez i18n awareness

**Status:** wciąż OK. Bez zmian od v5/v6.

---

### 3.3 (przeniesione z v6 §3.3) `vitest-canvas-mock` weak assertion w smoke teście

**Status:** wciąż OK. Bez zmian od v5/v6.

---

### 3.4 (NOWY) `src/lib/snapEngine.ts:3` importuje `Point` z `@/shapes/_base/types`, nie z `@/canvas-kit` (kanonicznego źródła)

**Problem:**

```typescript
import type { AnchorEdge, AnchorPoint, Point } from '@/shapes/_base/types';
```

`AnchorEdge` i `AnchorPoint` są domeną kształtów — poprawnie importowane z `@/shapes/_base/types`.

`Point` ma kanoniczne źródło w `@/canvas-kit/primitives.ts:20-23` (po naprawie v6 §2.3). `@/shapes/_base/types.ts:11` re-eksportuje go z `@/canvas-kit`. Funkcjonalnie identyczne, ale konwencjonalnie:
- `Point` z canvas-kit = geometria 2D (nie wymaga zmiany przy refactorze domeny).
- Re-eksport w shapes/_base = wygoda, ale nie kanoniczne miejsce.

Komentarz `snapEngine.ts:1`:
> `lib/ → shapes/_base/types jest zależnością jednostronną i legalną (architecture §3).`

Architecture §3 nie mówi nic o tej zależności. Reguła `lib/` może importować z `shapes/_base/` (tylko typy) jest **nieformalna**. Architecture §22.7 mówi „typy w `src/shapes/_base/` przeżywają wymianę silnika bez modyfikacji" — konsystentne, ale nie pomaga w wyborze ścieżki importu `Point`.

**Konsekwencje:**

- 🟢 Poprawnie kompiluje się i działa. Future change: jeśli ktoś dodaje pole do `Point` w canvas-kit (np. `z?: number` dla 3D), zmiana propaguje się przez re-eksport — bez modyfikacji w snapEngine. OK.
- 🟢 Ale jeśli ktoś **usunie** re-eksport z `shapes/_base/types.ts` (uznając go za zbędny), `snapEngine.ts` przestanie się kompilować — przez importowanie nieistniejącego symbolu.
- 🟢 Niezgodność z `architecture-base.md` §22.1 (kierunek geometria → domena, kanoniczny w canvas-kit).

**Rozwiązanie:**

Rozdzielić import:

```diff
-import type { AnchorEdge, AnchorPoint, Point } from '@/shapes/_base/types';
+import type { Point } from '@/canvas-kit';
+import type { AnchorEdge, AnchorPoint } from '@/shapes/_base/types';
```

I usunąć (lub zaktualizować) komentarz na linii 1–2:

```diff
-// lib/ → shapes/_base/types jest zależnością jednostronną i legalną (architecture §3).
-// Cykl odwrotny (shapes/ → lib/snapEngine) jest zakazany.
+// Geometria 2D (Point) z canvas-kit (kanoniczne źródło, architecture §22.7).
+// Domenowe AnchorEdge/AnchorPoint z shapes/_base — cykl odwrotny
+// (shapes/ → lib/snapEngine) jest zakazany.
```

**Rekomendacja:** drobna konwencjonalna poprawka. Idealnie razem z innymi zmianami w `snapEngine.ts` (faktyczna implementacja po dodaniu pierwszego kształtu).

---

### 3.5 (NOWY) `api-plan.md` §2.1 errors table dla `/api/consent` nie wymienia `unauthorized_consent_target`

**Problem:**

`record_consent_bundle()` (migracja `20260508000000:46-49`) rzuca:

```sql
raise exception 'unauthorized_consent_target'
  using hint = 'p_user_id must match auth.uid() for authenticated callers';
```

`api-plan.md` §2.1 errors table dla `/api/consent` (linie 167–176):

```
| 400 | `{ "error": "invalid_consent_type" }` |
| 400 | `{ "error": "missing_fields" }` |
| 400 | `{ "error": "ambiguous_payload" }` |
| 400 | `{ "error": "invalid_bundle" }` |
| 401 | `{ "error": "unauthorized" }` |
| 500 | `{ "error": "internal_error" }` |
```

`unauthorized_consent_target` nie jest wymienione — handler (linia 88-90) loguje wszystkie błędy RPC jako `internal_error` (500), więc operacyjnie nie ma błędu. Ale:

- Komunikat błędu w produkcyjnych logach Vercel pokaże `unauthorized_consent_target` jako `internal_error` — operacyjnie myli (sugeruje awarię infra, gdy faktycznie to próba forge'owania consent dla cudzego user_id).
- Implementacja handler'a (linia 81-86) ustawia `p_user_id: user.id` — czyli wartość zawsze równa `auth.uid()`. Funkcja nie powinna nigdy zwrócić `unauthorized_consent_target` w tym wywołaniu. **Realny scenariusz:** ktoś wywoła RPC z innym klientem (np. testem integracyjnym z service_role oraz `p_user_id` rożnym od `auth.uid()` w sesji service_role context), wtedy `caller_role = 'service_role'` → bypass; albo `authenticated` → wymóg `caller_uid = p_user_id`.

**Konsekwencje:**

- 🟢 Logi pokazują „internal_error" dla błędów które realnie są autoryzacyjne. Praktycznie nie wystąpi w prawidłowo używanym handlerze, ale audyt bezpieczeństwa przez `pg_stat_statements` może wskazać te wywołania.
- Spec niekompletny — implementator dodający kolejny client (np. mobile app) korzystający z RPC nie wie, że może spotkać ten błąd.

**Rozwiązanie:**

Dodać do `api-plan.md` §2.1 errors table:

```diff
 | 400 | `{ "error": "invalid_bundle" }` — `types` zawiera wartości spoza `CHECK` lub duplikaty |
+| 403 | `{ "error": "unauthorized_consent_target" }` — RPC `record_consent_bundle` rzuca gdy `p_user_id ≠ auth.uid()` (defense-in-depth na wypadek bug'a w handlerze; w obecnej implementacji nieosiągalne, bo handler ustawia `p_user_id = user.id`) |
 | 401 | `{ "error": "unauthorized" }` — brak sesji |
 | 500 | `{ "error": "internal_error" }` |
```

Handler powinien rozpoznać i zmapować to na 403:

```diff
 if (rpcError) {
+  if (rpcError.message?.includes('unauthorized_consent_target')) {
+    return err('unauthorized_consent_target', 403);
+  }
   return err('internal_error', 500);
 }
```

**Rekomendacja:** drobna defensywna poprawka. Mała wartość operacyjna w MVP, ale logi będą czytelniejsze.

---

### 3.6 (NOWY) `documents.data` `octet_length(data::text)` CHECK ścieżka kosztowa — z notatką do post-MVP

**Status:** wciąż akceptowalne dla MVP (potwierdzone w v6 §2.4 jako świadome odroczenie). Notatka:

`octet_length(data::text)` przy każdym INSERT/UPDATE wymusza materializację serializacji JSONB → text. Dla scen blisko 5 MB to zauważalny koszt CPU. Alternatywa: `pg_column_size(data)` (rozmiar w storage'u po kompresji TOAST) — mniejszy, szybszy, ale daje liczbę storage'ową, nie „raw JSON".

`db-plan.md` §5.3 (linia 320) deklaruje „5 MB raw przez `octet_length`" — semantyka „rozmiar JSON eksportu" jest spójna z RODO art. 20 portability.

**Rekomendacja:** zostawić `octet_length` w MVP. Post-MVP, jeśli pojawi się sygnał wydajnościowy (np. > 100 ms na zapis sceny blisko limitu), rozważyć migrację na partial index + `pg_column_size`.

---

### 3.7 (NOWY) `architecture-base.md` §3 layout linia 156 wymienia `lib/snapEngine.ts` ale nie sygnalizuje że `lib/ipAnonymize.ts` jest zaimplementowane

**Problem:**

`architecture-base.md` §3 (linie 145–160) wymienia kompletną listę helperów `src/lib/`:

```
  lib/
    supabase/
      client.ts             ← createBrowserClient
      server.ts             ← createClient + createAdminClient
      middleware.ts         ← updateSession()
    captureGeometry.ts      ← TODO
    shapeBounds.ts          ← TODO
    snapEngine.ts           ← logika SNAP (czyste funkcje — bez Konvy / store'u)
    documentCodec.ts        ← TODO
    exportEngine.ts         ← TODO
    overlapDetector.ts      ← TODO
    ipAnonymize.ts          ← anonimizacja IP do /24 (IPv4) / /48 (IPv6) — RODO motyw 30
```

Zarówno `snapEngine.ts` (stub), jak i `ipAnonymize.ts` (full implementation z testami) są opisane bez rozróżnienia stanu implementacji. Architektura nie sygnalizuje **"zaimplementowane vs TODO"** explicit dla każdego pliku.

Spójne z `CLAUDE.md` linia 9 (patrz §1.1 v7 — krytyczna rozbieżność z faktem). Z drugiej strony `architecture-base.md` to dokument projektowy — nie zawsze odzwierciedla bieżący stan implementacji, tylko docelowy.

**Konsekwencje:**

- 🟢 Niska — czytelnik architecture'a generalnie wie, że to spec, nie status report. Ale w połączeniu z `CLAUDE.md` (§1.1 v7) tworzy spójny obraz „to jeszcze nie istnieje".

**Rozwiązanie:**

Najprostsze: zaufać `CLAUDE.md` jako źródłu prawdy o **bieżącym stanie**, a `architecture-base.md` o **docelowym kontrakcie**. Po naprawie §1.1 v7, ten problem znika sam — `CLAUDE.md` będzie wymieniał `ipAnonymize.ts` jako zaimplementowany, a `architecture-base.md` opisuje kontrakt.

**Rekomendacja:** brak akcji po naprawie §1.1.

---

### 3.8 (NOWY) `next.config.ts` dla Turbopack `resolveAlias canvas → ./empty.js` jest udokumentowane, ale nie wspomina że Webpack potrzebowałby innej konfiguracji

**Problem:**

`tech-stack.md` §6 (linia 102–117) i `next.config.ts:9` używają `turbopack: { resolveAlias }` — Next.js 16 + Turbopack stable. Jeśli ktoś (z jakiegoś powodu) przełączy na Webpack (`next dev --turbopack=false` lub upgrade'uje do Next 17 z innym domyślnym bundler'em), alias `canvas` nie będzie działał — Konva spróbuje załadować Node-side bindings i build padnie.

Konwencjonalnie obie sekcje (`turbopack` + `webpack`) trzymane razem dla portability:

```typescript
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: { canvas: './empty.js' },
  },
  // Fallback dla webpack (np. gdy ktoś użyje --turbopack=false):
  webpack(cfg) {
    cfg.resolve.alias = { ...cfg.resolve.alias, canvas: false };
    return cfg;
  },
};
```

**Konsekwencje:**

- 🟢 Bardzo niska — projekt celowo używa Turbopack stable (Next 16). Praktycznie nie dotyka.
- Future: gdy Next 17 (post-MVP) zmieni domyślny bundler, alias trzeba będzie zaktualizować. Bez webpack fallback dziś, brak migracji to też zerowy koszt.

**Rozwiązanie:** brak akcji w MVP. Notatka do checklisty „Next major version upgrade" — sprawdzić czy alias działa.

**Rekomendacja:** odrzucone, niska pilność.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Przed kolejną sesją Claude / przeglądem przez nowego developera (PILNE):

1. 🔴 **§1.1** — zaktualizować `CLAUDE.md` linie 7–9 do odzwierciedlenia faktycznego stanu (5 route handlerów + `ipAnonymize.ts` zaimplementowane). Krytyczne dla efektywności przyszłych sesji AI/onboardingu.
2. 🔴 **§1.2** — dopisać do `db-plan.md` §1.2 / §1.4 / §4.7 / §5.12 zmiany z migracji `20260509000000`: `lookup_user_id_by_email` (nowa funkcja), bypass `current_user = 'postgres'` w `block_protected_columns_update`, `OF user_id` w `subscriptions_after_iu_refresh_plan`, recovery semantyka w `trg_subscriptions_refresh_plan`. Bez tego dokument nie odzwierciedla bieżącego stanu DB.

### W trakcie hardening API (pre-launch):

3. 🟡 **§2.1** — zaktualizować `api-plan.md` §2.1 lookup priority by mówić jawnie o RPC `lookup_user_id_by_email` zamiast „auth.users WHERE email = ...".
4. 🟡 **§2.2** — uzgodnić nazwy polityk RLS między `db-plan.md` §4.x a migracjami (Opcja A: rename w `db-plan.md` do `_authenticated` suffix).
5. 🟡 **§2.3** — debounce przycisku zgody w UI (Opcja B); rozważyć `RETURNING SETOF consent_log` w RPC przy następnej zmianie consent flow (Opcja A).
6. 🟡 **§2.4** — naprawić `current_consent_version` w response handlera (Opcja A — odczyt z DB) lub zsynchronizować z RPC RETURNING (Opcja C, razem z §2.3).
7. 🟡 **§2.5** — dodać diagnostic message do branch'a „missing event_id/type/data" w paddle webhook + opcjonalnie nowy kod `'invalid_payload'` w `api-plan.md`.
8. 🟡 **§2.6** — dodać dev-mode warning w `setActiveStage` przy nadpisywaniu istniejącego singleton'a.

### Drobne (kosmetyczne, niska pilność):

9. 🟢 **§3.1** — wrapper `ConsentLogRow` przy pierwszym SELECT z `consent_log.ip_address` (odroczone do `/api/user/export` rozszerzenia).
10. 🟢 **§3.2 / §3.3** — wzmocnić smoke testy po pierwszej feature.
11. 🟢 **§3.4** — rozdzielić import `Point` (z canvas-kit) od `AnchorEdge/AnchorPoint` (z shapes/_base) w `snapEngine.ts:3`.
12. 🟢 **§3.5** — dodać `unauthorized_consent_target` do tabeli błędów `api-plan.md` §2.1 + mapowanie 403 w handlerze.
13. 🟢 **§3.6** — odroczone do post-MVP, gdy pojawi się sygnał wydajnościowy.
14. 🟢 **§3.7** — naprawia się automatycznie po §1.1.
15. 🟢 **§3.8** — odroczone do major version upgrade Next.js.

---

## 5. Podsumowanie

**Stan dokumentacji vs kod (delta v6 → v7):**

- **15 z 17 problemów v6 naprawionych** (vs 14/16 v5 → v6, 9/14 v4 → v5). Migracja `20260509000000_paddle_webhook_hardening.sql` zamknęła wszystkie 3 🔴 z v6 jednocześnie + krytyczny semantyczny problem `record_consent_bundle` (§2.5 v6).
- **Naprawione w v6 → v7:** Paddle webhook scaling (§1.1 v6), orphan recovery trigger (§1.2 v6), `verify:routes` w CI (§1.3 v6), webhook handler `count: 'exact'` + dead branch (§2.1 v6), atomicity dispatch przed marker (§2.2 v6), `Point` cycle canvas-kit ↔ shapes (§2.3 v6), `block_protected_columns_update` semantics (§2.5 v6), `architecture-base.md` §15 cleanup (§2.6 v6), `pnpm supabase:types:local` (§2.7 v6), warning logging w lookup'ie (§3.4 v6), JSON.parse fail message (§3.5 v6), Point comment (§3.6 v6), `tech-stack.md` §6 withNextIntl (§3.7 v6), trigger ordering convention (§3.8 v6).
- **Pozostałe carry-forward z v6:** 2 🟢 (3.1, 3.2/3.3 — akceptowalne stany pre-implementation).
- **8 nowych problemów zidentyfikowanych w v7:** 2 × 🔴 (CLAUDE.md stale, db-plan.md drift po 20260509), 6 × 🟡/🟢 (api-plan lookup wording, RLS policy names drift, consent SELECT race, consent response semantics, webhook diagnostic msg, CanvasShell singleton warn, snapEngine Point import, api-plan unauthorized_consent_target).

**Kluczowy wzorzec v6 → v7:** dyscyplina kodu/migracji wyraźnie wyższa niż dyscyplina dokumentacji. Zespół poprawnie zaaplikował naprawy z v6 (cała migracja `20260509`), ale dokumenty `db-plan.md`, `api-plan.md` i `CLAUDE.md` nie zostały wciągnięte w te zmiany. **Drift nie jest błędem implementacji — jest błędem procesu update'u dokumentacji po migracji.**

**Główne ryzyka v7:**

1. **CLAUDE.md introduces echo chamber dla AI sessions** (§1.1) — każda kolejna sesja Claude Code zaczyna od fałszywego obrazu stanu projektu. Konsekwencja: sugestie typu „dodaj brakujący endpoint" dla endpointów, które już istnieją; reimplementacja `ipAnonymize.ts` od nowa. Problem **akumuluje się** z każdą nową sesją.

2. **db-plan.md nie pokrywa migracji `20260509000000`** (§1.2) — operacyjnie ryzykuje powtórzenie naprawionych już problemów (np. ktoś próbuje dodać kolejny `SECURITY DEFINER` z UPDATE na `user_profiles.plan` i nie wie, że jest już bezpieczny dzięki bypass `current_user = 'postgres'`).

3. **Drift nazewnictwa polityk RLS** (§2.2) — niewielka skala, ale operacyjnie myląca przy debugu.

4. **Consent flow edge cases** (§2.3, §2.4) — w MVP akceptowalne, ale przed launch'em produkcyjnym warto ustabilizować response shape z perspektywy klienta.

**Filtr „przed implementacją kształtów":** żadne z odkryć v7 nie blokuje startu implementacji domeny shapes. Wszystkie 🔴 dotyczą dokumentacji (CLAUDE.md, db-plan.md). Implementacja pierwszego kształtu może iść równolegle z naprawami dokumentacji.

**Filtr „przed kolejnym PR-em do main":** wymagane są naprawy §1.1 (CLAUDE.md) i §1.2 (db-plan.md) — koszt jednorazowy ~45 minut, eliminuje accumulating drift dla wszystkich kolejnych sesji AI.

**Filtr „przed pierwszym deployem produkcyjnym":** warto domknąć §2.1 (api-plan.md lookup wording), §2.2 (RLS policy names) i §2.4 (consent response semantics). §2.3 (consent SELECT race) jest akceptowalne dla MVP — `record_consent_bundle()` jest atomowe, race dotyczy tylko response shape, nie integralności audytu RODO.

**Wniosek meta:** projekt po v6 → v7 wykazuje wzór „kod wyprzedza dokumentację" — proces update'u docs po migracji nie istnieje formalnie. Rekomendacja procesowa: każda migracja DB **wymaga** aktualizacji `db-plan.md` (§1.x dla tabel, §4.7 dla funkcji, §5.12+ dla listy migracji) jako element checklisty PR. Ten review v7 sam jest ad-hoc audytem, którego zadaniem jest złapać dryf — ale narzędziem skuteczniejszym byłby blocking CI step (np. `verify:db-plan-coverage` analogicznie do `verify:routes`).
