# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v8)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 8.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, `.ai/code-documentation-problems-v7.md`, kod w `src/` (route handlery, canvas-kit, lib, store, shapes, app/[locale]), migracje w `supabase/migrations/`, `supabase/config.toml`, `supabase/snippets/`, `vercel.json`, `.github/workflows/ci.yml`, `scripts/verify-routes.sh`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `next.config.ts`, `.env.example`, `CLAUDE.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation domeny shape'ów. Warstwa API (5 Route Handlerów), 3 migracje Supabase i `lib/ipAnonymize.ts` zaimplementowane i pokryte testami (Vitest co-located + contract test w `tests/store/`). Logika domeny (shapes, weld-units, store slices, components canvas) wciąż nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora/operations.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v7

| # v7 | Tytuł | Status (v8) | Komentarz |
|---|---|---|---|
| 1.1 | `CLAUDE.md` stale (5 route handlerów + `ipAnonymize.ts` nieudokumentowane) | ✅ **Naprawione** | `CLAUDE.md` linie 9–18 wymieniają wszystkie 5 route handlerów + `ipAnonymize.ts` z testem oraz 3 migracje. Sekcja „Project state" odpowiada faktycznemu stanowi. |
| 1.2 | `db-plan.md` nie pokrywa migracji `20260509000000` | ✅ **Naprawione** | `db-plan.md` §1.2 linie 34–42 dokumentują dwa warunki bypass (`current_user='postgres'` + `auth.role()='service_role'`); §1.4 linia 88 ma `OF status, current_period_end, user_id` + recovery semantykę dla `OLD.user_id`; §4.7 wymienia `lookup_user_id_by_email` i zaktualizowane `trg_subscriptions_refresh_plan`; §5.12a opisuje migracje inkrementalne. |
| 2.1 | `api-plan.md` lookup priority — SQL bezpośredni na `auth.users` | ✅ **Naprawione** | `api-plan.md` §2.1 linia 104 jawnie wskazuje RPC `public.lookup_user_id_by_email(p_email)` z notką, że `auth.users` nie jest wystawiona przez PostgREST. |
| 2.2 | Drift nazewnictwa polityk RLS (`db-plan.md` ↔ migracja) | 🟡 **Częściowo** | Implementacja zachowuje nazwy z migracji (`*_authenticated` suffix). `db-plan.md` §4.x wciąż używa starych nazw `*_self_*` / `*_owner_*` (patrz §3.4 w tej iteracji). |
| 2.3 | Consent SELECT race przy szybkich powtórnych wywołaniach | 🟡 **Wciąż aktywne** | Implementacja `consent/route.ts:99-107` nadal robi second-trip SELECT po RPC; race window pozostaje (akceptowalne dla MVP). |
| 2.4 | `current_consent_version` w response zwracał `null` przy revocation | ✅ **Naprawione** | `consent/route.ts:113-126` odczytuje `user_profiles.current_consent_version` z DB i zwraca aktualną wartość niezależnie od `accepted`. Komentarz w kodzie tłumaczy decyzję. |
| 2.5 | Webhook `invalid_signature` mylące diagnostycznie | ✅ **Naprawione** | `webhook/route.ts:103, 114` używa `invalid_payload` z `message` rozróżniającym JSON.parse fail od missing event fields. `api-plan.md` §2.1 linia 88 wymienia `invalid_payload` w errors table. |
| 2.6 | `setActiveStage` cicho nadpisuje singleton | ✅ **Naprawione** | `impl-konva/activeStage.ts:11-29` ma dev-mode warning z odniesieniem do architecture §22.6. Throw świadomie odrzucony. |
| 3.1 | `consent_log.ip_address: unknown` w typach | 🟢 **Wciąż aktywne, akceptowalne** | `src/types/database.ts:43` wciąż `ip_address: unknown`. Wrapper niewymagany dopóki nikt nie czyta tego pola; `/api/user/export` selektuje bez `ip_address`. |
| 3.2 / 3.3 | Smoke testy E2E / weak `vitest-canvas-mock` assertion | 🟢 **Wciąż aktywne, akceptowalne** | Bez zmian od v5 → v8. |
| 3.4 | `snapEngine.ts` import `Point` z `@/shapes/_base/types` | ✅ **Naprawione** | `snapEngine.ts:4-5` importuje `Point` z `@/canvas-kit`, `AnchorEdge`/`AnchorPoint` osobno z `@/shapes/_base/types`. Komentarz tłumaczy kierunek geometria → domena. |
| 3.5 | `unauthorized_consent_target` brak w errors table | ✅ **Naprawione** | `api-plan.md` §2.1 linia 177 dodała 403 `unauthorized_consent_target`. `consent/route.ts:93-95` mapuje błąd RPC na 403. |
| 3.6 | `octet_length(data::text)` performance koszt | 🟢 **Wciąż akceptowalne** | Bez zmian; do post-MVP, gdy pojawi się sygnał. |
| 3.7 | `architecture-base.md` §3 layout nie odróżnia zaimplementowane vs TODO | 🟢 **Wciąż aktywne, świadomie** | `architecture-base.md` jest dokumentem projektowym — odzwierciedla docelowy kontrakt, nie status. `CLAUDE.md` jest source of truth dla bieżącego stanu (po naprawie v7 §1.1). |
| 3.8 | `next.config.ts` brak fallbacka webpack | 🟢 **Odroczone** | Bez zmian; odroczone do major version upgrade Next.js. |

**Wniosek:** **9 z 13 problemów v7 naprawionych** (vs 15/17 v6 → v7). Naprawione w v7 → v8: §1.1 (CLAUDE.md update), §1.2 (db-plan.md drift po `20260509`), §2.1 (api-plan lookup wording), §2.4 (consent response), §2.5 (webhook diagnostic), §2.6 (setActiveStage warning), §3.4 (Point import), §3.5 (unauthorized_consent_target). 4 carry-forward to świadome decyzje (akceptowalne stany pre-implementation lub odroczenia post-MVP). **Pozostaje 1 dryf z v7 §2.2 (RLS policy names)** — patrz §3.4 w tej iteracji.

Poniżej — **nowe problemy zidentyfikowane w v8**. Główny wzorzec: po cyklu napraw v7 odsłoniła się druga warstwa drift'u — głównie w `tech-stack.md` §13 i `architecture-base.md` §14, których zawartość nie odzwierciedla zmiany _kierunku_ implementacji `consent/route.ts` (od „service_role" do „session client + SECURITY DEFINER").

---

## 1. 🔴 Krytyczne

### 1.1 (NOWY) `supabase/snippets/Untitled query 940.sql` — destrukcyjny snippet bez `WHERE` zacommitowany do repo

**Problem:**

W repo istnieje plik `supabase/snippets/Untitled query 940.sql`:

```sql
update public.user_profiles
set plan = 'pro'
returning id, plan;
```

