# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v2)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 2.0 (rewizja po naprawach z v1)
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/api-plan-issues.md`, `.ai/supabase-migration-modifications.md`, `.ai/code-documentation-problems.md` (v1), kod w `src/`, `supabase/migrations/20260507000000_complete_schema.sql`, `supabase/config.toml`, `vercel.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `.env.example`, `package.json`.
>
> **Stan projektu:** post-bootstrap, pre-implementation. Większość plików w `src/` to celowo puste szkielety (zgodnie z `CLAUDE.md`). Analiza skupia się na:
> 1. **Stanie problemów z v1** (`code-documentation-problems.md`) — co naprawione, co aktywne.
> 2. **Nowych rozbieżnościach** wynikłych ze zmian w repo od v1 (przede wszystkim: opcja C migracji "czysty CREATE", `vercel.json` z cronami, refaktor `createAdminClient`, plik `supabase-migration-modifications.md`).
> 3. **Lukach kodu**, które łatwo przeoczyć przy pierwszym przebiegu, ale są krytyczne dla CI/CD i bezpieczeństwa.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — blokują implementację, powodują błąd produkcyjny lub silnie wprowadzają w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji projektowej / zatwierdzenia przed startem implementacji odpowiedniego obszaru.
> - 🟢 **Drobne** — kosmetyczne, niespójności terminologiczne, wartość pedagogiczna.

---

## 0. Status napraw z `code-documentation-problems.md` (v1)

| # v1 | Tytuł | Status (2026-05-08) | Komentarz |
|---|---|---|---|
| 1.1 | `vercel.json` bez `crons` | ✅ Naprawione | Plik zawiera teraz oba wpisy cron (`expire-subscriptions`, `cleanup-webhook-events`). |
| 1.2 | Drzewo `architecture-base.md` §3 nieaktualne | ✅ Naprawione | §3 zawiera `i18n/`, `lib/supabase/`, `types/database.ts`, `proxy.ts`, `[locale]/`, pełne `api/{...}`, `tests/`, `e2e/`. |
| 1.3 | Architecture §18 vs tech-stack §13 (env vars) | ✅ Naprawione | §18 odsyła do tech-stack §13 jako single source of truth. |
| 1.4 | Architecture §17 vs `routing.ts` (locale detection) | ✅ Naprawione | §17 jasno mówi "detekcja preferencji przeglądarki świadomie wyłączona" + `localePrefix: 'as-needed'`. |
| 1.5 | Architecture §18 fałszywy "deploy step" | ✅ Naprawione | §18 zawiera adnotację "Deployment przez Vercel GitHub Integration, NIE GitHub Actions". |
| 1.6 | `db-plan.md` mówi o "0001 historyczny", a plik usunięty | ✅ Naprawione (preambuła + §5.12 wzmianki o `git rm`), **ale rozjazd z faktyczną migracją** — patrz nowy problem **1.1** poniżej. |
| 1.7 | `createAdminClient` używał `createServerClient` zamiast `@supabase/supabase-js` | ✅ Naprawione | `src/lib/supabase/server.ts` używa `createClient as createServiceClient` z `@supabase/supabase-js`, bez handlera cookies. |
| 2.1 | `pipe-front` `outerRadius` vs PRD `outerDiameter` | 🟡 **Wciąż aktywne** — patrz **2.1** poniżej. |
| 2.2 | `BeadShape` zamknięte vs PRD "także inne warianty" | 🟡 **Wciąż aktywne** — patrz **2.2** poniżej. |
| 2.3 | Indeks partial `WHERE schema_version < 1` | 🟡 **Wciąż aktywne** — patrz **2.3** poniżej. |
| 2.4 | `db-plan.md` §5.14 otwarte tematy | 🟡 **Częściowo aktywne** — patrz **2.4** poniżej. |
| 2.5 | Limity planu Free w UI vs DB (US-012) | 🟡 **Wciąż aktywne** — patrz **2.5** poniżej. |
| 2.6 | `components/canvas/` jako strefa uprzywilejowana niejasna w §3 | ✅ Naprawione (komentarz "STREFA UPRZYWILEJOWANA (§22.3)" obecny). |
| 2.7 | Architecture §15 duplikuje schemat z db-plan | ✅ Naprawione (przegląd + pełne odesłanie do db-plan jako SSOT). |
| 3.1–3.10 | Drobne | Większość rozwiązana lub bezzmianowa; pozostałości — patrz sekcja **3** poniżej. |

**Wniosek:** wszystkie 7 problemów krytycznych z v1 zostało zaadresowanych. Część "istotnych" (2.1–2.5) wymagała decyzji projektowych i wciąż czeka. Powstały też **nowe problemy** wprowadzone przez naprawy v1 (głównie rozjazd `db-plan.md` ↔ migracja po przejściu na "czysty CREATE").

---

## 1. 🔴 Krytyczne (nowe lub wciąż aktywne)

### 1.1 `db-plan.md` preambuła i §5.12 opisują migrację z DROP IF EXISTS — w rzeczywistości migracja to **czysty CREATE**

**Problem:**

`db-plan.md` (preambuła):
> "Migracja `20260507000000_complete_schema.sql` jest **atomowa: drop w kolejności od dzieci do rodziców** (`webhook_events → consent_log → subscriptions → documents → user_profiles`) plus `DROP FUNCTION … CASCADE` dla funkcji utworzonych przez 0001, następnie pełny recreate. Drop'y są **idempotentne (`IF EXISTS`)** — działają zarówno na czystej bazie, jak i na bazie z poprzednio zaaplikowanym 0001."

`db-plan.md` §5.12 ("Greenfield migracja"):
> Kolejność operacji:
> 1. `DROP TABLE IF EXISTS public.webhook_events, public.consent_log, public.subscriptions, public.documents, public.user_profiles CASCADE;`
> 2. `DROP FUNCTION IF EXISTS public.set_updated_at, public.handle_new_user CASCADE;`
> 3. `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`
> 4. Recreate funkcji bazowych...

**Rzeczywista migracja `20260507000000_complete_schema.sql`** zaczyna się od:
```sql
-- step 1: base functions (set_updated_at, handle_new_user)
create or replace function public.set_updated_at() ...
```
**Brak jakichkolwiek `DROP IF EXISTS`.** Plik `supabase-migration-modifications.md` v2 (z 2026-05-08) jasno opisuje: "v2 (2026-05-08): zmiana decyzji na Opcję C (czysty CREATE)" i potwierdza że "Sekcje step 1 i step 2 (drop'y) usunięte; pozostałe step 3–9 przemianowane na 1–7."

**Konsekwencje:**
- Implementator czytający `db-plan.md` jako "single source of truth" oczekuje migracji idempotentnej (działającej na bazie z 0001 i czystej). W rzeczywistości migracja **wymaga `pnpm supabase db reset`** dla każdego środowiska, gdzie aplikowany był poprzedni 0001 (decyzja podjęta świadomie w `supabase-migration-modifications.md` v2 — pre-implementation, jeden deweloper).
- `db-plan.md` §5.12 mówi "drop w kolejności od dzieci do rodziców" — w faktycznej migracji **kolejność CREATE jest od rodziców do dzieci**, co jest poprawne, ale narracja preambuły jest myląca.
- W `db-plan.md` §1 czytamy: "migracja jest atomowa: drop w kolejności od dzieci do rodziców plus DROP FUNCTION … CASCADE … następnie pełny recreate". Ten opis nie odpowiada plikowi w repo — można pomyśleć, że plik został zmodyfikowany ad-hoc.

**Rozwiązanie (zalecane):**

Zaktualizować preambułę `db-plan.md` (lines 7–10) na zgodną z opcją C:

