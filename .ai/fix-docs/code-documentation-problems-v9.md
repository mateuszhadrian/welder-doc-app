# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v9)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 9.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, `.ai/code-documentation-problems-v8.md`, kod w `src/` (route handlery, canvas-kit, lib, store, shapes, app/[locale]), migracje w `supabase/migrations/`, `supabase/config.toml`, `vercel.json`, `.github/workflows/ci.yml`, `scripts/verify-routes.sh`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `next.config.ts`, `.env.example`, `.gitignore`, `CLAUDE.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation domeny shape'ów. Warstwa API (5 Route Handlerów), 3 migracje Supabase i `lib/ipAnonymize.ts` zaimplementowane i pokryte testami. Logika domeny (shapes, weld-units, store slices, components canvas) wciąż nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora/operations.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v8

| # v8 | Tytuł | Status (v9) | Komentarz |
|---|---|---|---|
| 1.1 | `supabase/snippets/Untitled query 940.sql` — destrukcyjny snippet | ✅ **Naprawione** | Katalog `supabase/snippets/` fizycznie usunięty z repo; `.gitignore` linie 47–50 zawiera entry `supabase/snippets/` z komentarzem wyjaśniającym (źródło: v8 §1.1). |
| 1.2 | Cross-document drift `SUPABASE_SERVICE_ROLE_KEY` w `/api/consent` | ✅ **Naprawione** | `.env.example` linie 9–13, `api-plan.md` §3 linia 829, `architecture-base.md` §14 linie 1097–1102, `tech-stack.md` §13 linia 290 — wszystkie uzgodnione, że `/api/consent` używa klienta sesji + RPC `record_consent_bundle()` (`SECURITY DEFINER`, exec jako `postgres`), nie `service_role`. |
| 2.1 | `CLAUDE.md` linia 69 — proxy.ts opisany jako „currently stubbed" | 🔴 **NIE naprawione** | `CLAUDE.md` linia 69 wciąż ma sentence „is the place to add Supabase `updateSession()` (currently stubbed)". Stan faktyczny: `src/proxy.ts:21-32` ma pełną implementację chain'a `updateSession() → next-intl`, a `src/lib/supabase/middleware.ts:5-36` realizuje refresh tokena. Patrz §2.1 v9. |
| 2.2 | `consent/route.ts:117` — silent fallback `current_consent_version: null` | 🟡 **NIE naprawione** | Kod nadal destrukturyzuje tylko `data` (linia 117), ignoruje `error` z trzeciego SELECT. Patrz §2.2 v9. |
| 2.3 | `devicePixelRatio` jako wartość vs funkcja w docs | 🟡 **NIE naprawione** | `architecture-base.md` §9 linia 798 wciąż pisze `<Stage pixelRatio={devicePixelRatio}>` bez nawiasów. Patrz §2.3 v9. |
| 2.4 | Triple `Point` re-export (`primitives.ts` + `index.ts` + `pointerInput.ts`) | 🟡 **NIE naprawione** | `src/canvas-kit/pointerInput.ts:24` wciąż ma `export type { Point }`. Patrz §2.4 v9. |
| 2.5 | `tech-stack.md` §15 nie pokrywa zainstalowanych narzędzi | 🟡 **NIE naprawione** | Wciąż brakuje `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`, `eslint-config-prettier`, `@eslint/eslintrc` w `tech-stack.md` §11/§15. Patrz §2.6 v9. |
| 3.1 | `e2e/smoke.spec.ts` szuka literalnego `'WelderDoc'` | 🟢 **Wciąż akceptowalne** | Bez zmian; aktualizować przy pierwszym bumpie `App.title`. |
| 3.2 | Słaba asercja `getContext('2d')` w `tests/smoke.test.ts` | 🟢 **Wciąż akceptowalne** | Bez zmian od v7. |
| 3.3 | `vitest.config.ts` `**/index.ts` glob w `coverage.exclude` | 🟢 **Bez zmian** | Aktualnie nieproblematyczne; pliki `index.ts` to czyste re-eksporty. |
| 3.5 | Architecture §3 layout — brak rozróżnienia poziomu auth dla endpointów | 🟢 **Wciąż akceptowalne** | Bez zmian; `api-plan.md` §3 jest source of truth dla poziomów dostępu. |
| 3.6 | Notatka o React Strict Mode interakcji z `setActiveStage` | 🟢 **Bez zmian** | `architecture-base.md` §22.6 nie ma jeszcze tej notatki. Defensywna, niepilna. |
| 3.7 | `consent_log.ip_address: unknown` w `database.ts` | 🟢 **Wciąż akceptowalne** | Bez zmian; nikt jeszcze nie czyta tego pola. |
| 3.8 | `octet_length(data::text)` performance | 🟢 **Wciąż akceptowalne** | Bez zmian, do post-MVP. |
| 3.9 | `next.config.ts` brak webpack fallback | 🟢 **Odroczone** | Bez zmian; odroczone do major version upgrade Next.js. |