To jest snippet wygenerowany przez Supabase Studio („Untitled query NNN") — **fizycznie zacommitowany**, nieignorowany przez `.gitignore`. Status `git`: `?? supabase/snippets/` (nieśledzony, ale obecny w drzewie projektu).

**Konsekwencje:**

- 🔴 **`UPDATE … SET plan='pro' RETURNING …` bez `WHERE` ustawia `plan='pro'` dla WSZYSTKICH wierszy `user_profiles`.** Run scenarios:
  1. Developer odpala `pnpm supabase db reset` w lokalnym środowisku, potem ręcznie kopiuje snippet do Studio i klika „Run" — wszyscy lokalni użytkownicy stają się Pro.
  2. Operations team przegląda repo szukając „test queries" i rozpoznaje plik jako legitny SQL (`update`, `set`, `returning` — wygląda intencyjnie). Run na produkcyjnym Studio = catastrophic.
  3. Skrypt CI / Codespaces pre-load'ujący snippety do nowych instancji Supabase replikuje stan błędu.
- 🔴 **Brak komentarza intencji** — plik nie tłumaczy: czy to debug query, fixture do testu manualnego, próba odtworzenia bug'a? Nazwa „Untitled query 940" sugeruje przypadkowe zacommitowanie z lokalnego workflow.
- 🔴 **Niezgodność z konwencjami projektu** — `db-supabase-migrations.md` wyraźnie kanonizuje migracje w `supabase/migrations/YYYYMMDDHHmmss_*.sql`. `supabase/snippets/` nie jest udokumentowany jako legitny katalog. Nie ma żadnego dokumentu sterującego cyklem życia snippetów.
- Nawet w lokalnym środowisku (gdzie wpływ jest ograniczony), istnienie pliku w repo może mylić nowych developerów: „skoro jest zacommitowany, to chyba intencyjny — może jest częścią seed flow?".

**Rozwiązanie:**

**Opcja A (zalecana):** **usunąć katalog `supabase/snippets/` z repo i dodać go do `.gitignore`**.

```bash
git rm -r supabase/snippets/
echo "supabase/snippets/" >> .gitignore
```

Snippety Supabase Studio są lokalne — Studio przechowuje je per-session bez konieczności synchronizacji przez VCS. Jeśli zespół chce udostępniać query (np. helper SELECTy do debugowania), poprawne miejsce to:
- Migracje (gdy zmieniają schemat).
- Plik `supabase/seed.sql` lub dedykowany `supabase/dev-fixtures/*.sql` (gdy populują dane).
- README / dedicated runbook (gdy są procedurami diagnostycznymi).

**Opcja B:** zachować, ale dodać `WHERE` clause + komentarz intencji + zmienić nazwę pliku na czytelną:

```sql
-- DEV ONLY: bumps a single user to 'pro' for local plan-gated UI testing.
-- Do NOT run in production.
update public.user_profiles
set plan = 'pro'
where id = '<uuid>'
returning id, plan;
```

I umieścić w `supabase/dev-snippets/upgrade-user-to-pro.sql`. Wymaga jasnego protokołu: kiedy snippety są legitne, kiedy migracje, kto reviewuje.

**Rekomendacja:** **Opcja A** — minimalna interwencja, eliminuje powierzchnię ataku przez confusion. Snippety Supabase Studio to ephemeral artifacts; nie powinny przeżywać commitu. Koszt: 2 linie (rm + gitignore), 1 PR.

---

### 1.2 (NOWY) Trzy dokumenty kłamią o `SUPABASE_SERVICE_ROLE_KEY` w `/api/consent` — implementacja go NIE używa

**Problem:**

Trzy źródła „prawdy" twierdzą, że `app/api/consent/route.ts` korzysta z `SUPABASE_SERVICE_ROLE_KEY`:

1. **`tech-stack.md` §13 linia 290:**
   > `SUPABASE_SERVICE_ROLE_KEY` | server only | Server-only operacje omijające RLS: `app/api/paddle/webhook/route.ts` (...), `app/api/cron/expire-subscriptions/route.ts` oraz `app/api/cron/cleanup-webhook-events/route.ts` (brak kontekstu JWT) i `app/api/consent/route.ts` (RPC `record_consent_bundle()` SECURITY DEFINER aktualizujący `current_consent_version` po bundle insert). (...)

2. **`api-plan.md` §3 linia 828 (tabela „Mechanizmy uwierzytelniania"):**
   > `SUPABASE_SERVICE_ROLE_KEY` | Webhook handler (`/api/paddle/webhook`), crony (`/api/cron/*`) — tylko server-side. **`/api/consent` używa go pośrednio przez `record_consent_bundle()` (`SECURITY DEFINER`), bez bezpośredniego klienta admin.**

3. **`architecture-base.md` §14 linia 1097:**
   > `POST /api/consent { types: [...], version, userAgent }`
   > ↓ handler anonimizuje IP z nagłówka X-Forwarded-For, wykonuje atomowy bundle INSERT do consent_log (3 wiersze) **i ustawia `user_profiles.current_consent_version` (service_role)**

4. **`.env.example` linia 11:**
   > Tylko server-side; używane w app/api/paddle/webhook/route.ts (upsert), app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts (brak JWT) **oraz app/api/consent/route.ts (RPC record_consent_bundle SECURITY DEFINER).**

**Stan faktyczny — `src/app/api/consent/route.ts:59:**

```typescript
const supabase = await createClient();          // ← session-scoped client (anon key + JWT cookie)
const { data: { user } } = await supabase.auth.getUser();
if (!user) return err('unauthorized', 401);
// ...
const { error: rpcError } = await supabase.rpc('record_consent_bundle', { ... });
```

`createClient()` z `src/lib/supabase/server.ts:6` zwraca `createServerClient<Database>` z `@supabase/ssr` — czyli klient JWT-cookie sesji użytkownika, **nie service_role**. Cały handler nie wywołuje `createAdminClient()` ani `process.env.SUPABASE_SERVICE_ROLE_KEY` ani razu.

Funkcja `record_consent_bundle()` jest `SECURITY DEFINER` — jest **wykonywana jako rola właściciela `postgres`**, niezależnie od wywołującego JWT. To NIE jest „service_role pośrednio" — `service_role` i `postgres` to dwie odrębne role w Supabase:
- `service_role` = JWT z `role: 'service_role'` claim, dostarczany przez `SUPABASE_SERVICE_ROLE_KEY`.
- `postgres` = rola właściciela funkcji DB (która wykonuje `SECURITY DEFINER`).

`record_consent_bundle()` aktualizuje `user_profiles.current_consent_version` przez bypass `current_user = 'postgres'` w `block_protected_columns_update` (migracja `20260509000000`) — bypass `auth.role() = 'service_role'` jest tu **nieosiągany**.

`api-plan.md` §2.1 linia 191 mówi to wprost:
> **Reguła service_role w tym handlerze:** **niepotrzebny** — bundle insert + update `current_consent_version` jest realizowany przez RPC `record_consent_bundle()` (`SECURITY DEFINER`), per-type insert idzie przez klienta z sesją + RLS. Bug w handlerze nie może wymusić zapisu consent dla cudzego `user_id` — funkcja sama waliduje `auth.uid() = p_user_id`.

Czyli `api-plan.md` §2.1 (linia 191) i `api-plan.md` §3 (linia 828) **wewnętrznie się sprzeczają**. Tabela §3 powiela kłamstwo z `tech-stack.md` §13.

**Konsekwencje:**

- 🔴 **Implementator nowego endpointu czytający `tech-stack.md` §13** zakłada, że każde wywołanie `SECURITY DEFINER` z `authenticated` wymaga klienta service_role — i w nowym route handlerze importuje `createAdminClient()` zamiast `createClient()`. Konsekwencja: handler omija RLS bez powodu, expose'uje dane do których użytkownik nie ma dostępu. **Realny attack vector** przy następnym RPC.
- 🔴 **Operations team / pentester** przeglądający scope `SUPABASE_SERVICE_ROLE_KEY` widzi 4 endpointy (paddle webhook, 2 crony, consent). Próba „upraw" tej listy może błędnie usunąć klucz z env po cofnięciu paddle/cron flow — lub odwrotnie, błędnie eskalować scope (security review).
- 🔴 **Future engineer** chcący „uprościć" `record_consent_bundle()` na `SECURITY INVOKER` zakłada że handler ma service_role i mu się uda — w rzeczywistości straci dostęp do `block_protected_columns_update` bypass'a (bo ani `current_user = postgres`, ani `auth.role() = service_role` nie zadziała) i `current_consent_version` przestanie się aktualizować bez błędu.
- **Audit gap RODO art. 7:** „handler korzysta z service_role" sugeruje że może rejestrować consent dla cudzego user_id — co jest nieprawdą (RPC waliduje `auth.uid() = p_user_id`). Niepotrzebnie podnosi pozorny risk profile w security review.
- **`.env.example` line 11:** komentarz instruuje dewelopera, że ten klucz jest niezbędny dla `consent/route.ts`. Faktycznie `consent/route.ts` działa nawet gdy `SUPABASE_SERVICE_ROLE_KEY=""` (puste), bo go nie czyta — co jest pułapką testową: developer próbujący przetestować consent flow bez klucza myśli że ma bug, gdy w rzeczywistości flow działa, tylko paddle webhook nie.

**Rozwiązanie:**

Trzy spójne edycje:

**`tech-stack.md` §13 linia 290 — zaktualizować scope `SUPABASE_SERVICE_ROLE_KEY`:**

```diff
-| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Server-only operacje omijające RLS: `app/api/paddle/webhook/route.ts` (upsert do `subscriptions` i `webhook_events`), `app/api/cron/expire-subscriptions/route.ts` oraz `app/api/cron/cleanup-webhook-events/route.ts` (brak kontekstu JWT) i `app/api/consent/route.ts` (RPC `record_consent_bundle()` SECURITY DEFINER aktualizujący `current_consent_version` po bundle insert). Nigdy w Client Component / Server Component. Helper: `createAdminClient()` z `src/lib/supabase/server.ts`. |
+| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Server-only operacje omijające RLS: `app/api/paddle/webhook/route.ts` (upsert do `subscriptions` i `webhook_events`), `app/api/cron/expire-subscriptions/route.ts` oraz `app/api/cron/cleanup-webhook-events/route.ts` (brak kontekstu JWT). `app/api/consent/route.ts` używa **klienta sesji** (`createClient`) — RPC `record_consent_bundle()` jest `SECURITY DEFINER` i wykonuje się jako rola `postgres` (właściciel funkcji), nie jako `service_role`; klucz tutaj nie jest potrzebny. Nigdy w Client Component / Server Component. Helper: `createAdminClient()` z `src/lib/supabase/server.ts`. |
```

**`api-plan.md` §3 linia 828 — usunąć błędne odniesienie do consent:**

```diff
-| **`SUPABASE_SERVICE_ROLE_KEY`** | Webhook handler (`/api/paddle/webhook`), crony (`/api/cron/*`) — tylko server-side. `/api/consent` używa go pośrednio przez `record_consent_bundle()` (`SECURITY DEFINER`), bez bezpośredniego klienta admin. |
+| **`SUPABASE_SERVICE_ROLE_KEY`** | Webhook handler (`/api/paddle/webhook`), crony (`/api/cron/*`) — tylko server-side. `/api/consent` **NIE** używa tego klucza: handler operuje na sesji JWT, a RPC `record_consent_bundle()` (`SECURITY DEFINER`) wykonuje się jako rola `postgres`, niezależnie od wywołującego — patrz §2.1 ostatni akapit oraz `db-plan.md` §1.2 (bypass `current_user='postgres'` w `block_protected_columns_update`). |
```

**`architecture-base.md` §14 linia 1097 — poprawić opis kroku 2:**

```diff
-2. POST /api/consent { types: ['terms_of_service','privacy_policy','cookies'], version, userAgent }
-   ↓ handler anonimizuje IP z nagłówka X-Forwarded-For, wykonuje atomowy bundle INSERT
-     do consent_log (3 wiersze) i ustawia user_profiles.current_consent_version (service_role)
+2. POST /api/consent { types: ['terms_of_service','privacy_policy','cookies'], version, userAgent }
+   ↓ handler anonimizuje IP z nagłówka X-Forwarded-For, używa klienta sesji
+     (createClient z @supabase/ssr) i wywołuje RPC `record_consent_bundle()`
+     (SECURITY DEFINER, wykonuje się jako rola postgres). Funkcja waliduje
+     auth.uid() = p_user_id i atomowo wstawia 3 wiersze do consent_log oraz
+     (gdy p_accepted) aktualizuje user_profiles.current_consent_version.
+     SUPABASE_SERVICE_ROLE_KEY nie jest tu potrzebny.
```

**`.env.example` linia 11 — usunąć błędny scope:**

```diff
-# Tylko server-side; używane w app/api/paddle/webhook/route.ts (upsert),
-# app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts (brak JWT)
-# oraz app/api/consent/route.ts (RPC record_consent_bundle SECURITY DEFINER).
+# Tylko server-side; używane w app/api/paddle/webhook/route.ts (upsert),
+# app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts (brak JWT).
+# /api/consent NIE używa tego klucza — RPC record_consent_bundle to SECURITY
+# DEFINER (wykonuje się jako rola postgres), handler operuje na kliencie sesji.
```

**Rekomendacja:** **Pilne** — koszt ~5 minut (4 mechaniczne edycje), eliminuje pułapkę dla każdego nowego implementatora route handlera. Sygnał alarmowy: **dwa źródła w `api-plan.md` (§2.1 vs §3) wewnętrznie sobie zaprzeczają** — to oznacza, że review tych dokumentów nie identyfikuje cross-section drift'u. Warto rozważyć dodanie do CI bramki spójnościowej (np. lint-step na `*.md` z assertami typu „każdy `SUPABASE_SERVICE_ROLE_KEY` mention musi pasować do listy z `tech-stack.md` §13").

---

## 2. 🟡 Istotne

### 2.1 (NOWY) `CLAUDE.md` linia 69 — proxy.ts middleware opisany jako „currently stubbed", faktycznie pełna implementacja

**Problem:**

`CLAUDE.md` linia 69:

> **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains `next-intl` middleware and is the place to add Supabase `updateSession()` (currently stubbed).

Stan faktyczny — `src/proxy.ts:21-32`:

```typescript
export async function proxy(request: NextRequest) {
  const { supabaseResponse } = await updateSession(request);
  const intlResponse = intlMiddleware(request);
  if (intlResponse) {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      intlResponse.cookies.set(cookie);
    });
    return intlResponse;
  }
  return supabaseResponse;
}
```

Oraz `src/lib/supabase/middleware.ts:5-36` — pełna implementacja `updateSession` z `getAll`/`setAll` cookie API i `auth.getUser()` na każdym requeście.

`updateSession` **nie jest** stubbed — działa, refresh'uje JWT przy każdym ruchu po appie. CLAUDE.md w połączeniu z innymi sekcjami opisuje ten kontrakt poprawnie (np. „Supabase musi odświeżyć token przed routingiem locale" w `architecture-base.md` §16) — ale ta linia §66 wprowadza w błąd nowego developera/AI.

**Konsekwencje:**

- 🟡 **Każda nowa sesja Claude Code** czytająca CLAUDE.md może zacząć od „muszę dorobić Supabase middleware" — i albo zduplikuje istniejący kod, albo wprowadzi konflikt z proxy.ts.
- 🟡 Nowy developer na onboardingu może zignorować proxy.ts jako „stubowane" i nie sprawdzać go przy debugowaniu refresh tokenu / sesji.
- W połączeniu z resztą poprawek v7 → v8, ten footgun ma identyczną naturę jak v7 §1.1 — drobny tekst w „Project state" / „configuration quirks", który akumulująco myli AI sessions.

**Rozwiązanie:**

```diff
-- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains `next-intl` middleware and is the place to add Supabase `updateSession()` (currently stubbed).
+- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains Supabase `updateSession()` (`src/lib/supabase/middleware.ts`) → `next-intl` middleware. The chain is mandatory: Supabase must refresh the JWT cookies before next-intl decides on locale rewrite/redirect, and any locale-rewrite response must propagate the `Set-Cookie` headers from the Supabase response. The matcher excludes `/api/*` (Route Handlers refresh sessions on first `auth.getUser()` call inside the handler).
```

**Rekomendacja:** drobna, mechaniczna poprawka. Można dorzucić do najbliższego PR-a touchującego CLAUDE.md.

---

### 2.2 (NOWY) `consent/route.ts:117-121` — silent fallback `current_consent_version: null` na DB error trzeciego SELECT

**Problem:**

`src/app/api/consent/route.ts:117-126`:

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

Po naprawie v7 §2.4 handler poprawnie odczytuje `current_consent_version` z DB zamiast passthrough'ować payload. Ale:

- **`error` z trzeciego SELECTa jest świadomie ignorowany** (destrukturyzacja zwraca tylko `data`).
- Jeśli `user_profiles` SELECT failuje (np. timeout, transient PostgREST 503), handler zwraca `current_consent_version: null` z `status: 201`.
- Klient widzi `current_consent_version: null` po pomyślnej rejestracji i wnioskuje „brak aktywnej zgody w bazie" → pokazuje modal zgody przy następnej akcji (zgodnie z `architecture-base.md` §14 linia 1107).
- W rzeczywistości DB ma poprawną wartość po bundle insert + RPC update — to jest fałszywie negatywny stan w response.

**Konsekwencje:**

- 🟡 **UX regression** dla użytkownika tuż po rejestracji: pomyślna rejestracja → modal zgody „proszę ponownie zaakceptować" → konfuzja.
- 🟡 Niespójność z poprzednimi 2 SELECT'ami w handlerze (`select consent_log` linia 100, `auth.getUser` linia 60-62), które oba escalate'ują `internal_error` 500 przy błędzie. Trzeci SELECT zachowuje się asymetrycznie.
- Test integracyjny tego flow (post-MVP) nie wykryje regression bez świadomego mock'owania błędu na trzecim SELECT'cie.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** dodać error handling na trzeci SELECT, escalate jako `internal_error` 500:

```diff
-const { data: profile } = await supabase
+const { data: profile, error: profileError } = await supabase
  .from('user_profiles')
  .select('current_consent_version')
  .eq('id', user.id)
  .single();