```diff
- > Greenfield — plik `0001_init.sql` został **fizycznie usunięty** z repo (`git rm supabase/migrations/0001_init.sql`); historię można odczytać przez `git log --all -- supabase/migrations/0001_init.sql`. Migracja `20260507000000_complete_schema.sql` jest atomowa: drop w kolejności od dzieci do rodziców (`webhook_events → consent_log → subscriptions → documents → user_profiles`) plus `DROP FUNCTION … CASCADE` dla funkcji utworzonych przez 0001, następnie pełny recreate. Drop'y są idempotentne (`IF EXISTS`) — działają zarówno na czystej bazie, jak i na bazie z poprzednio zaaplikowanym 0001.
+ > Greenfield — plik `0001_init.sql` został **fizycznie usunięty** z repo (`git rm supabase/migrations/0001_init.sql`); historię można odczytać przez `git log --all -- supabase/migrations/0001_init.sql`. Migracja `20260507000000_complete_schema.sql` jest **czystym CREATE bez `DROP IF EXISTS`** (decyzja v2 z `supabase-migration-modifications.md`): `pnpm supabase db reset` jest wymagany w każdym środowisku, gdzie kiedykolwiek aplikowano stary `0001_init.sql` (czyli dziś: lokalna baza tego dewelopera). Wybór tej formy (zamiast Opcji A z DROP'ami) jest zasadny w stanie pre-implementation projektu — szczegóły w `supabase-migration-modifications.md`.
```