**Wniosek:** **2 z 15 problemów v8 naprawionych** (vs 9/13 w cyklu v7→v8). Naprawione: §1.1 (snippets) + §1.2 (service_role drift). 5 z 6 istotnych (🟡) i 1 krytyczny (🔴 — `CLAUDE.md` „currently stubbed") **carry-forward bez akcji** — to **regres tempa naprawiania względem cyklu v7→v8**. Hipoteza: cykl v8 był „big-bang" naprawą cross-document drift'u (`tech-stack.md` §13, `api-plan.md` §3, `architecture-base.md` §14, `.env.example` synchronicznie), pozostałe drobniejsze edycje (`CLAUDE.md` linia 69, `consent/route.ts` error handling, `tech-stack.md` §15 devDeps) nie zostały podjęte.

Poniżej — **nowe problemy zidentyfikowane w v9** plus eskalacja statusu carry-forwardów wymagających pilnej akcji.

---

## 1. 🔴 Krytyczne

### 1.1 (NOWY) Migracja `20260507` `COMMENT ON COLUMN public.user_profiles.current_consent_version` — kłamie o source of write

**Problem:**

`supabase/migrations/20260507000000_complete_schema.sql:535-536`:

```sql
comment on column public.user_profiles.current_consent_version is
  'denormalised version of the most recent accepted consent bundle (tos+pp+cookies); read-only for the authenticated role (block_protected_columns_update trigger); written exclusively by the /api/consent route handler running as service_role after a successful bundle insert into consent_log';
```

**Stan faktyczny po migracjach `20260508000000_record_consent_bundle.sql` + `20260509000000_paddle_webhook_hardening.sql`:**

1. `current_consent_version` jest zapisywana wyłącznie przez funkcję `record_consent_bundle()` (`SECURITY DEFINER`) — migracja `20260508000000` linie 24–68.
2. Funkcja wykonuje się jako rola `postgres` (właściciel — czyli `current_user = 'postgres'`).
3. `/api/consent` route handler (`src/app/api/consent/route.ts:59`) używa **klienta sesji** (`createClient()` z `@supabase/ssr`), **NIE** `createAdminClient()`/`service_role`. Wywołanie RPC: `supabase.rpc('record_consent_bundle', {...})` (linia 80).
4. Bypass triggera `block_protected_columns_update` realizowany jest przez gałąź `current_user = 'postgres'` (migracja `20260509000000` linie 71–73), **nie** `auth.role() = 'service_role'`.

Komentarz w `pg_description` (czyli to, co czyta Supabase Studio + `supabase gen types typescript --schema public > src/types/database.ts`) twierdzi coś dokładnie odwrotnego: „written exclusively by the /api/consent route handler running as **service_role**".

**Konsekwencje:**

- 🔴 **Najgorsza droga reproducible:** developer otwiera Supabase Studio → kolumna `current_consent_version` → tooltip pokazuje komentarz z `pg_description`. Albo: developer biegnie `pnpm supabase:types`, plik `src/types/database.ts` zostaje wygenerowany ze schemy DB; gdy w przyszłości narzędzia genrowania typów zaczną załączać komentarze (niektóre `supabase gen types` flagi już to robią), cała sekcja TS Types pokaże stale info.
- 🔴 **Implementator nowego endpointu RODO** — np. `/api/consent/revoke-all` dla pełnego wycofania zgody przed RODO art. 17 — czytając komentarz, zaprojektuje go z `createAdminClient()` zamiast `createClient()` (bo „komentarz mówi że tak się zapisuje `current_consent_version`"). Niepotrzebnie zwiększa surface attack przez service_role.
- 🔴 **Nie da się tego naprawić edycją historycznej migracji** — migracje są immutable artifacts (`db-supabase-migrations.md` polityka). Wymaga **nowej migracji** (`YYYYMMDDHHmmss_fix_consent_version_comment.sql`) re-issuującej `COMMENT ON COLUMN`.
- **`api-plan.md` §3, `tech-stack.md` §13, `architecture-base.md` §14, `.env.example`** zostały już naprawione w v8 §1.2 — komentarz w samej migracji jest **ostatnim miejscem** w projekcie, gdzie wciąż żyje fałszywa informacja o service_role w consent flow. Cross-document drift niemal kompletnie zlikwidowany — zostaje tylko `pg_description`.

**Rozwiązanie:**

Nowa migracja z poprawkami COMMENT ON. Treść:

```sql
-- migration: 20260510000000_fix_consent_version_comment.sql
-- purpose: fix outdated comment on user_profiles.current_consent_version
-- reason: original comment from 20260507000000 claims the column is written
--         by the /api/consent handler running as service_role. that is no
--         longer accurate after migrations 20260508000000 (record_consent_bundle
--         security definer) and 20260509000000 (block_protected_columns_update
--         postgres-owner bypass). actual write path:
--           - /api/consent uses session-scoped client (createClient from @supabase/ssr)
--           - rpc record_consent_bundle (SECURITY DEFINER) executes as postgres role
--           - block_protected_columns_update bypass via `current_user = 'postgres'`
--         this comment goes into pg_description, supabase studio tooltips, and
--         supabase gen types output, so the drift surfaces to every consumer.

comment on column public.user_profiles.current_consent_version is
  'denormalised version of the most recent accepted consent bundle (tos+pp+cookies); read-only for the authenticated role (block_protected_columns_update trigger); written exclusively by the SECURITY DEFINER function record_consent_bundle() (executes as postgres role, bypassing block_protected_columns_update via current_user = ''postgres'' branch added in 20260509000000) — invoked by the /api/consent route handler operating on a session-scoped client (NOT service_role).';
```

**Powiązane:** także `architecture-base.md` §15 linia 1157 mówi „chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`" — jest to skrót, ale powinien wymienić oba bypassy (`postgres` + `service_role`) lub jednoznacznie wskazać `db-plan.md` §1.2 (który ma pełny opis). Patrz §3.6 v9.

**Rekomendacja:** **Pilne** — koszt 1 migracji + 1 PR. Eliminuje ostatnie miejsce drift'u service_role/`record_consent_bundle` w projekcie. **Najbardziej alarmujące odkrycie v9** — analogicznie do v8 §1.1 destrukcyjnego snippetu, identyfikuje stale informacje w runtime artifactach (Studio, generated types) zamiast tylko w `*.md` plikach.

---

### 1.2 (CARRY-FORWARD z v8 §2.1, ESKALOWANE z 🟡 do 🔴) `CLAUDE.md` linia 69 — `proxy.ts` opisany jako „currently stubbed"

**Status:** ESKALOWANE z 🟡 (v8) na 🔴 (v9). v8 zaklasyfikowało jako 🟡 i niepilne; v9 obserwuje, że to nie zostało naprawione przez kolejny cykl, a jednocześnie problem ma realny wpływ na każdą sesję Claude Code czytającą plik (CLAUDE.md jest zawsze ładowany do kontekstu). Akumulujący koszt opóźnienia.

**Problem:**

`CLAUDE.md` linia 69:

> **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains `next-intl` middleware and is the place to add Supabase `updateSession()` (currently stubbed).

**Stan faktyczny:**

`src/proxy.ts:21-32` ma **pełną implementację**:

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

`src/lib/supabase/middleware.ts:5-36` realizuje:
- `createServerClient` z `@supabase/ssr`
- Cookie chaining: `getAll()` z requesta + propagacja `setAll` do `supabaseResponse`
- Wywołanie `auth.getUser()` na każdym requeście w celu refresh JWT

To jest **kanoniczna implementacja** z `@supabase/ssr` docs, nie stub. Patrz: `architecture-base.md` §16 linia 1191: „Supabase musi odświeżyć token przed routingiem locale".

**Konsekwencje:**

- 🔴 **Każda nowa sesja Claude Code** ładuje CLAUDE.md jako pierwszy kontekst (zgodnie z system reminder). Sentence „currently stubbed" prowokuje:
  - duplikację istniejącego kodu (Claude próbuje „dorobić" stub)
  - wprowadzenie konfliktów z proxy.ts w PR-ach generowanych przez AI
  - mylne raporty „missing implementation" w sesjach typu „check what's left"
- 🔴 **Nowy human developer** czytając CLAUDE.md jako onboarding doc dostaje fałszywą mapę systemu. Może spędzić godzinę szukając „gdzie powinien być updateSession" zanim zdecyduje się go napisać od zera.
- W połączeniu z naprawą v8 §1.2 (cross-document drift) ten footgun ma **identyczną naturę** — drobny stale-text drift w często czytanym dokumencie. Jego nienaprawienie sygnalizuje, że v8 rekomendacja „każda zmiana proxy.ts/`@supabase/ssr` pociąga edit CLAUDE.md" nie została zinternalizowana.

**Rozwiązanie (z v8, nie zmienione):**

```diff
-- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains `next-intl` middleware and is the place to add Supabase `updateSession()` (currently stubbed).
+- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains Supabase `updateSession()` (`src/lib/supabase/middleware.ts`) → `next-intl` middleware. The chain is mandatory: Supabase must refresh the JWT cookies before next-intl decides on locale rewrite/redirect, and any locale-rewrite response must propagate the `Set-Cookie` headers from the Supabase response. The matcher excludes `/api/*` (Route Handlers refresh sessions on first `auth.getUser()` call inside the handler).
```

**Rekomendacja:** **Pilne** — 1 mechaniczna edycja. Eliminuje akumulującą się dezinformację AI sessions.

---

## 2. 🟡 Istotne

### 2.1 (NOWY) `consent/route.ts:35-40` vs `paddle/webhook/route.ts:99-104` — niespójne kody błędów dla malformed JSON

**Problem:**

Dwa Route Handlery obsługują tę samą klasę błędu (`JSON.parse` failure na request body) inaczej:

**`src/app/api/paddle/webhook/route.ts:99-104`:**

```typescript
let payload: PaddlePayload;
try {
  payload = JSON.parse(rawBody) as PaddlePayload;
} catch {
  return err('invalid_payload', 400, 'malformed JSON in payload');
}
```

**`src/app/api/consent/route.ts:34-40`:**

```typescript
let payload: unknown;
try {
  payload = await request.json();
} catch {
  return err('missing_fields', 400);
}
```

Identyczna sytuacja runtime (klient wysyła nie-JSON body) zwraca dwa różne kody:
- Paddle webhook: `{ "error": "invalid_payload", "message": "malformed JSON in payload" }`
- Consent: `{ "error": "missing_fields" }` (bez `message`)

**Specyfikacja w `api-plan.md`:**

- `api-plan.md` §2.1 linia 88 dla paddle: `400 invalid_payload — "malformed JSON lub brak event_id..."`
- `api-plan.md` §2.1 linia 173 dla consent: `400 missing_fields — "brakujące wymagane pola"`
- `api-plan.md` **NIE specyfikuje** explicit, jak consent ma odpowiedzieć na malformed JSON (tylko na missing required fields).

Czyli implementacja consent skleiła „body nie da się sparsować" z „pola brakują" — ale to są dwa różne błędy klienta:
- malformed JSON = klient wysłał garbage / zły Content-Type / zły encoding
- missing_fields = body to poprawny JSON, ale brakuje wymaganych kluczy

**Konsekwencje:**

- 🟡 **API consumer** (frontend rejestracji, integration test) dostaje `missing_fields` przy bug'u w warstwie HTTP (np. service worker zniekształcił request) → traci czas na debugowaniu „jakich pól brakuje" zamiast „body nie dotarło w całości".
- 🟡 **Pentester** robiąc audit consent endpoint widzi `missing_fields` przy `curl -d '<garbage>'` — niespójne z paddle/webhook → flaga w raporcie jako „inconsistent error vocabulary".
- 🟡 **Future endpoint** dodawany przez nowego dewelopera kopiuje wzorzec z najbliższego sąsiada — jeśli skopiuje z `/api/consent`, propaguje nieintuicyjne mapowanie.

**Rozwiązanie:**

**Opcja A (zalecana):** ujednolicić consent z paddle webhook — używać `invalid_payload` dla malformed JSON:

```diff
 try {
   payload = await request.json();
 } catch {
-  return err('missing_fields', 400);
+  return err('invalid_payload', 400);
 }
```

Plus dodać do `api-plan.md` §2.1 (consent errors table) wiersz:
```
| 400 | `{ "error": "invalid_payload" }` — malformed JSON in request body |
```

**Opcja B:** wyspecyfikować explicit w `api-plan.md`, że consent wybiera `missing_fields` jako catch-all dla każdego problemu z payloadem (akceptować obecną implementację jako prawidłową i udokumentować ją).

**Rekomendacja:** **Opcja A** — eliminuje arbitrary inconsistency w error vocabulary. Koszt: 1 linia kodu + 1 wiersz w `api-plan.md`.

---

### 2.2 (CARRY-FORWARD z v8 §2.2) `consent/route.ts:117-121` — silent fallback `current_consent_version: null` na DB error trzeciego SELECT

**Status:** carry-forward. Treść problemu i rozwiązania bez zmian względem v8 §2.2.

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

`error` z trzeciego SELECT-a jest świadomie ignorowany (destrukturyzacja zwraca tylko `data`). Inne SELECT-y w handlerze (`auth.getUser` linia 60–62, `consent_log` linia 100) escalate'ują do 500 — trzeci nie.

Niespójność z naprawą v7 §2.4: handler poprawnie odczytuje `current_consent_version` z DB zamiast passthrough'ować payload, ale **fallback-na-null** maskuje DB transient failure jako „brak aktywnej zgody".

**Konsekwencje:**

- 🟡 **UX regression dla użytkownika tuż po rejestracji**: pomyślny POST consent → klient widzi `current_consent_version: null` → modal zgody „proszę ponownie zaakceptować" → konfuzja.
- 🟡 Niespójność asymetryczna z innymi SELECT'ami w handlerze.

**Rozwiązanie (z v8, niezmienione):**

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
```

**Rekomendacja:** średnia pilność; warto domknąć przed pierwszym deployem produkcyjnym, bo dotyczy codziennego flow rejestracji.

---

### 2.3 (CARRY-FORWARD z v8 §2.3) `architecture-base.md` §9 + §22.1 — `devicePixelRatio` jako wartość, w kodzie funkcja

**Status:** carry-forward bez zmian.

**Problem:**

`architecture-base.md` §9 linia 798:

> `CanvasShell` → `<Stage pixelRatio={devicePixelRatio}>`

`src/canvas-kit/constants.ts:17-20` definiuje `devicePixelRatio` jako **funkcję**. `src/canvas-kit/impl-konva/CanvasShell.tsx:31` faktycznie woła ją z nawiasami: `pixelRatio={devicePixelRatio()}`.

Implementator pierwszego komponentu kopiujący przepis z architektury napisze bez nawiasów → przekaże referencję funkcji do propa `pixelRatio` (Konva oczekuje `number`) → cichy `NaN` lub silent fallback.

**Rozwiązanie (z v8, niezmienione):** edit dokumentacji albo refactor nazwy na `getDevicePixelRatio()` w kodzie. Edit dokumentacji tańszy.

**Rekomendacja:** drobna mechaniczna edycja w `architecture-base.md` §9 i §22.1.

---

### 2.4 (CARRY-FORWARD z v8 §2.4) `pointerInput.ts:24` — duplikat `export type { Point }`

**Status:** carry-forward bez zmian.

**Problem:** `Point` jest re-eksportowany 3 razy z `src/canvas-kit/`. `src/canvas-kit/pointerInput.ts:24` ma redundantny `export type { Point }` — kanoniczne źródło to `src/canvas-kit/primitives.ts`, publiczna ścieżka to `@/canvas-kit` (przez `index.ts:33`).

**Rozwiązanie (z v8, niezmienione):** usunąć linię 24 z `pointerInput.ts`. Konsumenci `PointerGesture` importują z `@/canvas-kit` (barrel zwraca oba typy).

**Rekomendacja:** drobna edycja, koszt 1 linia.

---

### 2.5 (NOWY) `tech-stack.md` §14 — brak skryptów `supabase:types:local` + `prepare`

**Problem:**

`tech-stack.md` §14 (linie 305–331) listuje skrypty `package.json`. Stan faktyczny `package.json:6-24`:

```json
"scripts": {
  "dev": "next dev",
  ...
  "supabase:types": "dotenv -e .env.local -- bash -c '...'",
  "supabase:types:local": "supabase gen types typescript --local --schema public > src/types/database.ts",  ← brak w tech-stack §14
  "verify:routes": "bash scripts/verify-routes.sh",
  "prepare": "husky"  ← brak w tech-stack §14
}
```

Oba skrypty (`supabase:types:local` i `prepare`) są obecne w kodzie, brak w tech-stack.md §14.

`CLAUDE.md` Commands section zawiera `pnpm supabase:types:local` (linia 32) — czyli ta komenda jest legitnie używana w workflow projektu, nie jest accidental.

**Konsekwencje:**

- 🟡 `tech-stack.md` traci status SSoT dla skryptów. Onboarding developer kopiujący package.json scripts rozdział z tech-stack.md straci dostęp do lokalnego type-gen flow.
- 🟡 `prepare: "husky"` jest **wymagane** dla pierwszego `pnpm install` (instaluje hooks). Brak entry sugeruje, że hooks są zainstalowane „magicznie" → mylenie debug `git commit` failures.
- Drift jest spójny ze v8 §2.5 (devDeps gap dla husky/lint-staged/commitlint) — ten sam wektor: pakiety dodane w fazie bootstrap, dokumentacja stack'u nie została zaktualizowana.

**Rozwiązanie:**

`tech-stack.md` §14 — uzupełnić scripts block:

```diff
 {
   "scripts": {
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
     "lint": "next lint",
     "typecheck": "tsc --noEmit",
     "format": "prettier --write .",
     "format:check": "prettier --check .",
     "test": "vitest",
     "test:run": "vitest run",
     "test:ui": "vitest --ui",
     "test:coverage": "vitest run --coverage",
     "test:e2e": "playwright test",
     "test:e2e:ui": "playwright test --ui",
     "supabase:types": "dotenv -e .env.local -- bash -c 'supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts'",
+    "supabase:types:local": "supabase gen types typescript --local --schema public > src/types/database.ts",
-    "verify:routes": "bash scripts/verify-routes.sh"
+    "verify:routes": "bash scripts/verify-routes.sh",
+    "prepare": "husky"
   },
```

Plus uściślić linie poniżej tabeli skryptów: `lint` faktycznie odpala `eslint .` (nie `next lint` — `next lint` jest deprecated w Next 16, używamy bezpośrednio ESLint flat config). To minor — `package.json:10` ma `"lint": "eslint ."`, nie `"next lint"`. Edit dla pełnej spójności z kodem:

```diff
-    "lint": "next lint",
+    "lint": "eslint .",
```

**Rekomendacja:** mechaniczna edycja, niska pilność. Spójna z naprawą v8 §2.5.

---

### 2.6 (CARRY-FORWARD z v8 §2.5) `tech-stack.md` §11 + §15 nie pokrywa zainstalowanych narzędzi

**Status:** carry-forward bez zmian.

**Problem:** `package.json:46-76` zawiera 6 dev-deps, których brak w `tech-stack.md` §11 i §15:

- `husky@^9.0.0`
- `lint-staged@^15.0.0`
- `@commitlint/cli@^19.0.0`
- `@commitlint/config-conventional@^19.0.0`
- `eslint-config-prettier@^9.1.0`
- `@eslint/eslintrc@^3.0.0`

`tech-stack.md` linia 4 deklaruje SSoT: „Single source of truth dla wszystkich technologii i wersji w projekcie". Drift jest naruszeniem tej deklaracji.

**Rozwiązanie (z v8, niezmienione):** dodać sekcję `§11.1 Pre-commit hooks` + uzupełnić listę w §15.

**Rekomendacja:** scalić z naprawą §2.5 v9 (`tech-stack.md` §14 scripts) w jednym PR-cie.

---

## 3. 🟢 Drobne

### 3.1 (NOWY) Migracja `20260507` linie 296–310 — SQL comment block na `block_protected_columns_update` outdated

**Problem:**

`supabase/migrations/20260507000000_complete_schema.sql:296-310` (komentarze `--` przed funkcją):

```sql
-- trigger: silently resets plan, paddle_customer_id and current_consent_version
-- to their existing values when the requesting jwt role is not service_role
...
-- actual writes to:
--   - plan, paddle_customer_id: security definer functions on subscriptions triggers
--     (refresh_user_plan_from_subscriptions, sync_paddle_customer)
--   - current_consent_version: only the /api/consent route handler (service_role)
--     after a successful bundle insert into consent_log; this prevents the client
--     from forging current_consent_version without a corresponding consent_log entry
```

To są SQL comments (`--`), nie `COMMENT ON FUNCTION`. Nie propagują się do `pg_description` ani `supabase gen types`. Ale każdy developer czytający migrację (np. troubleshootujący trigger bypass) dostaje stale info w kontekście, w którym potrzebuje *aktualnej* prawdy.

W przeciwieństwie do §1.1 v9 (COMMENT ON COLUMN), te komentarze są tylko w pliku SQL — niska propagacja, niska pilność.

**Konsekwencje:**

- 🟢 Mylą developera czytającego migrację. Brak runtime impact.
- Naprawa wymagałaby edycji historycznej migracji (zakazane przez `db-supabase-migrations.md`) lub dodania komentarza w nowej migracji wskazującego na aktualną prawdę. Ten drugi wariant jest niskiej wartości — same komentarze nie propagują się przez `pg_description`.

**Rozwiązanie:**

**Opcja A (zalecana):** zostawić komentarze w `20260507` jako historyczny artefakt, dodać preamble w `20260509000000_paddle_webhook_hardening.sql` na samej górze:

```sql
-- HISTORYCZNY KONTEKST: ten plik aktualizuje semantykę komentarzy w 20260507000000.
-- W szczególności komentarze przy `block_protected_columns_update` (lines 296-310 w 20260507)
-- przed tą migracją mówiły, że current_consent_version jest pisane przez service_role.
-- Po tej migracji bypass jest realizowany przez `current_user = 'postgres'` (security definer
-- record_consent_bundle wykonuje się jako postgres owner). Aktualna prawda: db-plan.md §1.2.
```

Migracja `20260509` jest już zaaplikowana — edycja jej preamble byłaby formalnie naruszeniem zasady „migracje są immutable po aplikacji". Ale w MVP, gdzie tylko jeden lokalny developer i greenfield, koszt jest zerowy.

**Opcja B:** zostawić bez zmian — drift jest tylko w pliku SQL, niska pilność. Po pierwszej migracji „rebase" (post-MVP, gdy projekt będzie miał więcej developerów) cały bundle migracji będzie consolidowany.

**Rekomendacja:** **Opcja B** — niska pilność, poczekać na consolidację post-MVP. Naprawa §1.1 v9 (`COMMENT ON COLUMN current_consent_version`) jest wystarczająca dla runtime artifacts.

---

### 3.2 (NOWY) `paddle/webhook/route.ts:174-177` — silent return przy niepełnych danych subskrypcji bez logowania

**Problem:**

`src/app/api/paddle/webhook/route.ts:169-177`:

```typescript
const subId = data.id;
const customerId = data.customer?.id ?? data.customer_id;
const status = mapStatus(data.status);
const planTier = planTierFromPriceId(data.items?.[0]?.price?.id);

if (!subId || !customerId || !status || !planTier) {
  // Niepełne dane — log w `webhook_events.payload`; brak update'u stanu.
  return;
}
```

Komentarz mówi „log w `webhook_events.payload`" — ale to jest log audytowy zdarzenia. **Nie ma logowania alertu** (np. `console.warn`) pod kątem operations dashboardu.

Porównaj z `lookupUserId` orphan path linia 185 — tam jest:

```typescript
console.warn('[paddle/webhook] orphan subscription event — user lookup failed', {...});
```

Czyli niepełne dane dot. user lookup są logowane, ale niepełne dane subskrypcji (brak `priceId` mapowanego, brak `status`, brak `customer_id`) — nie. Asymetria.

**Konsekwencje:**

- 🟢 **Operations** monitorujący Vercel logs nie zobaczy alertu, gdy Paddle zacznie wysyłać payloady z nowym `price_id` (np. testowy plan pre-launch) który nie mapuje się przez `planTierFromPriceId()`. Cisza w logach + brak update'u → debug zaczyna się dopiero gdy użytkownik zgłasza, że upgrade nie zadziałał.
- 🟢 W `webhook_events.payload` jest pełny payload do retroactive forensics, ale developer musi wiedzieć, że tam zaglądać.

**Rozwiązanie:**

```diff
 if (!subId || !customerId || !status || !planTier) {
+  console.warn('[paddle/webhook] subscription event with incomplete data — no state update', {
+    eventId: payload.event_id,
+    eventType: payload.event_type,
+    hasSubId: !!subId,
+    hasCustomerId: !!customerId,
+    hasStatus: !!status,
+    hasPlanTier: !!planTier,
+    rawStatus: data.status,
+    rawPriceId: data.items?.[0]?.price?.id,
+  });
   return;
 }
```

**Rekomendacja:** drobna defensywa, niska pilność. Warta dorzucenia do następnego PR-a touchującego paddle webhook.

---

### 3.3 (NOWY) `architecture-base.md` §15 linia 1157 — `block_protected_columns_update` opisany niekompletnie

**Problem:**

`architecture-base.md` §15 linia 1157 (tabela tabel):

> `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`

Aktualna funkcja (po migracji `20260509000000`) ma **dwa** bypassy:
1. `current_user = 'postgres'` — dla SECURITY DEFINER funkcji wykonujących się jako rola właściciela
2. `auth.role() = 'service_role'` — dla bezpośrednich wywołań z admin client

Zapis architektury nie wymienia bypassu #1, co przy lekturze sekcji daje wrażenie, że jedyną drogą zapisu protected columns jest service_role (analogiczne do v8 §1.2 drift'u, naprawionego w `tech-stack.md` §13 i `api-plan.md` §3).

`db-plan.md` §1.2 ma pełny opis (linie 34–42). Architektura §15 explicite mówi „Source of truth: `.ai/db-plan.md`" (linia 1139) — czyli skrót w architekturze powinien być wystarczająco prawdziwy, by odsyłać do `db-plan.md` bez wprowadzenia w błąd.

**Konsekwencje:**

- 🟢 Niska — czytelnik dotykający trigger logic i tak lądą w `db-plan.md` §1.2.
- 🟢 Może mylić, gdy czytelnik czyta tylko architekturę bez deep-dive do db-plan (np. skanuje §15 w celu zrozumienia RLS).

**Rozwiązanie:**

```diff
-| `user_profiles` | 1:1 z `auth.users`; cache `plan`, `paddle_customer_id`, `current_consent_version`, `locale` | `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated` |
+| `user_profiles` | 1:1 z `auth.users`; cache `plan`, `paddle_customer_id`, `current_consent_version`, `locale` | `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`; bypass dla `current_user = 'postgres'` (SECURITY DEFINER funkcje) i `auth.role() = 'service_role'` (admin client) — patrz `db-plan.md` §1.2 |
```

**Rekomendacja:** drobna edycja, niska pilność. Spójna z naprawą §1.1 v9 (`COMMENT ON COLUMN`).

---

### 3.4 (NOWY) `tech-stack.md` §12 `vercel.json` snippet bez `"$schema"` field

**Problem:**

`tech-stack.md` §12 linie 263–278 pokazuje wzorcowe `vercel.json`:

```json
{
  "regions": ["fra1"],
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile",
  "crons": [...]
}
```

Stan faktyczny `vercel.json:1`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  ...
}
```

Pole `"$schema"` daje IDE intellisense + walidację schematu. Pożądane, ale brakuje w tech-stack snippet.

**Konsekwencje:**

- 🟢 Trivial — copy-paste z tech-stack.md daje funkcjonalny `vercel.json`, tylko bez intellisense IDE.

**Rozwiązanie:**

Dodać linię `"$schema"` do snippetu w `tech-stack.md` §12.

**Rekomendacja:** drobna kosmetyka, niska pilność.

---

### 3.5 (CARRY-FORWARD z v8 §3.1, §3.2, §3.3, §3.5, §3.6, §3.7, §3.8, §3.9)

Wszystkie 🟢 carry-forwardy z v8 pozostają bez zmian względem v8. Patrz tabela w sekcji 0 dla pełnego listingu.

---

### 3.6 (NOWY) `tech-stack.md` §14 linia 313 — `lint` script niezgodny z faktycznym `package.json`

**Problem:**

`tech-stack.md` §14 (snippet scripts):

```json
"lint": "next lint",
```

`package.json:10`:

```json
"lint": "eslint .",
```

`next lint` jest deprecated w Next 16+ — projekt świadomie używa `eslint .` z flat config (`eslint.config.mjs`, zgodne z tech-stack §11). Drift między dokumentacją a kodem.

**Konsekwencje:**

- 🟢 Niska — copy-paste z tech-stack.md → developer ma `next lint`, który albo działa (stary alias) albo loguje warning. Funkcjonalne, ale niespójne.

**Rozwiązanie:** scalić z naprawą §2.5 v9. `lint: "eslint ."` zamiast `lint: "next lint"`.

**Rekomendacja:** drobna edycja, niska pilność. Świadczy o akumulującym się drift'cie tech-stack.md §14 (3 linie scripts wymagają edycji: `lint`, `supabase:types:local` add, `prepare` add).

---

## 4. Rekomendacje priorytetowe (lista działań)

### Pre-merge do `main` / przed kolejną sesją Claude (PILNE):

1. 🔴 **§1.1 v9** — nowa migracja `20260510000000_fix_consent_version_comment.sql` re-issuująca `COMMENT ON COLUMN public.user_profiles.current_consent_version` z aktualną informacją (`record_consent_bundle()` SECURITY DEFINER, exec jako `postgres`, nie service_role). Eliminuje ostatnie miejsce stale info o `service_role` w consent flow (po naprawie cross-document drift'u v8 §1.2). Koszt: 1 plik migracji + `pnpm supabase db reset` lokalnie.

2. 🔴 **§1.2 v9 / v8 §2.1 ESKALOWANE** — edytować `CLAUDE.md` linia 69 — proxy.ts jest faktycznie zaimplementowany, nie „currently stubbed". Eliminuje akumulującą się dezinformację AI sessions (CLAUDE.md zawsze ładowany do kontekstu). Koszt: 1 mechaniczna edycja.

### W trakcie hardening API / pre-launch:

3. 🟡 **§2.1 v9** — ujednolicić `consent/route.ts:35-40` z paddle/webhook na `invalid_payload` dla malformed JSON (Opcja A). Plus dodać wiersz w `api-plan.md` §2.1 errors table dla consent. Koszt: 1 linia kodu + 1 wiersz docs.

4. 🟡 **§2.2 v9 / v8 §2.2** — error handling na trzeci SELECT w `/api/consent` (Opcja A: escalate `internal_error` 500). Eliminuje fałszywie negatywny `current_consent_version: null` przy DB transient failure.

5. 🟡 **§2.3 v9 / v8 §2.3** — uściślić `architecture-base.md` §9 + §22.1 dla `devicePixelRatio` (funkcja, nie wartość) — edit dokumentacji.

6. 🟡 **§2.4 v9 / v8 §2.4** — usunąć duplikat `export type { Point }` z `pointerInput.ts:24`. Single canonical path.

7. 🟡 **§2.5 v9 + §2.6 v9 + §3.6 v9** — uzgodnić `tech-stack.md` §11 + §14 + §15 z faktycznym `package.json`:
   - dodać sekcję `§11.1 Pre-commit hooks` (husky / lint-staged / commitlint / eslint-config-prettier / @eslint/eslintrc)
   - dodać `supabase:types:local` + `prepare` do scripts snippet
   - poprawić `lint: "next lint"` → `lint: "eslint ."`
   - uzupełnić listę devDependencies §15
   
   Wszystkie 4 edycje w jednym PR-cie (akumulujący drift §14/§15 zamknięty).

### Drobne (niska pilność):

8. 🟢 **§3.1 v9** — preamble w `20260509000000_paddle_webhook_hardening.sql` o stale komentarzach SQL w `20260507000000`. Opcja B (skip) jeśli post-MVP planujemy migration consolidation.

9. 🟢 **§3.2 v9** — `console.warn` w paddle/webhook handler dla niepełnych danych subskrypcji.

10. 🟢 **§3.3 v9** — uściślić `architecture-base.md` §15 linia 1157 o oba bypassy `block_protected_columns_update`.

11. 🟢 **§3.4 v9** — dodać `"$schema"` do `vercel.json` snippetu w `tech-stack.md` §12.

12. 🟢 **§3.5 v9 / v8 §3.x carry-forwards** — wszystkie pozostałe drobne carry-forwardy z v8 (smoke test anchors, vitest-canvas-mock weak assertion, coverage exclude, health multi-check, Strict Mode note, ip_address: unknown, octet_length performance, webpack fallback). Brak zmian od v8.

---

## 5. Podsumowanie

**Stan dokumentacji vs kod (delta v8 → v9):**

- **2 z 15 problemów v8 naprawionych** (vs 9/13 w v7→v8). Naprawione: §1.1 (`supabase/snippets/`) + §1.2 (`SUPABASE_SERVICE_ROLE_KEY` cross-document drift). 5 z 6 istotnych (🟡) i 1 krytyczny (🔴) carry-forward bez akcji.
- **6 nowych problemów zidentyfikowanych w v9**: 1 × 🔴 (`COMMENT ON COLUMN current_consent_version` outdated), 1 × 🟡 (consent malformed JSON inconsistency), 1 × 🟡 (tech-stack §14 missing scripts), 3 × 🟢 (SQL comments outdated, paddle silent return, architecture §15 incomplete bypass description, tech-stack vercel.json $schema, lint script mismatch). Plus eskalacja v8 §2.1 z 🟡 na 🔴.

**Kluczowy wzorzec v8 → v9: regres tempa naprawiania.** Cykl v7→v8 naprawił 9 z 13 problemów. Cykl v8→v9 naprawił 2 z 15. Hipoteza:

- v8 zidentyfikowało dwa „big-bang" problemy (snippet + service_role drift), które wymagały skoordynowanej naprawy w wielu plikach jednocześnie. To wymusiło review cross-document drift'u — przy okazji udało się naprawić oba.
- Carry-forwardy z v8 (CLAUDE.md, consent third SELECT, devicePixelRatio, Point export, tech-stack devDeps) to drobne edycje, każdy wymaga „1 linijki" — i każdy w innym pliku. Brak presji „cross-document audit" → żaden nie został podjęty samodzielnie.

**Główne ryzyka v9:**

1. **Migracja `20260507` `COMMENT ON COLUMN current_consent_version` (§1.1 v9)** — ostatnie miejsce drift'u o `service_role` w consent flow, propagowane przez `pg_description` do Supabase Studio i potencjalnie do generowanych typów. Jedyny problem v9, który wymaga **nowej migracji DB** (immutable artifact, nie da się fixnąć edytując starą). Najbardziej alarmujący — analogia do v8 §1.1 (destrukcyjny snippet) i v8 §1.2 (cross-document drift).

2. **CLAUDE.md drift carry-forward (§1.2 v9 / v8 §2.1)** — eskalowane do 🔴. Akumulacyjny koszt: każda nowa sesja Claude Code + każdy nowy human onboarding czyta to samo stale info „proxy.ts is currently stubbed". Naprawa to 1 mechaniczna edycja.

3. **Niespójne error vocabulary między `consent/route.ts` a `paddle/webhook/route.ts` (§2.1 v9)** — `missing_fields` vs `invalid_payload` dla tej samej klasy błędu (malformed JSON). Konsekwencje: API consumer i pentester dostają niespójne sygnały.

4. **Akumulujący drift `tech-stack.md` §14 i §15 (§2.5 v9 + §2.6 v9 + §3.6 v9)** — 3 lekko nakładające się edycje (lint script, scripts list, devDependencies). Razem ~10 linii, ale wymaga uzgodnienia tabeli pre-commit hooks. Drift narasta od cyklu v8.

**Filtr „przed implementacją kształtów":** żadne z odkryć v9 nie blokuje startu implementacji domeny shapes. Wszystkie 🔴 dotyczą documentation drift (CLAUDE.md, COMMENT ON COLUMN). Implementacja pierwszego kształtu może iść równolegle z naprawami.

**Filtr „przed kolejnym PR-em do main":** wymagane są naprawy §1.1 v9 (nowa migracja) i §1.2 v9 (`CLAUDE.md` linia 69). Koszt jednorazowy ~15 minut, eliminuje stale info w runtime artifactach (Studio + AI context).

**Filtr „przed pierwszym deployem produkcyjnym":** warto domknąć §2.1 (consent error vocabulary), §2.2 (consent third SELECT), §2.3 (devicePixelRatio docs), §2.4 (Point export), §2.5 + §2.6 + §3.6 (tech-stack scripts/devDeps consolidation). 

**Wniosek meta v9:** projekt utrzymuje wzorzec „kod wyprzedza dokumentację" obserwowany od v6, ale **dodaje warstwę „drift utrzymuje się przez kolejne cykle bez akcji"**. v8 zidentyfikowało drift, naprawiło 2 z 9 nowych problemów. v9 dodaje 6 nowych problemów + obserwuje, że 13/15 v8 carry-forwardów wciąż żyje. Rekomendacje procesowe wzmocnione względem v8:

- **Każdy problem w `code-documentation-problems-vN.md` z prioritetem 🟡 powinien mieć GitHub Issue z assignee + due date.** Inaczej carry-forward → carry-forward → eskalacja, jak v8 §2.1 → v9 §1.2.
- **Każda nowa migracja Supabase rzuca trigger pre-PR check'u na obecność `COMMENT ON` wzmianek o role'ach** (`service_role`, `postgres`, `authenticated`) w już zaaplikowanych migracjach. Stale `pg_description` jest najgorszą formą drift'u (propaguje się do generated types + Studio), więc każda zmiana semantyki funkcji powinna iść w parze z fresh `COMMENT ON FUNCTION/COLUMN` w tej samej migracji. v9 §1.1 to dokładnie taki przypadek — `block_protected_columns_update` zmieniło semantykę w `20260509`, ale `COMMENT ON COLUMN current_consent_version` z `20260507` nie został odświeżony.
- **`CLAUDE.md` powinien być re-reviewowany przy każdym PR-cie touchującym `src/proxy.ts`, `src/lib/supabase/**`, lub strukturę API handlerów** — to są dokładnie te miejsca, gdzie sentence „is the place to add X" lub „currently stubbed" ma najwyższe prawdopodobieństwo stać się stale.
- Rozważyć dodanie do CI `verify:docs-vs-code` step — np. Bash assert, że żaden plik w `.ai/` nie zawiera frazy „currently stubbed" lub „TODO: implement" wskazującej na plik, który już istnieje z non-trivial body. Mała inwestycja narzędziowa, eliminuje całą klasę carry-forwardów.