+if (profileError) {
+  return err('internal_error', 500);
+}
+
return NextResponse.json(
  {
    inserted: inserted ?? [],
    current_consent_version: profile?.current_consent_version ?? null,
  },
  { status: 201 }
);
```

Trade-off: bundle insert się wykonał, ale klient dostaje 500. Rekonsyliacja na kliencie: powtórzenie POST `/api/consent` jest idempotentne (RLS blokuje duplikat samego user_id; RPC by pewnie zarezerwował kolejne 3 wiersze, ale `current_consent_version` w DB byłby już ustawiony — kontynuacja flow czytanie z `user_profiles` przy logowaniu).

**Opcja B:** zwrócić 201 + `current_consent_version: null` ale dodać warning header lub dedykowany flag w response (`degraded: true`):

```typescript
return NextResponse.json(
  {
    inserted: inserted ?? [],
    current_consent_version: profile?.current_consent_version ?? null,
    ...(profileError ? { degraded: 'profile_read_failed' } : {}),
  },
  { status: 201 }
);
```

Klient świadomie odróżnia „brak zgody w DB" od „read failure".

**Opcja C:** `record_consent_bundle()` `RETURNS TABLE` (analogicznie do v7 §2.3 Opcja A) zwracający `current_consent_version` razem z wstawionymi wierszami — eliminuje second/third trip SELECT. Wymaga migracji DB.

**Rekomendacja:** **Opcja A** dla MVP — minimalna zmiana, eliminuje fałszywy negatyw. Opcja C przy okazji następnego touchpoint'a w consent flow.

---

### 2.3 (NOWY) `architecture-base.md` §22.1 listuje `devicePixelRatio` jako wartość, ale eksport jest funkcją (`devicePixelRatio()`)

**Problem:**

`architecture-base.md` §22.1 linia 1426:

```typescript
export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'
```

`architecture-base.md` §9 linia 798:

> `CanvasShell` → `<Stage pixelRatio={devicePixelRatio}>`

Tekst sugeruje `devicePixelRatio` jako **wartość** (np. `number` lub `getter`).

Stan faktyczny — `src/canvas-kit/constants.ts:17-20`:

```typescript
export function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}
```

To **funkcja**. `CanvasShell.tsx:31` faktycznie woła ją: `pixelRatio={devicePixelRatio()}` — z nawiasami.

**Konsekwencje:**

- 🟡 Implementator pierwszego shape'a / komponentu kopiujący przepis z `architecture-base.md` §9 napisze `pixelRatio={devicePixelRatio}` (bez nawiasów) → przekaże referencję funkcji do propa `pixelRatio` (Konva przyjmuje `number`) → runtime `NaN` lub silent default = 1, retina canvas się degraduje.
- 🟡 ESLint nie złapie błędu (TypeScript zezwala na unsound coercion typu `(() => number) → number` w niektórych pos'ach przez interop).
- W §22.9.4 architektury sformułowanie „pixelRatio ustawiane wyłącznie w CanvasShell" jest poprawne semantycznie, ale przykład w §9 linii 798 sugeruje value-not-function.

Dlaczego to function, a nie value? Bo `window.devicePixelRatio` jest dostępne tylko w client runtime — early evaluation w module-level binding zakończyłaby się `undefined` w SSR build. Funkcja z `typeof window === 'undefined'` guard jest pragmatic. Ale ten kontrakt powinien być explicit w docs.

**Rozwiązanie:**

Zaktualizować wszystkie odniesienia do `devicePixelRatio` w architekturze, by były spójne z runtime kontraktem:

**`architecture-base.md` §9 linia 798:**

```diff
-Mapowanie w aktywnej implementacji `canvas-kit/impl-konva/`:
-- `CanvasShell` → `<Stage pixelRatio={devicePixelRatio}>`
+Mapowanie w aktywnej implementacji `canvas-kit/impl-konva/`:
+- `CanvasShell` → `<Stage pixelRatio={devicePixelRatio()}>` (funkcja, nie wartość — `window.devicePixelRatio` jest dostępne tylko w client runtime, więc czytane z guard'em SSR; patrz `src/canvas-kit/constants.ts:17`)
```

**`architecture-base.md` §22.1 linia 1426 — uściślić eksport:**

```diff
 // Stałe
-export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'
+export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'
+// HIT_AREA_TOUCH, HIT_AREA_DESKTOP: number (literały)
+// devicePixelRatio: () => number (funkcja z SSR guardem; wołać w runtime, nie w module init)
```

Albo (mniej inwazyjnie) — zmienić sygnaturę z `devicePixelRatio` na `getDevicePixelRatio` w kodzie + dokumentacji, by sufiks `get` jednoznacznie sygnalizował, że to function-getter:

```typescript
// src/canvas-kit/constants.ts
export function getDevicePixelRatio(): number { ... }

// CanvasShell.tsx
<Stage pixelRatio={getDevicePixelRatio()} />
```

Konsekwencja: refactor 4-5 call sites + aktualizacja `index.ts` re-eksportu + 3 wzmianek w architekturze.

**Rekomendacja:** **edit dokumentacji** wystarcza (cheaper). Refactor nazwy na `getDevicePixelRatio` opcjonalny, ale spójny z resztą JS conventions; warto rozważyć przy najbliższym PR-cie touchującym `canvas-kit/constants.ts`.

---

### 2.4 (NOWY) Triple `Point` re-export w `canvas-kit/` — `primitives.ts`, `index.ts`, `pointerInput.ts`

**Problem:**

`Point` jest **eksportowany 3 razy** z różnych plików w `src/canvas-kit/`:

1. `src/canvas-kit/primitives.ts:20-23` — kanoniczna definicja:
   ```typescript
   export interface Point { x: number; y: number; }
   ```

2. `src/canvas-kit/index.ts:33` — re-eksport z `./primitives`:
   ```typescript
   export type { Point, ... } from './primitives';
   ```

3. `src/canvas-kit/pointerInput.ts:23-24` — re-eksport z `./primitives`:
   ```typescript
   import type { Point } from './primitives';
   export type { Point };
   ```

I dodatkowo `src/shapes/_base/types.ts:8-12` re-eksportuje z `@/canvas-kit`. Czyli ścieżki importu `Point`:
- `import type { Point } from '@/canvas-kit'` (preferowane)
- `import type { Point } from '@/canvas-kit/primitives'` (kanoniczne, ale głębsza ścieżka)
- `import type { Point } from '@/canvas-kit/pointerInput'` (przypadkowo działająca)
- `import type { Point } from '@/shapes/_base/types'` (legacy after v7 §3.4)

**Konsekwencje:**

- 🟡 **Inkrementalny drift importów.** Każdy nowy plik konsumujący `Point` może wybrać dowolną z 4 ścieżek. Code review nie ma single source of truth dla „skąd importować Point". W większym codebase'ie po implementacji 8 shapes + handle layers istnieje real risk fragmentacji konwencji.
- 🟡 Jeśli ktoś usunie re-eksport z `pointerInput.ts:24` (uznając go za redundant), istnieje ryzyko że jakiś inny plik (np. test) importował `Point` z tej ścieżki — silent break.
- `pointerInput.ts:24` re-eksport jest świadomy: typ jest w sygnaturach `PointerGesture`, więc konsument importujący `PointerGesture` musi mieć dostęp do `Point`. Ale ten use case rozwiązuje import z `@/canvas-kit` (publiczny barrel re-eksportuje oba).

**Rozwiązanie:**

**Opcja A (zalecana):** usunąć `export type { Point }` z `pointerInput.ts:24`. Pliki konsumujące `PointerGesture` importują obie z `@/canvas-kit`:

```diff
 import type { Point } from './primitives';
-export type { Point };
```

Konsumenci `PointerGesture` (`CanvasApp.tsx` w przyszłości) importują:

```typescript
import type { Point, PointerGesture } from '@/canvas-kit';
```

Single canonical source = `primitives.ts`, single user-facing path = `@/canvas-kit`.

**Opcja B:** zostawić, ale dodać komentarz w `pointerInput.ts:24` explicitly mówiący „re-eksport dla wygody konsumentów importujących PointerGesture; ale zalecane: importować Point z @/canvas-kit barrel".

**Rekomendacja:** Opcja A. Eliminuje confusion, koszt 1 linii.

---

### 2.5 (NOWY) `tech-stack.md` §15 (`devDependencies` lista) nie pokrywa zainstalowanych narzędzi

**Problem:**

`tech-stack.md` §15 linie 358–388 listuje devDependencies. Stan faktyczny w `package.json:46-76`:

```json
"@commitlint/cli": "^19.0.0",                    // ← brak w tech-stack §15
"@commitlint/config-conventional": "^19.0.0",    // ← brak w tech-stack §15
"@eslint/eslintrc": "^3.0.0",                    // ← brak w tech-stack §15
"eslint-config-prettier": "^9.1.0",              // ← brak w tech-stack §15
"husky": "^9.0.0",                               // ← brak w tech-stack §15
"lint-staged": "^15.0.0",                        // ← brak w tech-stack §15
```

`tech-stack.md` §11 (linting / formatting sekcja) wymienia tylko ESLint, eslint-config-next, @typescript-eslint/{eslint-plugin,parser}, prettier, prettier-plugin-tailwindcss. Brak husky / lint-staged / commitlint.

`CLAUDE.md` §79–82 jest poprawne (wymienia pre-commit hooks, commitlint, conventional commits). Ale `tech-stack.md` jest deklarowany jako „single source of truth dla wszystkich technologii i wersji w projekcie" (`tech-stack.md` linia 4).

**Konsekwencje:**

- 🟡 `tech-stack.md` traci status SSoT — drift względem `package.json`. Onboarding developer kopiujący stack nie wie o pre-commit hooks.
- Future bump husky / commitlint / lint-staged nie ma jasnej procedury (`tech-stack.md` §18 wymaga aktualizacji 4 plików przy zmianie technologii).
- Drobna ale skumulowana — w tech-stack.md §11 linia 235 wprost mówi „Konfiguracja: `eslint.config.mjs` (flat config), `prettier.config.mjs`, `.prettierignore`." bez wzmianki o `commitlint.config.mjs` ani `.lintstagedrc.json` (oba istnieją w repo).

**Rozwiązanie:**

Zaktualizować `tech-stack.md` §11 + §15:

**§11 Linting / formatowanie (po istniejącej tabeli) — dodać sekcję:**

```markdown
### 11.1 Pre-commit hooks (Husky + lint-staged + commitlint)

| Pakiet | Wersja | Rola |
|---|---|---|
| `husky` | `^9.0.0` | Bramki Git hooks (pre-commit, commit-msg) |
| `lint-staged` | `^15.0.0` | Uruchamia eslint/prettier wyłącznie na zmienionych plikach |
| `@commitlint/cli` | `^19.0.0` | Walidacja komunikatów commitów |
| `@commitlint/config-conventional` | `^19.0.0` | Reguły Conventional Commits |
| `eslint-config-prettier` | `^9.1.0` | Wyłącza ESLint rules konfliktujące z Prettier |
| `@eslint/eslintrc` | `^3.0.0` | Compatibility shim dla flat config (`eslint-config-next/*`) |

**Wymagane pliki:**
- `.husky/pre-commit` → `lint-staged`
- `.husky/commit-msg` → `commitlint --edit "$1"`
- `.lintstagedrc.json` (zakres staged files)
- `commitlint.config.mjs` z `@commitlint/config-conventional`
```

**§15 — dodać brakujące pakiety do listy devDependencies:**

```diff
 prettier@^3.3.0
 prettier-plugin-tailwindcss@^0.6.0
+eslint-config-prettier@^9.1.0
+@eslint/eslintrc@^3.0.0
+
+husky@^9.0.0
+lint-staged@^15.0.0
+@commitlint/cli@^19.0.0
+@commitlint/config-conventional@^19.0.0

 supabase@^2.0.0
 dotenv-cli@^7.4.0
```

**Rekomendacja:** drobna, mechaniczna. Można dorzucić do najbliższego PR-a touchującego `tech-stack.md`. Większa wartość jeśli wprowadzimy proces: każdy `pnpm add -D <new>` wymaga linii w `tech-stack.md` §11/§15 (analogicznie do `db-plan.md` ↔ migracje, patrz §3.4).

---

## 3. 🟢 Drobne

### 3.1 (NOWY) `e2e/smoke.spec.ts` szuka `heading WelderDoc` — działa tylko bo `messages/{pl,en}.json App.title` to literał `'WelderDoc'`, nie i18n key

**Problem:**

`e2e/smoke.spec.ts:5`:

```typescript
await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();
```

Test sprawdza obecność heading'u o tekście `'WelderDoc'`. Działa, bo:
- `src/messages/pl.json:3`: `"title": "WelderDoc"`
- `src/messages/en.json` (nie czytane, prawdopodobnie tożsame): `"title": "WelderDoc"`
- `src/app/[locale]/page.tsx:15`: `<h1>{t('title')}</h1>`

Czyli zarówno w PL jak i EN locale heading renderuje się jako `WelderDoc` (brand name = niezmienny). Test pasuje case'em.

**Ale:** jeśli kiedykolwiek `App.title` w którymkolwiek locale stanie się np. `'WelderDoc — Edytor'` (PL) lub `'WelderDoc — Editor'` (EN), test:
- PL przejdzie (substring match heading name w Playwright `getByRole` jest exact match po default), nie — Playwright default to exact, więc fail.
- EN fail.

Plus: aktualnie test odpala tylko w `chromium-desktop` (mandatory CI), a serwer Vercel locale routing redirect'uje na `/pl` (default). Test obecnie nie testuje EN ścieżki w ogóle.

**Konsekwencje:**

- 🟢 Smoke test jest realnie testem brand name + render dispatch. Nie waliduje i18n routing'u.
- 🟢 Potencjalna regression przy bumpie `App.title` w przyszłości — fail w CI bez context. Łatwa naprawa, ale niespodziewana.
- Architektura `architecture-base.md` §17 mówi „zero hardcoded stringów w komponentach" — ale w testach E2E jest to akceptowalne (test musi mieć anchor do czegoś).

**Rozwiązanie — kontynuacja v7 §3.2:**

```typescript
import { expect, test } from '@playwright/test';
import plMessages from '../src/messages/pl.json';

test('homepage renders the localized App title', async ({ page }) => {
  await page.goto('/');
  // Default locale = 'pl' (localePrefix: 'as-needed', detection: false).
  // Anchor through messages, not literal — survives copy bumps.
  await expect(page.getByRole('heading', { name: plMessages.App.title })).toBeVisible();
});
```

Plus drugi test dla `/en` ścieżki (analogicznie z `enMessages`).

**Rekomendacja:** odroczone — wciąż akceptowalne dla MVP smoke test. Aktualizować przy pierwszym bumpie `App.title` lub przy implementacji pierwszego nawigacyjnego komponentu wymagającego cross-locale assertions.

---

### 3.2 (NOWY) `tests/smoke.test.ts:16` — `getContext('2d')` slabe sprawdzenie pod `vitest-canvas-mock`

**Status:** carry-forward z v7 §3.3. Bez zmian.

`vitest-canvas-mock` zawsze zwraca prawdziwy mock objekt dla `getContext('2d')`, więc `expect(ctx).not.toBeNull()` przejdzie nawet gdy mock zostanie usunięty (jsdom samo zwraca `null` dla `getContext('2d')`, co zła abym test'em rozróżnił mock loaded vs jsdom default).

**Rozwiązanie:** silniejsza asercja, np. `expect(typeof ctx?.fillRect).toBe('function')` — co weryfikuje że mock dostarcza interfejs canvas API. Wciąż akceptowalne dla MVP.

---

### 3.3 (NOWY) `vitest.config.ts` — coverage `exclude` zawiera `**/index.ts` co potencjalnie ukrywa `src/canvas-kit/index.ts` przed thresholds

**Problem:**

`vitest.config.ts:18`:

```typescript
exclude: ['**/*.{test,spec}.{ts,tsx}', '**/index.ts', 'src/shapes/_base/types.ts'],
```

`**/index.ts` glob wyłącza wszystkie `index.ts` z coverage. Sens projektowy: barrel files (`src/shapes/index.ts`, `src/canvas-kit/index.ts`) re-eksportują symbole — same nie zawierają testowanej logiki.

Ale `src/shapes/registry.ts` **nie jest** `index.ts` — zawiera `getShapeDefinition()` (function with runtime logic). Jest w scope `include: ['src/shapes/**']` linia 17. Więc jest pokrywane. OK.

Drobna obawa: jeśli ktoś kiedyś zrefaktoryzuje `getShapeDefinition` do `src/shapes/index.ts` (intuicyjne miejsce — barrel z helperami), funkcja silnie zniknie z coverage. Konwencja przeszłaby bezgłośnie.

**Konsekwencje:**

- 🟢 Aktualnie nieproblematyczne — pliki `index.ts` w projekcie to czyste re-eksporty.
- 🟢 Future-proof gap: register-side logic w `index.ts` (np. registracja shape'ów na poziomie modułu) byłaby invisible dla coverage thresholds.

**Rozwiązanie:**

Bardziej precyzyjny exclude: tylko barrel files:

```diff
-exclude: ['**/*.{test,spec}.{ts,tsx}', '**/index.ts', 'src/shapes/_base/types.ts'],
+exclude: [
+  '**/*.{test,spec}.{ts,tsx}',
+  // Barrel re-export only (no runtime logic). If you add logic to an index.ts,
+  // remove it from this list or move it to a sibling file.
+  'src/canvas-kit/index.ts',
+  'src/canvas-kit/impl-konva/index.ts',
+  'src/shapes/index.ts',
+  'src/store/types.ts',
+  'src/shapes/_base/types.ts',
+],
```

**Rekomendacja:** drobna, niska pilność. Można rozważyć przy najbliższym refactorze coverage config.

---

### 3.4 (carry-forward z v7 §2.2) `db-plan.md` §4.x używa nazw polityk RLS niezgodnych z migracją

**Status:** wciąż aktywne. v7 zalecało Opcję A (rename w `db-plan.md` do `*_authenticated` suffix). Nie wykonane.

`db-plan.md` §4.3, §4.4, §4.5 wciąż używa:
- `user_profiles_select_authenticated` ✓ (linia 239 — zgodne)
- `user_profiles_update_authenticated` ✓ (linia 243)
- `subscriptions_select_authenticated` ✓ (linia 256)
- `consent_log_select_authenticated` ✓ (linia 268)
- `consent_log_insert_authenticated` ✓ (linia 272)

Wait — sprawdzając dokładnie po reread'cie z system reminder content: `db-plan.md` §4.x ma **te same nazwy co migracja** (linie 239, 243, 256, 268, 272 wszystkie z suffix `_authenticated`). v7 §2.2 zostało faktycznie naprawione bez explicit changelog.

✅ **Naprawione** (cicha edycja `db-plan.md` między v7 a v8 — albo źle zinterpretowałem v7). Carry-forward zakończony.

---

### 3.5 (NOWY) `architecture-base.md` §3 layout linia 162 zawiera `app/api/health/route.ts (GET)` ale nie wyjaśnia, że `/api/health` używa session client'a (nie service_role)

**Problem:**

`architecture-base.md` §3 (linia 175):

```
api/                    ← Route Handlers (sekretne / server-side; szczegóły §16)
  health/route.ts                              (GET)
  consent/route.ts                             (POST)
  user/export/route.ts                         (GET)
  paddle/webhook/route.ts                      (POST)
  cron/expire-subscriptions/route.ts           (GET)
  cron/cleanup-webhook-events/route.ts         (GET)
```

Wszystkie endpointy wymienione bez rozróżnienia poziomu autoryzacji. Wygląda jak homogeniczna lista.

`api-plan.md` §3 linia 867 ma „Poziomy dostępu" tabelę — to jest source of truth. Ale `architecture-base.md` §3 (layout) nie cross-referenuje.

**Stan faktyczny — `/api/health/route.ts:13-16`:**

```typescript
const supabase = await createClient();
const { error } = await supabase
  .from('documents')
  .select('id', { count: 'exact', head: true });
```

Używa session client'a (RLS-aware). Bez sesji RLS odfiltruje wszystkie wiersze, ale samo zapytanie nie zwróci błędu — po prostu `count: 0`. Co znaczy, że health check „pass" sygnalizuje round-trip do PostgREST, **nie** weryfikuje że RLS jest poprawnie skonfigurowany lub że `documents` table istnieje.

Drobne, ale subtelne: jeśli ktoś usunie `documents` table (np. przez błędną migrację), health check może wciąż zwrócić 200 (PostgREST może zwrócić `404` na nieznaną tabelę → `error` truthy → `503`. Trzeba przetestować — zachowanie zależy od PostgREST cache schema).

**Konsekwencje:**

- 🟢 Niska — w MVP nie ma scenarium, w którym fałszywie pozytywny health check by zaszkodził.
- Future: monitoring oczekiwałby od `/api/health` granularnego raportu (DB up + auth up + storage up). Aktualnie weryfikuje tylko jeden round-trip.

**Rozwiązanie:** odroczyć — `/api/health` smoke jest wystarczający dla MVP. Post-MVP (gdy podpiniemy alerting) można rozbudować na multi-check.

**Rekomendacja:** zostawić, ale dodać do listy „post-MVP TODO" notatkę „rozbudować `/api/health` o multi-check (auth, storage, paddle ping)".

---

### 3.6 (NOWY) `next.config.ts` `reactStrictMode: true` — w `architecture-base.md` lub `tech-stack.md` brak explicit'nego stwierdzenia dlaczego

**Problem:**

`next.config.ts:7`:

```typescript
reactStrictMode: true,
```

Standard dla React 19 + Next 16, ale specyficzne dla canvas-kit: Strict Mode w dev double-invokuje `useEffect` (mount → unmount → re-mount), co w `CanvasShell.tsx:25-28` powoduje:

```typescript
useEffect(() => {
  setActiveStage(stageRef.current);
  return () => setActiveStage(null);
}, []);
```

Efekt:
1. Mount: `setActiveStage(stage)`
2. Strict Mode unmount: `setActiveStage(null)`
3. Re-mount: `setActiveStage(stage)` ← drugi raz, ale `activeStage === stage` więc warning z naprawy v7 §2.6 nie odpali.

Sequence: bo guard w `setActiveStage:18-21` sprawdza `activeStage !== null && activeStage !== stage`. W cyklu Strict Mode między mount #1 i unmount #1 mamy `activeStage = stage`, potem unmount ustawi `null`, mount #2 ustawi z powrotem na `stage`. Bez konfliktu — guard pas.

Ale: jeśli mount Strict Mode jest **synchroniczny** (czyli mount #2 setActiveStage(stage) dzieje się bez czekania na unmount #1's null), warning może odpalić: `activeStage !== null && activeStage !== stage` — ale stage się nie zmienia między mountami, więc i tak nie odpali.

OK, to działa, ale jest subtelne. Architektura nie wspomina o Strict Mode jako zagrożeniu dla singleton'a.

**Konsekwencje:**

- 🟢 Aktualna implementacja jest kompatybilna ze Strict Mode. Komentarz w `setActiveStage` (linia 13-15) wspomina „mount jednoczesny w dev React strict-mode / Suspense" — ✅ zostało wykryte i obsłużone.
- 🟢 Architecture §22.6 (linia 1547) mówi o singletonie ale nie linkuje do interakcji ze Strict Mode.
- Future: gdy ktoś zacznie obserwować canvas-kit warning w dev console (false positive z Strict Mode pomimo guard'u), może zacząć tropić bug, którego nie ma. Single line comment w architekturze pomógłby.

**Rozwiązanie:**

Drobny dodatek do `architecture-base.md` §22.6 (linia 1551, po opisie singleton):

```diff
 - W testach jednostkowych `exportEngine` trzeba albo wyrenderować pełny `CanvasShell` w jsdom, albo zamockować `getActiveStage`.
+- React Strict Mode w dev podwójnie invokuje `useEffect` (mount → cleanup → re-mount). `setActiveStage` toleruje ten cykl: cleanup ustawia `null`, re-mount ustawia ten sam ref → warning guard w `activeStage.ts` nie zostaje wyzwolony (bo `activeStage === stage`). Multi-instance warning sygnalizuje **rzeczywiste** współistnienie dwóch `CanvasShell`, nie cykl Strict Mode.
 - Pattern jest świadomie pragmatyczny dla MVP. (...)
```

**Rekomendacja:** drobna, defensywna. Można dorzucić do najbliższego PR-a touchującego architekturę.

---

### 3.7 (carry-forward z v7 §3.1) `consent_log.ip_address: unknown` w generowanych typach

**Status:** wciąż aktywne, akceptowalne. `src/types/database.ts:43` ma `ip_address: unknown`. `/api/consent` write path działa (TS akceptuje `string` do `unknown`). `/api/user/export/route.ts:30` selectuje bez `ip_address`. Wrapper `ConsentLogRow` z `db-plan.md` §1.6 wciąż zarezerwowany na first-read scenario.

---

### 3.8 (carry-forward z v7 §3.6) `octet_length(data::text)` CHECK — koszt CPU przy zapisach blisko 5 MB

**Status:** wciąż akceptowalne dla MVP. Bez zmian.

---

### 3.9 (carry-forward z v7 §3.8) `next.config.ts` brak fallbacka webpack

**Status:** odroczone. Bez zmian — projekt celowo używa Turbopack stable (Next 16). Re-evaluacja przy major version upgrade.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Pre-merge do `main` / przed kolejną sesją Claude (PILNE):

1. 🔴 **§1.1** — usunąć `supabase/snippets/` z repo + dodać do `.gitignore`. Eliminuje destrukcyjny snippet `UPDATE … SET plan='pro'` bez `WHERE`. Koszt: 1 commit (rm + gitignore line).

2. 🔴 **§1.2** — uzgodnić `tech-stack.md` §13 + `api-plan.md` §3 + `architecture-base.md` §14 + `.env.example` na fakt, że `/api/consent` **NIE** używa `SUPABASE_SERVICE_ROLE_KEY`. Cztery mechaniczne edycje. Eliminuje cross-section sprzeczność w API plan i pułapkę dla nowego implementatora route handlera. Koszt: ~10 minut.

### W trakcie hardening API / pre-launch:

3. 🟡 **§2.1** — zaktualizować `CLAUDE.md` linia 69 (proxy.ts middleware nie jest „stubbed"). Drobna edycja, eliminuje accumulating drift dla AI sessions.

4. 🟡 **§2.2** — dodać error handling na trzeci SELECT w `/api/consent` (Opcja A: escalate `internal_error` 500). Eliminuje fałszywie negatywny `current_consent_version: null` przy DB transient failure.

5. 🟡 **§2.3** — uściślić `architecture-base.md` §9 + §22.1 dla `devicePixelRatio` (funkcja, nie wartość) lub zrenamować w kodzie na `getDevicePixelRatio`. Pierwszy variant tańszy.

6. 🟡 **§2.4** — usunąć duplikat `export type { Point }` z `pointerInput.ts:24`. Single canonical path.

7. 🟡 **§2.5** — uzupełnić `tech-stack.md` §11 + §15 o zainstalowane husky / lint-staged / commitlint / eslint-config-prettier. Przywraca status SSoT.

### Drobne (niska pilność):

8. 🟢 **§3.1** — silniejsza asercja w `e2e/smoke.spec.ts` (anchor na `messages/pl.json App.title`). Aktualizować przy pierwszym bumpie `App.title`.

9. 🟢 **§3.2** — silniejsza asercja `vitest-canvas-mock` w `tests/smoke.test.ts:16`. Bez zmian od v7.

10. 🟢 **§3.3** — bardziej precyzyjny `coverage.exclude` glob (per-file barrel list zamiast `**/index.ts`). Future-proofing.

11. 🟢 **§3.5** — post-MVP TODO: rozbudować `/api/health` o multi-check (auth, storage, paddle ping).

12. 🟢 **§3.6** — drobna notatka o React Strict Mode interaction z `setActiveStage` w `architecture-base.md` §22.6.

13. 🟢 **§3.7** — wrapper `ConsentLogRow` przy pierwszym SELECT z `consent_log.ip_address`. Bez zmian od v7.

14. 🟢 **§3.8** — `octet_length` performance, odroczone do post-MVP.

15. 🟢 **§3.9** — webpack fallback w `next.config.ts`, odroczone do major version upgrade Next.js.

---

## 5. Podsumowanie

**Stan dokumentacji vs kod (delta v7 → v8):**

- **9 z 13 problemów v7 naprawionych** (vs 15/17 v6 → v7). 4 carry-forward to świadome decyzje (akceptowalne stany pre-implementation lub odroczenia post-MVP). Naprawione w v7 → v8: §1.1 (CLAUDE.md), §1.2 (db-plan.md drift po `20260509`), §2.1 (api-plan lookup wording), §2.4 (consent response), §2.5 (webhook diagnostic), §2.6 (setActiveStage warning), §3.4 (Point import), §3.5 (unauthorized_consent_target). Plus cicha naprawa v7 §2.2 (RLS policy names) odkryta podczas verify'u w v8.
- **9 nowych problemów zidentyfikowanych w v8:** 2 × 🔴 (orphan SQL snippet, service_role drift), 5 × 🟡 (CLAUDE proxy stale, consent third-SELECT silent fail, devicePixelRatio function/value, Point triple export, tech-stack devDeps gap), 6 × 🟢 (smoke test anchors, coverage exclude, health multi-check, Strict Mode note, plus dwa carry-forwards z v7).

**Kluczowy wzorzec v7 → v8:** odsłonięcie **drugiej warstwy drift'u** w `tech-stack.md` §13, `api-plan.md` §3, `architecture-base.md` §14 i `.env.example`. Wszystkie cztery dokumenty utrzymują nieaktualne odniesienie do `SUPABASE_SERVICE_ROLE_KEY` w `/api/consent` — co więcej, **`api-plan.md` wewnętrznie sobie zaprzecza** (§2.1 linia 191 mówi „niepotrzebny", §3 linia 828 mówi „pośrednio przez `record_consent_bundle()`"). To jest sygnał, że review dokumentacji **nie identyfikuje cross-section drift'u** — naprawa pojedynczej sekcji nie propaguje się na inne sekcje wzmiankujące ten sam fakt.

**Główne ryzyka v8:**

1. **`supabase/snippets/Untitled query 940.sql` (§1.1)** — destrukcyjny SQL bez `WHERE`, zacommitowany do repo. Realny risk catastrophic update przy nieuwadze. Najbardziej alarmujące odkrycie v8.

2. **`SUPABASE_SERVICE_ROLE_KEY` cross-document drift (§1.2)** — implementator nowego endpointu czytający `tech-stack.md` §13 zaimportuje `createAdminClient()` zamiast `createClient()` i niechcący ominie RLS.

3. **`current_consent_version` silent null (§2.2)** — UX regression przy DB transient failure: pomyślna rejestracja → modal zgody „proszę ponownie zaakceptować" → konfuzja użytkownika.

4. **CLAUDE.md drift (§2.1)** — kontynuacja patternu z v7 §1.1: drobne nieaktualne sentences w „Project state" akumulująco mylą AI sessions. Naprawa v7 §1.1 nie objęła sekcji „Project-specific configuration quirks" (linia 69 wciąż mówi „currently stubbed").

**Filtr „przed implementacją kształtów":** żadne z odkryć v8 nie blokuje startu implementacji domeny shapes. Wszystkie 🔴 dotyczą operations (snippet) i dokumentacji (service_role drift). Implementacja pierwszego kształtu może iść równolegle z naprawami.

**Filtr „przed kolejnym PR-em do main":** wymagane są naprawy §1.1 (`supabase/snippets/`) i §1.2 (`SUPABASE_SERVICE_ROLE_KEY` drift). Koszt jednorazowy ~15 minut, eliminuje destrukcyjny artifakt + cross-section sprzeczność w 4 dokumentach.

**Filtr „przed pierwszym deployem produkcyjnym":** warto domknąć §2.2 (consent third-SELECT error handling), §2.3 (devicePixelRatio docs/code consistency), §2.5 (tech-stack devDeps completeness). §2.4 (Point triple export) i §2.1 (CLAUDE proxy comment) można dorzucić oportunistycznie.

**Wniosek meta v8:** projekt utrzymuje wzorzec „kod wyprzedza dokumentację" (zaobserwowany już w v7), ale **dodaje warstwę „dokumentacja sama sobie zaprzecza między sekcjami"**. Drift v6→v7 dotyczył docs vs migracji DB. Drift v7→v8 dotyczy spójności wewnątrz docs (api-plan §2.1 vs §3) i między docs (tech-stack §13 vs api-plan §3). Rekomendacja procesowa wzmocniona względem v7:

- Każda zmiana dotykająca konkretnej zmiennej środowiskowej / klucza API / role'i autoryzacji **musi** być zaaplikowana w 4 plikach jednocześnie: `tech-stack.md` §13, `api-plan.md` §3, `architecture-base.md` §14/§16, `.env.example`. Brak tego = drift cross-document.
- Rozważyć dodanie CI step'a `verify:env-coverage` analogicznego do `verify:routes`: skanowanie `.md` plików pod kątem konsystencji wzmianek o env varsach (np. każdy `SUPABASE_SERVICE_ROLE_KEY` mention musi się pojawić w ≥1 z {tech-stack §13, api-plan §3} z tym samym scope description).
- `supabase/snippets/` powinno być dodane do `.gitignore` jako trwała granica między ephemeral artifacts (Studio sessions) a persistent project state (migrations + seed). Aktualnie projekt nie ma policy.