Zaktualizować §5.12 (lines 406–421) — usunąć kroki 1–3 (drop'y), przemianować 4–10 na 1–7, dopasować do faktycznej kolejności w pliku:

```diff
- ### 5.12 Greenfield migracja `20260507000000_complete_schema.sql`
-
- Kolejność operacji:
- 1. `DROP TABLE IF EXISTS public.webhook_events, public.consent_log, public.subscriptions, public.documents, public.user_profiles CASCADE;` (drop dzieci → rodziców).
- 2. `DROP FUNCTION IF EXISTS public.set_updated_at, public.handle_new_user CASCADE;` — czyści 0001.
- 3. `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;` — sprzątanie po 0001.
- 4. Recreate funkcji bazowych (`set_updated_at`, `handle_new_user`) z `SECURITY DEFINER SET search_path = ''`.
- 5. Recreate tabel w kolejności rodzice → dzieci.
- 6. Indeksy.
- 7. Funkcje biznesowe (...).
- 8. Triggery.
- 9. RLS `ENABLE` + polityki.
- 10. `COMMENT ON` dla samodokumentacji.
+ ### 5.12 Greenfield migracja `20260507000000_complete_schema.sql` (Opcja C — czysty CREATE)
+
+ Kolejność operacji w pliku (zgodna z `step` w komentarzach SQL):
+ 1. **Funkcje bazowe** — `set_updated_at()`, `handle_new_user()` (`SECURITY DEFINER SET search_path = ''`).
+ 2. **Tabele** w kolejności rodzice → dzieci: `user_profiles → documents → subscriptions → consent_log → webhook_events`.
+ 3. **Indeksy** (z partial-index na `documents.schema_version`).
+ 4. **Funkcje biznesowe**: `effective_plan`, `refresh_user_plan_from_subscriptions`, `trg_subscriptions_refresh_plan`, `refresh_expired_plans`, `check_free_project_limit`, `block_protected_columns_update`, `sync_schema_version_from_data`, `sync_paddle_customer`.
+ 5. **Triggery** (na `auth.users` i tabelach `public.*`).
+ 6. **RLS** `ENABLE` + polityki.
+ 7. **`COMMENT ON`** dla samodokumentacji.
+
+ Brak `DROP IF EXISTS` — czysty CREATE. Aplikowanie na bazie z poprzednim 0001 wymaga `pnpm supabase db reset`. Pełne uzasadnienie wyboru tej formy: `supabase-migration-modifications.md` v2.
```

**Rekomendacja:** dodatkowo zaktualizować `db-plan.md` §1 ("Lista tabel" — kierunek dropowania, którego nie ma w pliku) jeśli gdziekolwiek pozostała wzmianka.

---

### 1.2 `vercel.json` z cronami wskazuje na endpointy, które nie istnieją w repo — **deploy = 404 z bezpośrednim wpływem na plan użytkownika**

**Problem:**

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/expire-subscriptions",     "schedule": "0 3 * * *" },
    { "path": "/api/cron/cleanup-webhook-events",   "schedule": "0 2 * * 0" }
  ]
}
```

Pliki Route Handlerów w repo:
```
src/app/api/health/route.ts          ← jedyny istniejący
```

Brak:
- `src/app/api/cron/expire-subscriptions/route.ts`
- `src/app/api/cron/cleanup-webhook-events/route.ts`
- `src/app/api/paddle/webhook/route.ts`
- `src/app/api/consent/route.ts`
- `src/app/api/user/export/route.ts`

**Konsekwencje:**
- Każdy deploy na Vercel z aktualnym `vercel.json` skonfiguruje crony, które po wyzwoleniu **uderzą w endpointy zwracające 404**.
- Vercel zaloguje błędy cron — żaden mechanizm downgrade po wygaśnięciu Pro nie zadziała, `webhook_events` rosną bez retencji.
- Konfiguracja Vercel Cron przyjmie definicje (Vercel nie waliduje istnienia route'ów przy deploy), więc problem zostanie wykryty dopiero w produkcji.

**Rozwiązanie:**

Dwa podejścia (wybrać jedno):

- **Opcja A (zalecana, jeśli implementacja API zaczyna się <30 dni):** zostawić `crons` w `vercel.json`, **ale nie deployować na produkcję** dopóki Route Handlery cron nie istnieją. Dodać do `architecture-base.md` §18 lub `tech-stack.md` §12 ostrzeżenie:
  > "Production deploy wymaga implementacji `app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts` przed pierwszym push'em do `main` — w przeciwnym razie cron Vercel zwróci 404 i nie odbędzie się downgrade planów ani retencja webhook_events."

- **Opcja B:** zakomentować `crons` w `vercel.json` do czasu implementacji API. Niedeklarowanie = bezpieczeństwo deploya, ale ryzyko zapomnienia o włączeniu po implementacji. Trzeba dodać TODO w `package.json` lub w `tech-stack.md` §12.

**Rekomendacja:** **Opcja A** — `vercel.json` jest źródłem prawdy harmonogramu. Lepiej widzieć puste 404 w logach Vercel niż zapomnieć włączyć crony po implementacji. Dodatkowo: dopisać do PR-checklisty (CLAUDE.md "Workflow guardrails") notkę "Pre-merge na `main`: jeśli `vercel.json.crons[]` nie pusty, sprawdź że odpowiadające `route.ts` istnieją i zwracają 200 dla `Authorization: Bearer ${CRON_SECRET}`."

---

### 1.3 `supabase/config.toml` nie wymusza minimalnej długości hasła — łamie kryterium PRD US-001

**Problem:**

`PRD US-001` (Rejestracja nowego użytkownika), kryterium akceptacji:
> "System waliduje format e-mail i **minimalną długość hasła (min. 8 znaków)**."

`architecture-base.md` §14:
> "Rejestracja: email + hasło (format email, min. 8 znaków)"

`supabase/config.toml`:
```toml
[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
# brak password_min_length / minimum_password_length
```

**Konsekwencje:**
- Lokalnie i (po `supabase link`) zdalnie Supabase Auth **akceptuje hasła krótsze niż 8 znaków**, jeśli walidacja front-endowa zostanie ominięta (np. wywołanie `supabase.auth.signUp` z DevTools, bezpośrednie żądanie do GoTrue).
- PRD US-001 to wymóg zgodności — niedopilnowanie = niezgodność z dokumentem akceptacyjnym MVP.

**Rozwiązanie:**

Dodać do `supabase/config.toml` w sekcji `[auth]` (Supabase CLI ≥ 1.150 obsługuje `[auth.password]`):

```toml
[auth.password]
min_length = 8
# opcjonalnie: required_characters = "lower_upper_letters_digits_symbols"
```

Sprawdzić czy lokalna wersja Supabase CLI obsługuje tę sekcję (`supabase --version`). Jeśli nie — pin'ować `[auth] minimum_password_length = 8` (starsza nazwa).

**Rekomendacja:** wykonać teraz, zanim formularz rejestracji zostanie zaimplementowany. Brakująca konfiguracja = łatwo zapomnieć po zaimplementowaniu UI ("przecież walidacja jest w formularzu"), a obejście DevTools to typowy wektor pen-testu.

Dodatkowo, po dodaniu konfiguracji, dopisać do `db-plan.md` §4.2 (RLS documents) lub `tech-stack.md` notkę, że minimalna długość hasła jest egzekwowana **podwójnie**: w UI (klient) i w GoTrue (serwer).

---

### 1.4 Architecture §22.5 vs `pointerInput.ts` — kontrakt deklaruje gest `'pan'`, kod **nigdy go nie emituje**

**Problem:**

`architecture-base.md` §22.5:
```typescript
export type PointerGesture =
  | { kind: 'tap';   ... }
  | { kind: 'drag';  ... }
  | { kind: 'pan';   delta: Point; pointerId: number; phase: 'start'|'move'|'end' }
  | { kind: 'pinch'; ... }
```

`src/canvas-kit/pointerInput.ts` definiuje **tę samą unię**, ale w komentarzu i implementacji:
```typescript
/**
 * - `pan` z kontraktu typów emitujemy NA TYM SAMYM payloadzie co `drag`;
 *   reklasyfikacja drag → pan należy do warstwy nad canvas-kit (mode: 'hand'
 *   vs `mode: 'select'` + brak hit testu na elemencie).
 */
```

W praktyce w całym pliku `pointerInput.ts` **nie ma żadnego `emit({ kind: 'pan', ... })`**. Gest `'pan'` istnieje tylko w typie, nigdy w runtime'e.

**Konsekwencje:**
- Konsument (`CanvasApp.tsx`) widząc typ `PointerGesture` może napisać `if (g.kind === 'pan') { /* pan logic */ }` — ten branch będzie **zawsze martwym kodem**.
- Architecture §22.5 sugeruje, że `usePointerInput` rozumie tryb kursora (`select`/`hand`) i decyduje samodzielnie. Kod tego nie robi — wymaga, żeby konsument sam reklasyfikował `drag` → `pan` na podstawie `toolMode === 'hand'` i hit-testu.
- **To projekt API**: czy gest `'pan'` powinien być w typie (i emitowany), czy w ogóle należy go usunąć z `PointerGesture`?

**Rozwiązanie:**

Wybrać jedną z dwóch opcji:

- **Opcja A (zalecana):** usunąć `'pan'` z unii typów `PointerGesture` w `architecture-base.md` §22.5 i `pointerInput.ts`. Reklasyfikacja drag→pan dzieje się w `CanvasApp.tsx` na podstawie toolMode + hit-test — `canvas-kit` nie zna trybu kursora i nie powinien podejmować tej decyzji.

  ```diff
   export type PointerGesture =
     | { kind: 'tap';   ... }
     | { kind: 'drag';  ... }
  -  | { kind: 'pan';   delta: Point; pointerId: number; phase: 'start'|'move'|'end' }
     | { kind: 'pinch'; ... }
  ```

- **Opcja B:** dodać tryb (`mode: 'select' | 'hand'`) jako parametr `usePointerInput`, żeby hook sam emitował `'pan'` zamiast `'drag'` w trybie hand. Wymaga zmian w API kontraktu.

**Rekomendacja:** **Opcja A** — `canvas-kit` ma być engine-agnostic i nie powinien znać trybów aplikacji. Reklasyfikacja drag→pan jest częścią warstwy domeny. Komentarz w `pointerInput.ts` już to mówi explicite ("reklasyfikacja drag → pan należy do warstwy nad canvas-kit"). Niech typ to odzwierciedla.

Po zmianie zaktualizować w `architecture-base.md` §9 ("Pan i zoom") i §22.5 zdanie:
> "Komponenty domeny otrzymują znormalizowane gesty (`pinch | pan | drag | tap`) z `pointerInput`."

→

> "Komponenty domeny otrzymują znormalizowane gesty (`pinch | drag | tap`) z `pointerInput`. Reklasyfikacja drag → pan dzieje się w `CanvasApp.tsx` na podstawie `toolMode === 'hand'` i braku trafienia w element."

---

### 1.5 `architecture-base.md` §22.5 typ `target: RefObject<HTMLElement>` vs kod `RefObject<HTMLElement | null>`

**Problem:**

`architecture-base.md` §22.5:
```typescript
export function usePointerInput(target: RefObject<HTMLElement>, handler: (g: PointerGesture) => void): void
```

`src/canvas-kit/pointerInput.ts`:
```typescript
export function usePointerInput(
  target: RefObject<HTMLElement | null>,
  handler: (gesture: PointerGesture) => void
): void
```

**Status:** zgłoszone w v1 (problem 3.5) — **wciąż nieaktualne w architecturze.**

**Konsekwencje:** w React 19 `useRef<HTMLElement>(null)` zwraca `RefObject<HTMLElement | null>` (od React 19+ z nowymi typami). Niedopasowanie typów w architecture wprowadza w błąd.

**Rozwiązanie:** zaktualizować architecture §22.5 do zgodności z kodem:
```diff
- export function usePointerInput(target: RefObject<HTMLElement>, handler: (g: PointerGesture) => void): void
+ export function usePointerInput(target: RefObject<HTMLElement | null>, handler: (g: PointerGesture) => void): void
```

**Rekomendacja:** trywialny fix; kod jest poprawny, dokumentacja powinna pójść za nim.

---

## 2. 🟡 Istotne (decyzje projektowe — wciąż otwarte z v1 lub nowe)

### 2.1 `pipe-front` — `outerRadius` (architecture) vs `outerDiameter` (PRD US-019) — wciąż nierozstrzygnięte

**Status:** problem 2.1 z v1 — **wciąż aktywny**, kształt nie został jeszcze zaimplementowany (`src/shapes/pipe-front/` nie istnieje).

**Krótkie przypomnienie problemu:**

| Dokument | Pole / Reguła |
|---|---|
| PRD US-019 | "Dostępne parametry proporcjonalne: **średnica zewnętrzna** i grubość ścianki" |
| PRD US-019 | "wallThickness < średnica zewnętrzna / 2 − 1" |
| `architecture-base.md` §6 `pipe-front` | `outerRadius: number`, `wallThickness < outerRadius − 1` |
| `architecture-base.md` §6 `pipe-longitudinal` | `outerDiameter: number`, `wallThickness < outerDiameter / 2 − 1` |

Walidacja w architekturze (`wallThickness < outerRadius − 1`) jest **algebraicznie inna** niż w PRD (`wallThickness < outerDiameter / 2 − 1`):
- Dla `outerDiameter = 100`: PRD daje próg `wallThickness < 49`, architecture (gdzie `outerRadius = 50`) daje `wallThickness < 49`. ✅ **W tym przypadku są równoważne** (`outerRadius = outerDiameter/2`, więc `outerRadius - 1 = outerDiameter/2 - 1`).

**Czyli różnica jest semantyczna (nazewnictwo), nie algebraiczna.** Stara wersja v1 błędnie sygnalizowała "różnicę 2× krytyczną" — ta krytyka była błędna. Niemniej:

**Konsekwencje:**
- Niespójne nazewnictwo dwóch wariantów rury (`pipe-front` używa promienia, `pipe-longitudinal` używa średnicy) zwiększa ryzyko błędów przy implementacji `Renderer`-ów oraz `PropertiesPanel`-i (UX wymaga średnicy w obu wariantach).
- W PropertiesPanel `pipe-front` trzeba konwertować model→UI (`diameter = 2 * outerRadius`). To dryf między modelem domeny a UI.

**Rozwiązanie (zalecane):** ujednolicić oba kształty na **`outerDiameter`** (zgodnie z PRD i `pipe-longitudinal`):

```diff
 interface PipeFrontShape extends BaseShape {
   type: 'pipe-front'
-  outerRadius: number
-  wallThickness: number    // constraint: < outerRadius − 1
+  outerDiameter: number
+  wallThickness: number    // constraint: < outerDiameter / 2 − 1
 }
```

W `Renderer`-ze raz przeliczyć: `radius = outerDiameter / 2`. Single source of truth = `outerDiameter`.

**Rekomendacja:** wykonać **przed** stworzeniem katalogu `src/shapes/pipe-front/`. Mała zmiana, duża zgodność z PRD i z `pipe-longitudinal`.

---

### 2.2 `BeadShape` zamknięte na 2 wartości — PRD mówi "także inne dostępne warianty" — wciąż otwarte

**Status:** problem 2.2 z v1 — **wciąż aktywny**, `WeldSequencePanel` nie istnieje.

**Decyzja do podjęcia:**

- **Opcja A (zalecana dla MVP):** zawęzić PRD do dwóch wariantów (`'rounded-triangle' | 'rounded-trapezoid'`). PRD §3.6 i US-038 powinny powiedzieć: "W MVP dostępne kształty ściegu: trójkąt z zaokrąglonymi wierzchołkami i trapez z zaokrąglonymi wierzchołkami. Dodatkowe warianty — post-MVP."
- **Opcja B:** rozszerzyć `BeadShape` w architecture §7 o pełną listę.

**Rekomendacja:** **Opcja A**.

---

### 2.3 Indeks `documents_schema_version_idx WHERE schema_version < 1` — partial index zawsze pusty

**Status:** problem 2.3 z v1 — **wciąż aktywny**, w migracji.

**Migracja:**
```sql
create index documents_schema_version_idx
  on public.documents (schema_version)
  where schema_version < 1;
```

`db-plan.md` §3:
> `(schema_version) WHERE schema_version < CURRENT_SCHEMA_VERSION` (partial)

Komentarz w SQL: "currently empty (schema_version = 1 is the only version); update literal when version bumps".

**Konsekwencje:**
- Predykat `< 1` przy `default 1` jest zawsze fałszywy → indeks zawsze pusty.
- Aktualizacja literału przy każdym bump schemaVersion to manualny krok poza kodem aplikacji (który bumpuje `documentCodec.ts`).

**Rozwiązanie (zalecane):** zamienić partial index na pełny B-tree:
```sql
create index documents_schema_version_idx on public.documents (schema_version);
```
i odpowiednio zaktualizować `db-plan.md` §3.

**Rekomendacja:** pełen B-tree — partial index z literałem do ręcznej aktualizacji to premature optimization na tym etapie. Liczba dokumentów do migracji codec'a będzie liczona w setkach, nie milionach. Koszt full B-tree zaniedbywalny.

---

### 2.4 `db-plan.md` §5.14 — otwarte tematy częściowo zamknięte w innych dokumentach

**Status:** problem 2.4 z v1 — **częściowo zaadresowany**.

`db-plan.md` §5.14 wymienia 11 punktów otwartych. Zweryfikowane:

| # | Pkt | Stan |
|---|---|---|
| 1 | Timing crona `cleanup-webhook-events` | **Zamknięty w `tech-stack.md` §12 i `vercel.json`** (`0 2 * * 0`). 🔴 Punkt w db-plan trzeba przeredagować na "zamknięty". |
| 2 | Runtime migracja JSONB między schemaVersion | Zostaje (kod aplikacji `documentCodec.ts`). |
| 3 | Tier Supabase/Vercel | Zostaje (ekonomiczna decyzja, post-bootstrap). |
| 4 | RLS dla `share_token` | Zostaje (post-MVP). |
| 5 | Format `version` w `consent_log` | Zostaje (decyzja prawna). |
| 6 | Endpoint `/api/user/export` | **Zamknięty w `api-plan.md` §2.1**. 🔴 Punkt w db-plan trzeba przeredagować. |
| 7 | `lib/ipAnonymize.ts` | **Drzewo w architecture §3 zawiera, kontrakt w `api-plan.md` §2.1**. Zostaje "do implementacji" (TODO), ale specyfikacja jest zamknięta. |
| 8 | Mapping `'project_limit_exceeded'` → next-intl | Zostaje (kod aplikacji + `messages/{pl,en}.json`). |
| 9 | Lookup user webhooka Paddle | **Zamknięty w `api-plan.md` §2.1** (`POST /api/paddle/webhook` → "Lookup użytkownika (kolejność priorytetów)"). 🔴 Punkt w db-plan trzeba przeredagować. |
| 10 | Kolumna `thumbnail`/`preview` | Zostaje (post-MVP). |
| 11 | PITR/RTO/RPO | Zostaje (post-MVP). |

**Rozwiązanie:** w `db-plan.md` §5.14 oznaczyć pkty 1, 6, 9 jako zamknięte (z odsyłaczami do `tech-stack.md` §12, `api-plan.md` §2.1, `api-plan.md` §2.1 odpowiednio). Pkt 7 — zostawić, ale dodać "kontrakt zamknięty w `api-plan.md` §2.1, brak implementacji".

```diff
- 1. **Timing crona `cleanup-webhook-events`** — częstotliwość ustalona (tygodniowo), dzień/godzina do dopisania w `vercel.json`.
+ 1. ✅ ~~**Timing crona `cleanup-webhook-events`**~~ — `0 2 * * 0` (niedziela 02:00 UTC), `tech-stack.md` §12 + `vercel.json`.
…
- 6. **Endpoint `/api/user/export` (RODO art. 20)** — kod aplikacji.
+ 6. ✅ ~~**Endpoint `/api/user/export`**~~ — kontrakt w `api-plan.md` §2.1 (`GET /api/user/export`); implementacja TODO.
…
- 9. **Handler kolejności webhooków Paddle** — lookup user przez `paddle_customer_id`, fallback przez email z payloadu — `app/api/paddle/webhook/route.ts`.
+ 9. ✅ ~~**Handler kolejności webhooków Paddle**~~ — kontrakt lookupu w `api-plan.md` §2.1 (4-stopniowa kaskada `customData.user_id` → `paddle_customer_id` → `email` → log warning); implementacja TODO.
```

---

### 2.5 Plan limit Free przy duplikowaniu (US-012) — wciąż brak doprecyzowania w architekturze, mimo zamknięcia ogólnego flow w api-plan

**Status:** problem 2.5 z v1 — **wciąż aktywny**.

`architecture-base.md` §16 ("Duplikowanie dokumentu") opisuje operację jako client-side z trigger'em DB jako bezpiecznikiem. Brakuje:
- Kiedy UI ma sprawdzać limit (przed kliknięciem `Duplikuj` czy po reakcji DB)?
- Jak wyświetlać brak dostępu — przycisk disabled czy toast po próbie?

**Rozwiązanie:** dodać do `architecture-base.md` §16 lub `architecture-base.md` §14 ("Plany"):
```
Plan limit enforcement (UI vs DB):
- UI: przycisk "Duplikuj"/"Nowy projekt" jest disabled dla planu Free,
  jeśli `projects.length >= 1` (`useUserPlan().plan === 'free'`).
- DB (defense-in-depth): trigger `check_free_project_limit()` rzuca
  `project_limit_exceeded` jeśli UI permitów rozjedzie się — aplikacja
  mapuje przez `error.message.includes('project_limit_exceeded')`
  na toast z CTA upgrade (`messages/{pl,en}.json` klucz
  `errors.project_limit_exceeded`).
```

**Rekomendacja:** dopisać przy implementacji `ProjectList.tsx`. Drobna ale stabilizuje konwencję.

---

### 2.6 [NOWY] Dokumentacja dla `decoded_token` / `auth.role()` w `block_protected_columns_update` — implicit dependency na konwencję Supabase

**Problem:**

Migracja zawiera (linijki 302–315):
```sql
create or replace function public.block_protected_columns_update()
…
begin
  if auth.role() <> 'service_role' then
    new.plan               := old.plan;
    new.paddle_customer_id := old.paddle_customer_id;
  end if;
  return new;
end;
```

`auth.role()` to **funkcja Supabase Auth**, nie standard PostgreSQL. Zwraca tekst `'authenticated'`, `'service_role'`, `'anon'` zależnie od JWT w request kontekście. Implementacja zakłada, że:
1. Klient `service_role` (z `createAdminClient`) nadaje rolę `service_role` w request.
2. Klient `authenticated` (z `createServerClient`) nadaje rolę `authenticated`.

**Konsekwencje:**
- Bez znajomości tej konwencji programista czyta SQL i nie wie, jak rola JWT się rozróżnia.
- W testach jednostkowych (np. PostgreSQL container bez Supabase Auth) `auth.role()` może być nullem — funkcja zwróci wówczas `if NULL <> 'service_role' then …` → `NULL <> 'service_role'` to `NULL` (3-valued logic). Branch `if NULL then` nie wykona się — czyli `block_protected_columns_update` w testach **nie zablokuje** zmian. To może maskować błąd w testach (mock może bezkarnie zmieniać `plan`).

**Rozwiązanie:**

Opcja A: dodać do `db-plan.md` §1.2 (przy opisie triggera) notkę:
> "Trigger zakłada, że `auth.role()` zwraca poprawną rolę z JWT (`'service_role'`/`'authenticated'`/`'anon'`). W testach jednostkowych bez Supabase Auth (`auth.role()` zwraca NULL) trigger jest **transparentny** (NULL ≠ 'service_role' to NULL → branch nie wykona się, OLD wartości NIE zostaną zachowane). Testy RLS muszą jawnie ustawiać `request.jwt.claim.role` przez `SET LOCAL request.jwt.claim.role = 'authenticated'` przed UPDATE."

Opcja B (bardziej defensywna): przepisać warunek na `coalesce(auth.role(), 'anon') <> 'service_role'`:
```sql
if coalesce(auth.role(), 'anon') <> 'service_role' then
  new.plan               := old.plan;
  new.paddle_customer_id := old.paddle_customer_id;
end if;
```
W ten sposób przy braku Supabase Auth (NULL) trigger będzie **zachowywał OLD** (defensywnie). Testy nie zostaną pominięte, a service_role wciąż przejdzie.

**Rekomendacja:** **Opcja B** — defensywne wartości default w SQL to dobra praktyka (Postgres 3-valued logic to klasyczne źródło błędów). Plus update'ować `db-plan.md` §1.2 z wyjaśnieniem.

---

## 3. 🟢 Drobne (czystość dokumentacji, niska pilność)

### 3.1 Architecture §22.4 zakazuje `cache()` / `Konva.Animation` na poziomie publicznym — `primitives.ts` jednak eksponuje `hitStrokeWidth` (Konva-specific)

**Obserwacja:**

`src/canvas-kit/primitives.ts`:
```typescript
export interface CommonShapeProps {
  …
  /** Hit area expansion in px (touch-friendly handles). */
  hitStrokeWidth?: number;
  visible?: boolean;
  listening?: boolean;
  …
}
```

`hitStrokeWidth`, `listening` są **Konva-specific propsami** (nie mapują się 1:1 na PixiJS, gdzie hit area jest opisana przez `hitArea` jako poligon/prostokąt + brak `listening` flagi). Architecture §22.2 mówi: "Każdy prymityw przyjmuje **tylko** props, które mają 1:1 odpowiednik w Konva i Pixi."

**Konsekwencje:** przy migracji na PixiJS te dwa propsy wymagałyby translacji nietrywialnej (mapping `hitStrokeWidth` → poszerzenie geometrii hit area; `listening: false` → `eventMode: 'none'`). To narusza zasadę "1:1".

**Rozwiązanie:**

- Albo zaktualizować architecture §22.2, żeby pokazać że `hitStrokeWidth` i `listening` są w kontrakcie (i zobligować implementację Pixi do ich mapowania).
- Albo przemianować/usunąć w `primitives.ts` na bardziej neutralne nazwy (`hitArea: number` jako "expansion px" + `interactive: boolean`).

**Rekomendacja:** zaktualizować architecture §22.2 (kod jest praktyczny, dokumentacja teoretyczna). Dopisać w §22.2 listę "props poszerzonych przez specyfikę przekazu Konva → Pixi" z notką jak są tłumaczone.

---

### 3.2 `src/types/database.ts` — kolumna `consent_log.ip_address` typowana jako `unknown`

**Obserwacja:**

```typescript
consent_log: {
  Row: { …; ip_address: unknown; … }
}
```

Typ `unknown` pochodzi z generatora Supabase (`inet` SQL nie ma natywnego TS odpowiednika). W kodzie aplikacji to pole będzie zwracane przez `.select()` jako `string | null` (Supabase REST zwraca INET jako string `'192.168.1.0/24'`).

**Konsekwencje:** `unknown` wymusza `as string | null` w consumencie. Każde użycie `consent_log.ip_address` będzie zaśmiecone tym castem. Drobne ale nieprzyjemne.

**Rozwiązanie:** dodać do `src/types/database.ts` post-generation override (np. wrapper):
```typescript
import type { Tables } from './database'

export type ConsentLogRow = Omit<Tables<'consent_log'>, 'ip_address'> & {
  ip_address: string | null
}
```

Lub: w `db-plan.md` §1.5 dodać uwagę "Postgres `inet` jest mapowany przez `supabase gen types` na `unknown`. Konsumenci typują manualnie jako `string | null`."

**Rekomendacja:** zostawić na razie; rozwiązać przy pierwszym konsumencie (`/api/consent` Route Handler).

---

### 3.3 `tech-stack.md` §6 (Konva 9) — `react-konva@^19.2.3` ma peer dependency `konva@^9.3.0`

**Obserwacja:** `package.json` ma `konva@^9.0.0`. `react-konva@^19.2.3` faktycznie wymaga `konva@^9.3.0`. SemVer caret `^9.0.0` rezolwuje do najnowszego 9.x (czyli ≥ 9.3 automatycznie), więc problemu nie ma w praktyce — ale dokumentacja `tech-stack.md` §16 pinuje `konva@^9.0.0`, co teoretycznie pozwala na `9.0.x` niezgodne z peer.

**Status:** problem 3.1 z v1 — **wciąż aktywny w dokumentach**.

**Rozwiązanie:** zaktualizować `tech-stack.md` §6 i §16 pin do `konva: ^9.3.0` (zgodne z peer react-konva 19) lub szerzej `>=9.3.0 <10.0.0`. Aktualizować `package.json` przy okazji.

---

### 3.4 `src/proxy.ts` — logika kopiowania cookies między `supabaseResponse` i `intlResponse` jest nietypowa, brak komentarza dlaczego

**Obserwacja:**

```typescript
export async function proxy(request: NextRequest) {
  const { supabaseResponse, user: _user } = await updateSession(request);
  const intlResponse = intlMiddleware(request);

  if (intlResponse) {
    // Przepisz cookies sesji Supabase do odpowiedzi intl (np. przy redirect locale)
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
      intlResponse.cookies.set(name, value, options);
    });
    return intlResponse;
  }
  return supabaseResponse ?? NextResponse.next();
}
```

`createIntlMiddleware` z `next-intl` **prawie zawsze** zwraca response (np. dla `/` zwraca rewrite/redirect/next). `supabaseResponse ?? NextResponse.next()` jest praktycznie martwym fallbackiem. To utrudnia debugowanie i sugeruje, że supabaseResponse może być pominięty w niektórych ścieżkach — co byłoby błędem (utrata cookies refresh token).

**Konsekwencje:**
- Aktualna implementacja działa, ale czytelność jest niska.
- Brak testu który by sprawdził, że `Set-Cookie` z `updateSession` faktycznie trafia w response.

**Rozwiązanie:** dodać komentarz wyjaśniający w `proxy.ts`:
```typescript
// next-intl middleware ZAWSZE zwraca response (rewrite/redirect/next).
// Cookies sesji Supabase z `updateSession()` musimy ręcznie przekopiować
// do tej response, w przeciwnym razie Set-Cookie z refresh tokenu się gubi
// przy locale redirect.
```

I rozważyć test e2e: zalogowany user otwiera `/` → `proxy` → response ma `Set-Cookie: sb-...`.

---

### 3.5 `e2e/smoke.spec.ts` testuje "WelderDoc" jako heading — slogan jest w `messages/pl.json`

**Obserwacja:**

```typescript
test('homepage renders the WelderDoc title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();
});
```

Test polega na tym, że `messages/pl.json["App"]["title"] === "WelderDoc"`. Drobne sprzężenie z konkretnym tekstem — przy zmianie title w PL na "WelderDoc — Dokumentacja spawów" test pęknie bez ostrzeżenia w samym pliku.

**Rozwiązanie:** użyć selektora bardziej stabilnego (np. `data-testid="app-title"` na `<h1>`) lub testować po obu lokalizacjach (`/` PL i `/en` EN).

**Rekomendacja:** drobna; do uściślenia przy implementacji landing page'a.

---

### 3.6 `architecture-base.md` §6 niespójność typów: `WeldJointShape._geometryChecksum?: string` vs `WeldUnit.sequenceJointChecksum: string | null`

**Obserwacja:** problem 3.4 z v1 — wciąż w dokumentach. Optional `?` vs nullable `| null`. W TS są semantycznie różne (optional pole nie istnieje vs istnieje jako null).

**Rozwiązanie:** ujednolicić styl. Zaleca się `string | null` w obu — pole zawsze obecne, tylko może być `null`. Łatwiejsze w `Object.keys()` i serializacji JSON.

---

### 3.7 `db-plan.md` §1.4 sugeruje że subscriptions są historyczne ("każdy webhook = nowy lub uaktualniony wiersz"), ale UNIQUE jest tylko na `paddle_subscription_id`

**Obserwacja:**

`db-plan.md` §1.4:
> "Historia subskrypcji Paddle (każdy webhook `subscription.created/updated` = nowy lub uaktualniony wiersz, `UNIQUE(paddle_subscription_id)`). Źródło prawdy dla efektywnego planu."

Zdanie jest dwuznaczne:
- "każdy webhook = nowy wiersz" sugeruje **append-only** (bez UPDATE)
- "lub uaktualniony wiersz" + `UNIQUE(paddle_subscription_id)` faktycznie sugeruje **upsert** (jeden wiersz per subscription, aktualizowany przy każdym webhook updates)

`api-plan.md` §2.1 jest jasny: "upsert w `subscriptions` (na podstawie `paddle_subscription_id`)" → **jeden wiersz per Paddle subscription, UPDATE przy webhook updates**.

**Konsekwencje:**
- Pole "Historia subskrypcji" w `db-plan.md` §1.4 wprowadza w błąd — to NIE jest historia w sensie audit log (jak `consent_log` czy `webhook_events`), tylko **stan obecny** każdej subskrypcji.
- Prawdziwy audit log (kto/kiedy zmienił) leży w `webhook_events.payload`.

**Rozwiązanie:** zaktualizować `db-plan.md` §1.4 (lines 65–66):

```diff
- ### 1.4 `public.subscriptions`
-
- Historia subskrypcji Paddle (każdy webhook `subscription.created/updated` = nowy lub uaktualniony wiersz, `UNIQUE(paddle_subscription_id)`). Źródło prawdy dla efektywnego planu.
+ ### 1.4 `public.subscriptions`
+
+ Aktualny stan każdej subskrypcji Paddle (jeden wiersz per `paddle_subscription_id`, **upsert** przy każdym webhook `subscription.*`). Źródło prawdy dla efektywnego planu (`effective_plan()` lookup). Historyczny audit log webhooków leży w `webhook_events.payload`.
```

Dodatkowo w §5.4: zmienić "Subskrypcje — historia, nie aktualny stan" na "Subskrypcje — aktualny stan, nie historia".

---

### 3.8 `architecture-base.md` §3 wymienia w `lib/` kilka plików ale jeden — `weldAutosize.ts` — nie ma odpowiednika w `architecture-base.md` §6 (autosize jest w `shapes/weld-joint/autosize.ts`)

**Obserwacja:**

Architecture §3 (drzewo):
```
shapes/weld-joint/
  …
  autosize.ts             ← auto-dopasowanie rozmiaru do elementów w pobliżu
…
lib/
  …
  weldAutosize.ts         ← auto-dopasowanie weld-joint
```

Dwa pliki dla tej samej funkcjonalności. Architecture §6 (`weld-joint`) mówi tylko: "Przy wstawieniu: `autosize.ts` dopasowuje startowe wymiary…" — nie precyzuje gdzie ten plik mieszka.

**Konsekwencje:** implementator pisze logikę autosize 2× lub nie wie gdzie ją umieścić.

**Rozwiązanie:** wybrać jedno miejsce. Zaleca się **`shapes/weld-joint/autosize.ts`** (kolokacja z domeną kształtu — zgodna z zasadą "Shape Registry to jedyny extension point" z architecture §2). Usunąć `lib/weldAutosize.ts` z drzewa §3.

---

### 3.9 `architecture-base.md` §3 sugeruje `lib/snapEngine.ts` jako "logikę SNAP czyste funkcje" — istnieje, ale stub jest z importem z `@/shapes/_base/types` co tworzy okruszek zależności shapes ← lib

**Obserwacja:**

`src/lib/snapEngine.ts`:
```typescript
import type { AnchorEdge, AnchorPoint, Point } from '@/shapes/_base/types';
```

`architecture-base.md` §2 ("Zasady projektowe"):
> "Rozwiązanie cyklu importów `shapes/` ↔ `store/`."

Cykli `shapes/` ↔ `lib/` architectura nie omawia. Aktualnie `lib/snapEngine` importuje typy z `shapes/_base/types`, co tworzy zależność `lib/` → `shapes/`. Jeśli kiedykolwiek `shapes/` zechce użyć `snapEngine` (np. helper geometryczny), powstanie cykl.

**Konsekwencje:** ryzyko cyklu w przyszłości; styl niezgodny z deklarowaną w §2 "shapes ⊥ lib" architekturą.

**Rozwiązanie:** przenieść `AnchorPoint`/`AnchorEdge`/`Point` do `src/lib/_types.ts` lub `src/canvas-kit/index.ts` jako neutralne typy geometryczne, z których korzystają oba: `shapes/` i `lib/`. Aktualnie `Point` jest już zarówno w `shapes/_base/types.ts` jak i `canvas-kit/pointerInput.ts` (duplikat) — można je ujednolicić w `canvas-kit/`.

**Rekomendacja:** drobne; rozważyć przy pierwszej iteracji `snapEngine.ts` z prawdziwą logiką.

---

### 3.10 `next.config.ts` ma turbopack `resolveAlias: { canvas: './empty.js' }` — `empty.js` nie istnieje fizycznie w repo

**Obserwacja:**

`next.config.ts`:
```typescript
turbopack: {
  resolveAlias: {
    canvas: './empty.js'
  }
}
```

`ls .` w roocie repo:
```
.husky        next-env.d.ts        prettier.config.mjs        ...
```

Brak `empty.js`. `eslint.config.mjs` ma w `ignores`: `'empty.js'`, co sugeruje że plik **był** lub **ma być**. CLAUDE.md: "Konva needs the canvas alias to ./empty.js in next.config.ts (already wired)."

**Konsekwencje:** Turbopack przy build próbuje `resolveAlias` na nieistniejący plik — zwraca pusty moduł. To może działać przypadkowo (Turbopack toleruje brak), ale lepiej mieć plik fizycznie, żeby zachowanie było deterministyczne.

**Rozwiązanie:** utworzyć `empty.js` w roocie:
```javascript
// Pusty moduł — alias dla `canvas` (Node.js native canvas package)
// importowanego przez Konvę. Nie używamy SSR canvas, więc moduł
// jest zastępowany pustką w kodzie klienckim.
export {}
```

**Rekomendacja:** trywialne; zrealizować przed pierwszym `next build`.

---

### 3.11 `architecture-base.md` §22.2 deklaruje, że prymitywy mają **tylko** props 1:1 z Konva/Pixi — `LineProps` ma `dash`, `lineCap`, `lineJoin`

**Obserwacja:**

```typescript
export interface LineProps extends CommonShapeProps {
  points: number[];
  closed?: boolean;
  dash?: number[];
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}
```

`dash`, `lineCap`, `lineJoin` to standardowe SVG/Canvas2D properties — **mapują się 1:1 i na Konva i na PixiJS** (PixiJS Graphics API ma `setLineDash` / `lineCap` / `lineJoin`). Więc obecność tych propsów jest OK.

**Status:** ❌ Fałszywy alarm — w kodzie jest dobrze. Architecture §22.2 powinien explicite **wymienić** te props (lub wskazać klasę "wszystkie standardowe Canvas2D path attrs są dopuszczalne").

**Rozwiązanie:** zaktualizować architecture §22.2 — w `LineProps` dodać `dash`, `lineCap`, `lineJoin` (pełne odwzorowanie kodu).

---

### 3.12 `architecture-base.md` §3 `lib/supabase/server.ts` opisany jako "createClient (Server Components / Route Handlers) + createAdminClient (service_role; tylko server-side)" — kod wprowadza tę nazwę, ale jest niespójność z PRD US-049

**Obserwacja:** drobna; nazwa funkcji `createClient` w `lib/supabase/server.ts` jest standardowa Supabase, ale w `lib/supabase/client.ts` jest **też** funkcja `createClient`. Konwencja "import { createClient } from '@/lib/supabase/server'" / "from '@/lib/supabase/client'" działa, ale developer może łatwo zaimportować zły jeśli aliasy IDE są agresywne.

**Rozwiązanie:** rozważyć jawne nazwy: `createServerSupabase()` / `createBrowserSupabase()` / `createServiceSupabase()`. Wymaga refactoru.

**Rekomendacja:** drobna; pre-implementation. Aktualne nazwy są zgodne z konwencją Supabase (`@supabase/ssr` docs używają `createClient` w obu kontekstach), więc pozostawienie OK.

---

## 4. Problemy w kodzie (poza dokumentami)

### 4.1 [WCIĄŻ AKTUALNE] `src/store/types.ts: AllShapeGeometry = {}` — placeholder

Pre-implementation — zgodne z `CLAUDE.md`. ✅ żadnej akcji teraz.

### 4.2 [WCIĄŻ AKTUALNE] `src/shapes/registry.ts: SHAPE_REGISTRY = {}` — pusty rejestr

Pre-implementation. ✅ żadnej akcji.

### 4.3 [WCIĄŻ AKTUALNE] `src/store/use-canvas-store.ts` — placeholder bez slice'ów

Pre-implementation. CLAUDE.md zawiera już konwencje (useShallow, devtools w dev, custom hook per slice).

### 4.4 [WCIĄŻ AKTUALNE] `src/lib/snapEngine.ts` — funkcje no-op

Pre-implementation. ✅ żadnej akcji. Zob. też **3.9** (zależność `lib/` → `shapes/`).

### 4.5 [NOWE] `src/canvas-kit/impl-konva/activeStage.ts` — singleton dla `rasterize()`, getActiveStage rzuca przy braku stage

**Obserwacja:**

```typescript
export function getActiveStage(): Konva.Stage {
  if (!activeStage) {
    throw new Error(
      'canvas-kit: no active CanvasShell — rasterize() called outside the canvas tree'
    );
  }
  return activeStage;
}
```

Singleton + `throw` to pragmatyczny pattern, ale:
- W teście jednostkowym (`exportEngine.test.ts`) trzeba mockować `getActiveStage` lub renderować pełny `CanvasShell` w jsdom.
- W e2e kilka instancji `CanvasShell` (np. preview + main canvas) wzajemnie nadpisuje singleton.

**Status:** problem 5.5 z v1 — **wciąż aktualne**, kod identyczny.

**Rozwiązanie:** zostawić singleton dla MVP; dopisać do architecture §22.6 notkę o ograniczeniu (jedna `CanvasShell` na drzewo React) i przy implementacji `exportEngine.ts` ewentualnie przejść na React context.

### 4.6 [NOWE] `src/lib/supabase/server.ts:createAdminClient()` jest `function` (nie `async function`) — niezgodne z `client.ts:createClient()` i `server.ts:createClient()` które są (`async`)

**Obserwacja:**

```typescript
// server.ts
export async function createClient() { … }   // async (czeka na cookies())
export function createAdminClient() { … }    // sync (service_role nie potrzebuje cookies)
```

`api-plan.md` §3 ("Klient service_role") nie precyzuje sync vs async. Aktualne rozwiązanie jest poprawne semantycznie (service_role nie czeka na cookies), ale różnica sygnatur (`await createClient()` vs `createAdminClient()`) wymaga uwagi przy importach.

**Rozwiązanie:** udokumentować w `tech-stack.md` §7 (tabela "Dwa warianty klienta Supabase") — dodać kolumnę "Async":

| Kontekst | Funkcja | Async | Plik helpera |
|---|---|---|---|
| Client Component | `createBrowserClient` | nie | `client.ts` |
| Server Component / Route Handler | `createServerClient` | tak (`await cookies()`) | `server.ts:createClient` |
| Server (service_role) | `createServiceClient` | nie | `server.ts:createAdminClient` |

**Rekomendacja:** drobna, dla czytelności.

### 4.7 [NOWE] `tests/smoke.test.ts` testuje canvas mock — co jest poprawne, ale `vitest.setup.ts` nie był w plikach źródłowych analizowanych ręcznie

**Obserwacja:** test sprawdza `canvas.getContext('2d')` returning non-null. To weryfikuje, że `vitest-canvas-mock` działa. ✅ OK.

**Status:** żadnej akcji.

---

## 5. Nowe rozbieżności wykryte podczas tej analizy (poza katalogiem v1)

### 5.1 🔴 `db-plan.md` preambuła ↔ migracja ↔ `supabase-migration-modifications.md`

Trzy dokumenty mówią różne rzeczy o tym samym pliku:

| Dokument | Co mówi o migracji |
|---|---|
| `db-plan.md` (preambuła) | "Migracja jest atomowa: drop w kolejności od dzieci do rodziców plus DROP FUNCTION CASCADE … następnie pełny recreate. Drop'y są idempotentne (`IF EXISTS`)." |
| `db-plan.md` §5.12 | Kroki 1–10 zaczynające się od "DROP TABLE IF EXISTS" |
| `supabase-migration-modifications.md` v2 | "v2 (2026-05-08): zmiana decyzji na Opcję C (czysty CREATE). Sekcje step 1 i step 2 (drop'y) usunięte; pozostałe step 3–9 przemianowane na 1–7." |
| `supabase/migrations/20260507000000_complete_schema.sql` | Czysty CREATE bez drop'ów (steps 1–7 = base functions, tables, indexes, business functions, triggers, RLS, comments) |

`db-plan.md` jest **3-razy out-of-date** w tym zakresie — to powinno być pierwsza naprawa po przeczytaniu tego dokumentu. (Patrz **1.1** wyżej dla pełnego rozwiązania.)

### 5.2 🟡 `supabase-migration-modifications.md` v2 nie aktualizuje swojego nagłówka — pozostaje w nim "Plik docelowy: `supabase/migrations/20260507000000_complete_schema.sql`" + odsyłacz do "kodu w v1" jako zatwierdzony

**Obserwacja:** plik v2 świadomie cofa wybór z v1 (z "Opcja A" na "Opcja C"). Niemniej w nagłówku v2 jest:
> "**Stan poprzedni:** `supabase/migrations/0001_init.sql` (usunięty `git rm`, widoczny w git status jako `D`)"

To stwierdzenie poprawne. Brakuje natomiast:
> "**Decyzja końcowa (v2):** Opcja C — czysty CREATE."

W bieżącym kształcie zwykły czytelnik zaczynający od `db-plan.md` może wziąć v1 (Opcja A) za prawdę i nigdy nie sięgnąć do v2. Lepszym wzorcem jest, żeby `db-plan.md` linkował do **konkretnej decyzji**, nie do pliku `supabase-migration-modifications.md` w ogóle.

**Rozwiązanie:** w `db-plan.md` preambule i §5.12 (po naprawie z **1.1**), zamiast "Pełna analiza decyzji w `supabase-migration-modifications.md`", napisać:
> "Decyzja końcowa: **Opcja C — czysty CREATE bez DROP'ów** (v2 z `supabase-migration-modifications.md` z 2026-05-08). Pełne uzasadnienie i porównanie z odrzuconymi Opcjami A/B w tamtym dokumencie."

---

## 6. Podsumowanie — priorytety naprawy

### Akcje przed kolejną iteracją implementacyjną (kolejność rekomendowana):

1. **🔴 1.1** — Zaktualizować `db-plan.md` preambułę i §5.12 do zgodności z faktyczną migracją (Opcja C, bez DROP'ów). **NAJWAŻNIEJSZE** — DB plan jest single source of truth schematu i musi opisywać to, co rzeczywiście aplikuje się do bazy.
2. **🔴 1.2** — Sprawdzić, czy `vercel.json:crons` mają faktyczne implementacje endpointów; w przeciwnym razie zakomentować lub dodać "deploy guardrail" do PR-checklisty.
3. **🔴 1.3** — Dodać `[auth.password] min_length = 8` do `supabase/config.toml` (zgodność z PRD US-001).
4. **🔴 1.4** — Usunąć `'pan'` z `PointerGesture` w architecture §22.5 i `pointerInput.ts` (gest nigdy nie emitowany).
5. **🔴 1.5** — Zaktualizować architecture §22.5 typ `target` na `RefObject<HTMLElement | null>` (zgodne z React 19).
6. **🟡 2.1** — Decyzja: `pipe-front` używa `outerDiameter` (zalecane) lub udokumentować konwersję radius↔diameter.
7. **🟡 2.2** — Decyzja: czy MVP ma 2 BeadShape czy więcej (zalecane: 2, doprecyzować PRD §3.6 / US-038).
8. **🟡 2.3** — Decyzja: literal vs full B-tree na `documents.schema_version` (zalecane: full B-tree).
9. **🟡 2.4** — Domknąć w `db-plan.md` §5.14 punkty 1, 6, 9 (już rozstrzygnięte gdzie indziej).
10. **🟡 2.5** — Doprecyzować w architecture §16 limity Free przy duplikowaniu (UI disabled vs DB trigger).
11. **🟡 2.6** — Defensywne `coalesce(auth.role(), 'anon')` w `block_protected_columns_update` (lub udokumentowanie 3-valued logic).
12. **🟡 5.1/5.2** — Zsynchronizować narrację `db-plan.md` ↔ `supabase-migration-modifications.md`.

Drobne (3.x) — można dopisać do backlogu housekeepingu lub wykonać przy pierwszej iteracji odpowiedniej domeny.

---

## 7. Zasady na przyszłość (rekomendacje organizacyjne)

1. **Single source of truth per topic.** Zachować jak w v1: schemat DB → `db-plan.md`; env vars → `tech-stack.md` §13; kontrakt API → `api-plan.md`. Inne dokumenty linkują, nie duplikują. **Dodatkowo:** treść migracji jest source of truth dla DB. `db-plan.md` i `supabase-migration-modifications.md` muszą za nią nadążać.
2. **Pre-commit hook do walidacji rozjazdu dokumentów:** rozważyć skrypt który porównuje liczbę tabel w `db-plan.md` §1 z liczbą `CREATE TABLE` w `supabase/migrations/*.sql`. Trywialne, łatwo wprowadzić do `.husky/pre-commit`.
3. **Zmiana decyzji architektonicznej = update dokumentów PRZED commitem migracji.** Decyzja "Opcja A → C" z 2026-05-08 zaktualizowała plik migracji, ale nie zaktualizowała `db-plan.md` — stąd ten dokument v2.
4. **CI guard dla `vercel.json:crons`:** po implementacji crony muszą mieć route'y. Dodać do `ci.yml` step który grepuje `crons[].path` z `vercel.json` i sprawdza istnienie odpowiednich `route.ts`.
5. **Generated types są efemeryczne.** `src/types/database.ts` regeneruje się ze schematu — zmiana DB ⇒ `pnpm supabase:types` ⇒ commit. Aktualnie jest commit'owany do repo (sensowne dla CI bez Supabase access), ale ZAWSZE przy zmianie migracji trzeba odświeżyć.
6. **Kolejność czytania dla nowego dewelopera:**
   - `CLAUDE.md` (orientacja)
   - `prd.md` (co budujemy)
   - `tech-stack.md` (czym budujemy)
   - `architecture-base.md` (jak budujemy)
   - `db-plan.md` + `supabase/migrations/*.sql` (w tej kolejności — kod jest authoritative)
   - `api-plan.md` (kontrakty API)
   - inne `.ai/*-analysis.md` (kontekst decyzji, nie source of truth)
