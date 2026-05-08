# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc

> **Data analizy:** 2026-05-08
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/api-plan-issues.md`, kod w `src/`, `supabase/`, `package.json`, `vercel.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `.env.example`, `.github/workflows/ci.yml`, `CLAUDE.md`.
>
> **Stan projektu:** post-bootstrap, pre-implementation. Większość plików w `src/` to celowo puste szkielety (zgodnie z `CLAUDE.md`). Analiza skupia się na **rozbieżnościach między dokumentami oraz między dokumentacją a tym, co już zostało zaimplementowane** (nie na brakach scope'owych).
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — blokują implementację, powodują błąd produkcyjny lub silnie wprowadzają w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji projektowej / zatwierdzenia przed startem implementacji odpowiedniego obszaru.
> - 🟢 **Drobne** — kosmetyczne, niespójności terminologiczne, wartość pedagogiczna.
>
> **Powiązany dokument:** `.ai/api-plan-issues.md` zawiera 13 problemów wykrytych przy redagowaniu `api-plan.md`. Większość ma status ✅ "naprawione w plikach źródłowych", ale kilka wciąż jest aktywnych (#13 lookup webhooka Paddle, częściowo #1 §15 architektury). Niniejszy dokument **uzupełnia** tamtą listę o problemy nieobjęte tamtym audytem (drzewo katalogów, env vars w architecture §18, i18n, vercel.json, kod `createAdminClient`, pipe-front, indeks partial, plik 0001 itd.).

---

## 1. 🔴 Krytyczne

### 1.1 `vercel.json` nie zawiera sekcji `crons`, mimo że dokumentacja wymaga dwóch zadań cron

**Problem:**
- `tech-stack.md` §12 (przykład `vercel.json`) zawiera dwa wpisy `crons`: `expire-subscriptions` (`0 3 * * *`) i `cleanup-webhook-events` (`0 2 * * 0`).
- `api-plan.md` §2.1 (`POST /api/cron/expire-subscriptions`, `POST /api/cron/cleanup-webhook-events`) wymaga harmonogramu Vercel Cron.
- `db-plan.md` §5.4 i §5.13 wskazują obie funkcje DB (`refresh_expired_plans`, retencja 90 dni `webhook_events`) jako wywoływane przez Vercel Cron.
- **Rzeczywisty `vercel.json`:**
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "regions": ["fra1"],
    "buildCommand": "pnpm build",
    "installCommand": "pnpm install --frozen-lockfile"
  }
  ```
  **Brak `crons`** — po wdrożeniu prod cron nigdy się nie wykona, plan użytkowników z anulowaną subskrypcją po grace period nie zostanie obniżony, a `webhook_events` będą rosły w nieskończoność.

**Konsekwencje:**
- Real-time downgrade po wygaśnięciu Pro nie zadziała (jedyny mechanizm aktualizacji planu po grace period).
- Tabela `webhook_events` rośnie bez retencji 90 dni — narusza minimalizację danych RODO i powiększa rozmiar bazy.

**Rozwiązanie (zalecane):**
Dodać do `vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile",
  "crons": [
    { "path": "/api/cron/expire-subscriptions",     "schedule": "0 3 * * *" },
    { "path": "/api/cron/cleanup-webhook-events",   "schedule": "0 2 * * 0" }
  ]
}
```

**Rekomendacja dodatkowa:** ponieważ Vercel Cron wymaga planu Pro projektu Vercel, zweryfikuj plan przed deployem (zgodnie z `db-plan.md` §5.14 pkt 3 — "Tier Supabase/Vercel — założono Pro; weryfikacja przy wyborze planów").

---

### 1.2 `architecture-base.md` §3 — drzewo katalogów rozjeżdża się z faktyczną strukturą `src/`

**Problem:** Drzewo katalogów w §3 nie pokazuje kilku katalogów i plików, które już istnieją w repo, oraz pomija segment locale w `app/`.

| W dokumencie (`architecture-base.md` §3) | W rzeczywistości | Komentarz |
|---|---|---|
| brak `src/i18n/` | `src/i18n/{routing.ts, navigation.ts, request.ts}` | next-intl wymaga tej struktury |
| brak `src/lib/supabase/` | `src/lib/supabase/{client.ts, server.ts, middleware.ts}` | Powinno być w drzewie (kluczowe dla SSR auth) |
| brak `src/types/database.ts` | istnieje (wygenerowany przez `supabase gen types`) | Wskazany w `tech-stack.md` §7 |
| brak `src/proxy.ts` w głównym drzewie | istnieje (Next 16: `proxy.ts` zamiast `middleware.ts`) | `CLAUDE.md` to dokumentuje, drzewo nie |
| `src/app/(auth)/login/page.tsx` | wymagane: `src/app/[locale]/(auth)/login/page.tsx` | Brak segmentu `[locale]` w drzewie |
| `src/app/(app)/canvas/[projectId]/page.tsx` | wymagane: `src/app/[locale]/(app)/canvas/[projectId]/page.tsx` | jw. |
| brak `src/app/api/{paddle,consent,user,cron,health}/...` | wymagane wg §16 i `api-plan.md` | Aktualnie tylko `api/health/route.ts` |

**Konsekwencje:**
- Implementator korzystający z `architecture-base.md` jako "single source of truth" otrzymuje trasy bez segmentu `[locale]`, co łamie wymóg internacjonalizacji.
- Brak wzmianki o `src/lib/supabase/` powoduje implementację Supabase od zera, zamiast użycia gotowych helperów (`createClient` browser/server, `updateSession` middleware).

**Rozwiązanie:**
Zaktualizować §3, dodając:
```
src/
  proxy.ts                ← Next 16; eksportuje proxy + config (chain: Supabase updateSession → next-intl)
  i18n/
    routing.ts            ← defineRouting (locales: pl/en, defaultLocale: pl, localePrefix: 'as-needed', localeDetection: false)
    request.ts            ← getRequestConfig dla next-intl
    navigation.ts         ← typed Link/redirect/router
  types/
    database.ts           ← supabase gen types typescript (commit do repo)
  lib/
    supabase/
      client.ts           ← createBrowserClient
      server.ts           ← createServerClient (Server Components, Route Handlers)
      middleware.ts       ← updateSession (chain w proxy.ts)
    captureGeometry.ts    (deferred)
    shapeBounds.ts        (deferred)
    snapEngine.ts         ← stub
    weldAutosize.ts       (deferred)
    documentCodec.ts      (deferred)
    exportEngine.ts       (deferred)
    overlapDetector.ts    (deferred)
    ipAnonymize.ts        (deferred — db-plan §5.14 pkt 7)
  app/
    [locale]/
      layout.tsx          ← setRequestLocale + NextIntlClientProvider
      page.tsx            ← landing
      (auth)/
        login/page.tsx
        register/page.tsx
        reset-password/page.tsx
      (app)/
        canvas/[projectId]/page.tsx
        projects/page.tsx
    api/
      health/route.ts
      consent/route.ts            (POST)
      user/export/route.ts        (GET)
      paddle/webhook/route.ts     (POST)
      cron/expire-subscriptions/route.ts        (POST)
      cron/cleanup-webhook-events/route.ts      (POST)
```

**Rekomendacja:** spina to istniejący problem #8 z `api-plan-issues.md` (`lib/ipAnonymize.ts`) i #9 (proxy.ts) w jeden czytelny obraz drzewa. Po aktualizacji oznaczyć oba problemy jako ✅ w `api-plan-issues.md`.

---

### 1.3 `architecture-base.md` §18 — lista zmiennych środowiskowych jest niepełna w stosunku do `tech-stack.md` §13 i `.env.example`

**Problem:**
`architecture-base.md` §18 wymienia tylko 5 zmiennych:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PADDLE_WEBHOOK_SECRET
NEXT_PUBLIC_APP_URL
```

`tech-stack.md` §13 oraz `.env.example` zawierają **11 zmiennych** (brakuje 6 w architecture):
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` — frontend SDK Paddle
- `NEXT_PUBLIC_PADDLE_ENV` — `sandbox` / `production`
- `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY`
- `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL`
- `CRON_SECRET` — autoryzacja `/api/cron/*`
- `SUPABASE_PROJECT_ID` — skrypt `pnpm supabase:types`

**Konsekwencje:** dwa różne źródła prawdy dla zmiennych środowiskowych. Implementator może nie zauważyć Paddle Price IDs lub `CRON_SECRET`, co zablokuje kolejno: checkout (US-045) i Vercel Cron.

**Rozwiązanie (zalecane):**
W `architecture-base.md` §18 **usunąć duplikat listy** i zastąpić odsyłaczem:
> Pełna lista zmiennych środowiskowych — w `tech-stack.md` §13 (jedyne źródło prawdy). `.env.example` w roocie repo zawiera szablon do skopiowania jako `.env.local`.

Alternatywnie: zsynchronizować listę 1:1 z `tech-stack.md` §13.

**Rekomendacja:** opcja "odsyłacz" — eliminuje przyszły dryf między dokumentami; `tech-stack.md` jako single source of truth dla stosu i konfiguracji jest spójne z jego rolą zadeklarowaną w §1 i §18.

---

### 1.4 `architecture-base.md` §17 vs `src/i18n/routing.ts` — niespójność w detekcji języka

**Problem:**
`architecture-base.md` §17 (Internacjonalizacja):
> "Lokalizacja: ustawienia przeglądarki przy pierwszej wizycie → zapis w localStorage i `user_profiles.locale`."

`src/i18n/routing.ts`:
```typescript
export const routing = defineRouting({
  locales: ['pl', 'en'],
  defaultLocale: 'pl',
  localePrefix: 'as-needed',
  localeDetection: false   // ← detekcja przeglądarki WYŁĄCZONA
});
```

`CLAUDE.md` potwierdza świadomy wybór: *"i18n routing uses `localePrefix: 'as-needed'` with `localeDetection: false`"*.

**Konsekwencje:** dokumentacja sugeruje, że nowy użytkownik trafia na lokalizację dopasowaną do `Accept-Language`, ale rzeczywista konfiguracja zawsze startuje z `pl` (do momentu zmiany przez UI lub URL).

**Rozwiązanie:**
Zaktualizować `architecture-base.md` §17:
```diff
- Lokalizacja: ustawienia przeglądarki przy pierwszej wizycie → zapis w localStorage
- i user_profiles.locale. Przełącznik PL/EN w UI.
+ Detekcja locale wyłączona (`localeDetection: false` w `src/i18n/routing.ts`).
+ Domyślne locale = `pl`. Użytkownik zmienia język przez przełącznik PL/EN w UI;
+ wybór zapisywany w cookie next-intl + `user_profiles.locale` (po zalogowaniu)
+ + localStorage (dla gościa). Po wczytaniu strony locale jest odczytywane
+ w kolejności: pathname (`/en/...`) → cookie → defaultLocale (`pl`).
```

**Rekomendacja:** rozważyć też wykorzystanie `as-needed` świadomie — strony `pl` mają URLe bez prefiksu (`/`), strony `en` mają `/en`. To jest wygodne dla domyślnego locale, ale powoduje, że bookmark `/` zawsze otwiera PL, niezależnie od preferencji użytkownika. Jeśli preferencja PL/EN ma być "klejona" do użytkownika między urządzeniami, włącz redirect po zalogowaniu na `user_profiles.locale`.

---

### 1.5 `architecture-base.md` §18 (CI/CD diagram) sugeruje deploy w GitHub Actions — jest to sprzeczne z `tech-stack.md` §12

**Problem:**

`architecture-base.md` §18 (diagram CI/CD):
```
GitHub Actions
  ├── on: pull_request
  │     ├── lint (ESLint, tsc --noEmit)
  │     ├── test:unit (Vitest)
  │     └── test:e2e (Playwright — headless Chromium)
  └── on: push → main
        ├── build (next build)
        └── deploy → Vercel (production)
```

`tech-stack.md` §12 jasno stwierdza:
> "Deploy: **wyłącznie przez Vercel GitHub integration** (preview na każdy PR, production na push do `main`). Brak deploy stepa w GitHub Actions."

`.github/workflows/ci.yml`: nie ma joba `deploy`.

**Konsekwencje:** implementator może próbować dodać step `vercel deploy` do `ci.yml`, co dubluje deploy (Vercel integration już to robi automatycznie) i wymaga `VERCEL_TOKEN` w sekretach.

**Rozwiązanie:**
Poprawić §18 w `architecture-base.md`:
```diff
- └── on: push → main
-       ├── build (next build)
-       └── deploy → Vercel (production)
+ └── on: push → main
+       └── (ten sam zestaw lint/typecheck/test co dla pull_request)
+
+ Deploy: WYŁĄCZNIE przez Vercel GitHub Integration (preview per PR,
+ production na push do main). Brak deploy stepa w GitHub Actions
+ (zgodnie z tech-stack.md §12).
```

---

### 1.6 `db-plan.md` mówi o "0001_init.sql jako historycznym pliku" — w rzeczywistości plik jest **usunięty** w bieżącej zmianie

**Problem:**

`db-plan.md` (preambuła) i §5.12:
> "Plik 0001 zostaje historyczny (nie rollback, ale superseded)."

`git status`:
```
 D supabase/migrations/0001_init.sql
?? supabase/migrations/20260507000000_complete_schema.sql
```

**Konsekwencje:**
- Migracja `20260507000000_complete_schema.sql` zaczyna od `DROP TABLE ... CASCADE` i `DROP FUNCTION ... CASCADE`, czyli zakłada że obiekty z 0001 mogą istnieć w bazie. To jest poprawne dla bazy, w której 0001 było wcześniej zaaplikowane.
- W repo jednak 0001 jest usunięty z `migrations/`. Świeży `pnpm supabase db reset` na czystej bazie wykona tylko `20260507000000_*` (i drop'y zadziałają na pustej bazie — `IF EXISTS`).
- **Niespójność narracyjna:** doc obiecuje "historyczny plik 0001", a w repo go nie ma. Nowy programista odkrywa to dopiero przy `git log -- supabase/migrations/`.

**Rozwiązanie:**
Zaktualizować preambułę `db-plan.md` i §5.12:
```diff
- Greenfield — plik `0001_init.sql` zostaje historyczny.
+ Greenfield — plik `0001_init.sql` został fizycznie usunięty z repo
+ (`git rm supabase/migrations/0001_init.sql`); historię można zobaczyć
+ przez `git log --all -- supabase/migrations/0001_init.sql`.
```
Oraz w §5.12:
```diff
- Plik 0001 zostaje historyczny (nie rollback, ale superseded).
+ Plik 0001 został usunięty z repo. `DROP IF EXISTS` w nowej migracji
+ chroni przed błędem przy aplikacji na bazie, w której 0001 było już
+ aplikowane (środowisko z poprzedniej iteracji bootstrapu).
```

**Rekomendacja:** **opcja alternatywna** — jeśli pracujesz w trybie greenfield i 0001 nigdy nie trafiło do żadnego środowiska poza dev, rozważ przeniesienie obecnej migracji do `0001_init.sql` (single greenfield migration). Wymaga: usunięcia obecnego `20260507000000_complete_schema.sql`, utworzenia `0001_init.sql` z tymi samymi treścią, ale **bez** kroków DROP (czysty CREATE). Korzyść: nazewnictwo zgodne z konwencją Supabase i czytelne dla osoby dołączającej do projektu po latach.

---

### 1.7 `src/lib/supabase/server.ts:createAdminClient` używa `createServerClient` z `@supabase/ssr` zamiast `createClient` z `@supabase/supabase-js`

**Problem:**

`api-plan.md` §3 ("Klient service_role"):
```typescript
import { createClient } from '@supabase/supabase-js'
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

`src/lib/supabase/server.ts`:
```typescript
export async function createAdminClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    }
  )
}
```

**Konsekwencje:**
- Service role **nie korzysta z cookies sesji użytkownika** (omija RLS przez sam token), więc cały handler `cookies` jest dead code.
- Wywołanie `await cookies()` z poziomu webhooka Paddle (`POST /api/paddle/webhook`) wymusza dynamic rendering nawet jeśli niepotrzebnie — koszt przy zimnym starcie funkcji serverless.
- Niespójność z dokumentacją API i mylące nazewnictwo (`createServerClient` ≠ "service role client").

**Rozwiązanie (zalecane):**
```typescript
// src/lib/supabase/server.ts
import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createAdminClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    }
  );
}
```

Plus zaktualizować `package.json` aby `@supabase/supabase-js` był dostępny jako bezpośrednia zależność (już jest: `^2.45.0`) — żadne nowe zależności nie są potrzebne.

**Uwaga:** to jest **decyzja architektoniczna** — alternatywą jest udokumentować w `api-plan.md`, że projekt używa `createServerClient` dla obu rodzajów (anon + service_role) jako jednolitej abstrakcji. Wybór "createClient z supabase-js" jest standardową praktyką Supabase i jest tańszy.

---

## 2. 🟡 Istotne

### 2.1 `architecture-base.md` §6 — `pipe-front` używa `outerRadius`, ale PRD US-019 specyfikuje "średnicę zewnętrzną"

**Problem:**

| Dokument | Pole / Reguła |
|---|---|
| PRD US-019 | "Dostępne parametry proporcjonalne: **średnica zewnętrzna** i grubość ścianki" |
| PRD US-019 | "wallThickness < średnica zewnętrzna / 2 − 1" |
| `architecture-base.md` §6 `pipe-front` | `outerRadius: number`, `wallThickness < outerRadius − 1` |
| `architecture-base.md` §6 `pipe-longitudinal` | `outerDiameter: number`, `wallThickness < outerDiameter / 2 − 1` |

**Konsekwencje:**
- Niespójne nazewnictwo dwóch wariantów rury (`pipe-front` używa promienia, `pipe-longitudinal` używa średnicy) zwiększa ryzyko błędów przy implementacji `Renderer`-ów oraz `PropertiesPanel`-i.
- PropertiesPanel dla `pipe-front` musi pokazywać **średnicę** (UX wymaganie z PRD), więc i tak trzeba konwertować na poziomie panelu (`diameter = 2 * outerRadius`). To dryf między modelem domeny a UI.
- Walidacja `wallThickness < outerRadius − 1` w architekturze daje inny próg niż `wallThickness < outerDiameter / 2 − 1` z PRD: dla `outerDiameter = 100`: PRD daje `wallThickness < 49`, architektura `wallThickness < 99`. **Różnica 2× krytyczna**.

**Rozwiązanie (zalecane):**
Ujednolicić oba kształty na **`outerDiameter`** (zgodnie z PRD i `pipe-longitudinal`):

```diff
 interface PipeFrontShape extends BaseShape {
   type: 'pipe-front'
-  outerRadius: number
-  wallThickness: number    // constraint: < outerRadius − 1
+  outerDiameter: number
+  wallThickness: number    // constraint: < outerDiameter / 2 − 1
 }
```

Wewnątrz `Renderer`-a `pipe-front` przeliczać raz: `radius = outerDiameter / 2`. Single source of truth = `outerDiameter`. Operacje SNAP / bounding box są niezmienione (operują na worldcoords).

**Rekomendacja:** wyrównanie na średnicę jest tańsze niż wyrównanie na promień (PRD jest jednoznaczny w US-019/US-020 że użytkownik wpisuje średnicę). Zmiana **musi** być przeprowadzona przed implementacją `pipe-front` (kształt jeszcze nie istnieje w `src/shapes/`).

---

### 2.2 `architecture-base.md` §7 `BeadShape` ogranicza warianty do dwóch, PRD §3.6 / US-038 mówi "także inne dostępne warianty"

**Problem:**

| Dokument | Definicja |
|---|---|
| `architecture-base.md` §7 | `type BeadShape = 'rounded-triangle' \| 'rounded-trapezoid'` |
| PRD §3.6 i US-038 | "trójkąt z zaokrąglonymi wierzchołkami oraz trapez z zaokrąglonymi wierzchołkami, **a także inne dostępne warianty**" |

**Konsekwencje:**
- Definicja architektoniczna jest zamknięta (closed union), a PRD jest otwarty.
- Implementator nie wie, czy MVP ma realnie 2 warianty (i PRD trzeba doprecyzować) czy więcej (i architecture trzeba rozszerzyć).

**Rozwiązanie:**
Zdecydować jedną z dwóch opcji **przed implementacją `WeldSequencePanel`**:

- **Opcja A (zalecana dla MVP — minimalizacja scope):** zawęzić PRD do dwóch wariantów. PRD §3.6 i US-038:
  > "Dostępne kształty ściegu w MVP: trójkąt z zaokrąglonymi wierzchołkami i trapez z zaokrąglonymi wierzchołkami. Dodatkowe warianty — post-MVP."

- **Opcja B (jeśli już znamy potrzebne warianty):** rozszerzyć `BeadShape` w architecture §7 i `WeldBeadSequenceData` w PRD US-038 o pełną listę (np. `'flat-rectangle'`, `'sharp-triangle'`, ...). Wymaga inputu od użytkowników biznesowych.

**Rekomendacja:** **Opcja A**. PRD MVP powinno być zamknięte; "także inne" to scope creep. Po wdrożeniu MVP łatwo dodać warianty (registry-driven nie wymaga, ale `BeadShape` jest unią literalną — dodanie wartości to jedna linia w `weld-units/types.ts`).

---

### 2.3 Indeks `documents_schema_version_idx` z literałem `< 1` — partial index zawsze pusty, niespójność z `db-plan.md`

**Problem:**

`db-plan.md` §3 (Indeksy):
> `(schema_version) WHERE schema_version < CURRENT_SCHEMA_VERSION` (partial)

`supabase/migrations/20260507000000_complete_schema.sql`:
```sql
create index documents_schema_version_idx
  on public.documents (schema_version)
  where schema_version < 1;
```

Komentarz w SQL:
> "currently empty (schema_version = 1 is the only version); update literal when version bumps"

**Konsekwencje:**
- Przy `default 1` i `CHECK schema_version >= 1`, predykat `< 1` jest zawsze fałszywy → indeks zawsze pusty (zerowy koszt utrzymania, ale i zerowa użyteczność).
- Aktualizacja literału przy każdym bump schemaVersion to **manualny krok** który łatwo przeoczyć — zwłaszcza że bump dzieje się w kodzie aplikacji (`src/lib/documentCodec.ts`), a nie w SQL.
- `db-plan.md` opisuje zachowanie abstrakcyjnie ("CURRENT_SCHEMA_VERSION"), co maskuje pułapkę.

**Rozwiązanie (zalecane):**
Dwa równolegle podejścia:

1. **Zaktualizować `db-plan.md` §3** aby jawnie powiedzieć:
   ```diff
   - `(schema_version) WHERE schema_version < CURRENT_SCHEMA_VERSION` (partial)
   + `(schema_version) WHERE schema_version < N` (partial, N = aktualna
   +  wartość `CURRENT_SCHEMA_VERSION` z `documentCodec.ts` + 1, czyli
   +  literal w SQL = nowy nieobsługiwany schemaVersion). Indeks
   +  wymaga ręcznej migracji DROP/CREATE przy każdym bump'ie. Aktualnie 1.
   ```

2. **Lub uprościć indeks** — zamiast partial index z literałem do aktualizacji, użyć pełnego B-tree na `schema_version`:
   ```sql
   create index documents_schema_version_idx on public.documents (schema_version);
   ```
   Koszt: minimalny (mała kardynalność, wpisy się powtarzają), korzyść: brak ręcznej migracji.

**Rekomendacja:** **Opcja 2** (full B-tree) — partial index z literałem jest premature optimization na tym etapie projektu. Liczba dokumentów z migracją codec'a będzie liczona w setkach, nie milionach.

---

### 2.4 `db-plan.md` §5.14 pkt 1 — otwarty temat "timing crona cleanup-webhook-events" jest już zamknięty w innych dokumentach

**Problem:**
`db-plan.md` §5.14 pkt 1:
> "Timing crona `cleanup-webhook-events` — częstotliwość ustalona (tygodniowo), dzień/godzina **do dopisania w `vercel.json`**."

`tech-stack.md` §12 oraz `api-plan.md` §2.1 mają już konkretne wartości: `0 2 * * 0` (niedziela 02:00 UTC).

**Konsekwencje:** drobna, ale temat oznaczony jako otwarty w jednym dokumencie i zamknięty w innym wygląda na niedopilnowanie procesu redakcyjnego.

**Rozwiązanie:**
Zaktualizować `db-plan.md` §5.14 pkt 1:
```diff
- 1. **Timing crona `cleanup-webhook-events`** — częstotliwość ustalona
-    (tygodniowo), dzień/godzina do dopisania w `vercel.json`.
+ 1. **Timing crona `cleanup-webhook-events`** — niedziela 02:00 UTC
+    (`0 2 * * 0`), zgodnie z `tech-stack.md` §12 i `api-plan.md` §2.1.
+    Wartość zatwierdzona; punkt zamknięty.
```

I tożsamą zmianą zamknąć pkt 8 (mapping `'project_limit_exceeded'`) i pkt 9 (lookup webhooka Paddle) — pkt 9 jest udokumentowany w `api-plan.md` §2.1 (sekcja "Lookup użytkownika").

---

### 2.5 `architecture-base.md` §16 — Duplikowanie dokumentu (US-012) jest dobrze opisane, ale brakuje wzmianki o licznikach planu w UI

**Problem:**

`architecture-base.md` §16 dokumentuje duplicate jako client-side (read + insert) z trigger'em DB jako bezpiecznikiem. To rozwiązanie jest poprawne, ale **nie precyzuje, kiedy UI ma sprawdzać limit**:

- Trigger DB rzuca `project_limit_exceeded` — UI dostaje błąd PostgREST i mapuje na toast.
- Ale UI dla planu Free powinien **proaktywnie ukryć przycisk "Duplikuj"**, gdy istnieje już 1 projekt — żeby błąd DB był *unreachable code*.

PRD US-012 mówi "Limit projektów planu Free (1 projekt) jest respektowany przy duplikowaniu" — bez precyzji czy chodzi o ukrycie przycisku, dezaktywację, czy obsługę błędu.

**Rozwiązanie:**
Doprecyzować w `architecture-base.md` §16 lub w PRD US-012:
```
- UI: przycisk "Duplikuj" jest disabled dla planu Free, jeśli liczba projektów ≥ 1
  (`useUserPlan().plan === 'free' && projects.length >= 1`).
- Click guard (defense-in-depth): jeśli UI permitów się rozjadą,
  trigger DB zawsze rzuca `project_limit_exceeded` → toast z CTA upgrade.
```

**Rekomendacja:** ten poziom szczegółu należy do warstwy "implementation guide" — można dopisać do `CLAUDE.md` lub nowej sekcji w `architecture-base.md` "Plan limits — UI vs DB".

---

### 2.6 `architecture-base.md` §3 mówi o `src/components/canvas/CanvasApp.tsx`, ale §22.4 i CLAUDE.md zezwalają tam na importy `konva` — warto to zaakcentować w drzewie

**Problem:** `eslint.config.mjs` ma override:
```js
{ files: ['src/canvas-kit/impl-konva/**', 'src/components/canvas/**'], rules: { 'no-restricted-imports': 'off' } }
```

Ale **drzewo katalogów w §3 nie sygnalizuje**, że `src/components/canvas/` jest **specjalną strefą** z dostępem do silnika canvasu. Czytelnik widzi katalog jako "zwykły komponentowy" i może nie zauważyć przywileju.

**Rozwiązanie:**
W §3 dodać adnotację:
```
  components/
    canvas/                 ← STREFA UPRZYWILEJOWANA (§22.3): może
                              importować konva/react-konva bezpośrednio
      CanvasApp.tsx
      ShapeNode.tsx
      ...
```

**Rekomendacja:** drobna, ale zwiększa świadomość granicy `canvas-kit`. CLAUDE.md już to ma — warto zsynchronizować formułę.

---

### 2.7 `architecture-base.md` §15 vs `db-plan.md` — od czasu naprawy w `api-plan-issues.md` #1 sekcje są spójne, ale §15 wciąż duplikuje schemat

**Problem:**

`architecture-base.md` §15 zawiera **kopię** schematu z `db-plan.md`. Każda kolejna zmiana w schemacie wymaga aktualizacji w dwóch miejscach.

**Rozwiązanie (zalecane):**
Skondensować §15 do **przeglądu** (5 nazw tabel + 1-zdaniowy opis każdej + diagram relacji ASCII) i odsyłać do `db-plan.md` po szczegóły:
```diff
 ## 15. Schemat bazy danych

-> Pełna specyfikacja — typy, constrainty, triggery, indeksy, RLS, funkcje
-> SECURITY DEFINER — w `.ai/db-plan.md` (jedyne źródło prawdy). Poniżej
-> przegląd pięciu tabel `public`.
-
-```sql
-(~70 linii pełnego SQL kopia z db-plan)
-```
+> Pełna specyfikacja — w `.ai/db-plan.md` (jedyne źródło prawdy schematu).
+> Tutaj jedynie przegląd pojęciowy.
+
+| Tabela | Rola | Mutacje |
+|---|---|---|
+| `user_profiles` | Profil 1:1 z `auth.users`; cache planu | trigger `handle_new_user` (insert), `authenticated` (locale) |
+| `documents` | Scena rysunku w JSONB | `authenticated` confirmed (CRUD) |
+| `subscriptions` | Historia Paddle | tylko `service_role` (webhook) |
+| `consent_log` | Audyt zgód RODO (append-only) | `authenticated` (insert) |
+| `webhook_events` | Idempotencja webhooków | tylko `service_role` |
+
+(diagram relacji ASCII bez zmian)
```

**Rekomendacja:** to eliminuje główną przyczynę problemu #1 z `api-plan-issues.md` (rozbieżność §15 ↔ db-plan). Zamiast dwukrotnie aktualizować schemat, mamy tylko `db-plan.md` jako single source of truth.

---

## 3. 🟢 Drobne

### 3.1 `tech-stack.md` §6 (Konva 9) vs ekosystem React 19 + react-konva 19

**Obserwacja:** `tech-stack.md` §16 (Macierz kompatybilności) celowo pinuje `konva@^9.0.0`. Komentarz: "Konva 10 (jeśli wyjdzie) wymusi sprawdzenie kompatybilności z react-konva". W rzeczywistości `react-konva@^19.2.x` ma peer dependency `konva@^9.3.0` (lub nowsze) — `^9.0.0` może nie spełnić peer.

**Rozwiązanie:** uściślić pin do `^9.3.0` (lub szerszy, np. `>=9.3.0 <11.0.0`) w `tech-stack.md` i zsynchronizować z `package.json` po pierwszej iteracji `pnpm install` (sprawdzić co `pnpm-lock.yaml` aktualnie rezolwuje).

**Rekomendacja:** opcjonalna — `^9.0.0` w SemVer rezolwuje do `9.x`, więc do `9.3+` automatycznie się trafi. Dokument można zostawić, ale dopisać "min 9.3 wymagane przez react-konva 19".

---

### 3.2 PRD §1 nie wspomina `@supabase/ssr` (jest tylko w tech-stack.md i architecture-base.md)

**Obserwacja:** PRD §1 mówi "Backend: Supabase (PostgreSQL, region EU — Frankfurt)" bez wzmianki o pakiecie `@supabase/ssr` używanym do session-management Next.js App Router.

**Rozwiązanie:** zostawić bez zmian — PRD jest na poziomie produktowym, nie technicznym. `tech-stack.md` jest właściwym miejscem na tę informację.

**Rekomendacja:** brak zmiany.

---

### 3.3 `supabase/config.toml` ma `enable_confirmations = false` — niezsynchronizowane z RLS na `documents`

**Obserwacja:**
- `supabase/config.toml`: `enable_confirmations = false` (lokalnie, dla wygody dev — auto-confirm)
- RLS na `documents`: `email_confirmed_at IS NOT NULL` jest warunkiem ALL operacji

W lokalnym dev `email_confirmed_at` jest auto-ustawiany przez Supabase Auth gdy `enable_confirmations = false`, więc RLS nie zablokuje. Ale w **staging/prod** musi być `enable_confirmations = true` (zgodnie z db-plan §4.2 i PRD §3.10).

**Rozwiązanie:** dodać do `db-plan.md` §4.2 lub `tech-stack.md` notatkę:
> "Lokalnie: `enable_confirmations = false` (auto-confirm dla wygody dev). W staging/prod: `enable_confirmations = true`. Test e2e RLS na `documents` powinien pokrywać oba scenariusze (confirmed/unconfirmed) przy użyciu `supabase.auth.admin.updateUserById` z service_role."

**Rekomendacja:** drobna; aktualnie nie blokuje.

---

### 3.4 `architecture-base.md` §6 `weld-joint._geometryChecksum` jest `string`, ale `WeldUnit.sequenceJointChecksum` jest `string | null`

**Obserwacja:**

```typescript
// architecture-base.md §6
interface WeldJointShape extends BaseShape {
  ...
  _geometryChecksum?: string   // do walidacji dormant sequence
}
// architecture-base.md §7
interface WeldUnit {
  ...
  sequenceJointChecksum: string | null
}
```

Pierwsza jest opcjonalna (`?:`), druga nullable (`| null`). Funkcjonalnie to to samo, ale różne style mogą mylić.

**Rozwiązanie:** ujednolicić styl. Sugerowane: w obu używać `string | null` (mniej dwuznaczne — pole zawsze obecne, tylko może być `null`).

**Rekomendacja:** drobna; zrealizować przy implementacji `bead-sequence.ts`.

---

### 3.5 `architecture-base.md` §22.5 deklaruje typ `usePointerInput(target: RefObject<HTMLElement>, ...)`, kod używa `RefObject<HTMLElement | null>`

**Obserwacja:**

```typescript
// architecture-base.md §22.5
export function usePointerInput(target: RefObject<HTMLElement>, handler: ...): void

// src/canvas-kit/pointerInput.ts
export function usePointerInput(target: RefObject<HTMLElement | null>, handler: ...): void
```

`RefObject<HTMLElement | null>` jest **dokładniejsze** dla idiomu React `useRef<HTMLElement>(null)`, który tworzy `RefObject<HTMLElement | null>`.

**Rozwiązanie:** zaktualizować architecture §22.5 do `RefObject<HTMLElement | null>`.

---

### 3.6 PRD §1 wspomina "Konva.js (via `react-konva`)" — bez wzmianki, że jest ukryta za canvas-kit boundary

**Obserwacja:** PRD jest pisany dla biznesu i nie powinien wnikać w architekturę. To OK. Ale poniżej w §3.3 PRD mówi "Silnik 2D: Konva.js implementowany przez `react-konva`" — można by tu dopisać "ukryty za warstwą abstrakcji `src/canvas-kit/` (architectura §22)".

**Rekomendacja:** brak zmiany. PRD i architecture-base mają różne audytoria.

---

### 3.7 `db-plan.md` §1 i `architecture-base.md` używają obu nazw `paddle_customer` (stara) i `paddle_customer_id` (nowa) — sprawdzone, że stara nazwa już nie występuje

**Obserwacja:** problem #10 z `api-plan-issues.md` ("Stare nazwy kolumn user_profiles") był naprawiony. Weryfikacja:
- `db-plan.md`: `paddle_customer_id TEXT UNIQUE` ✅
- `architecture-base.md` §15 (snippet schematu): `paddle_customer_id TEXT UNIQUE` ✅
- `architecture-base.md` §14: brak wzmianki o starej nazwie ✅
- Migracja SQL: `paddle_customer_id` ✅
- `src/types/database.ts`: `paddle_customer_id` ✅

**Status:** ✅ — żadnej akcji nie potrzeba.

---

### 3.8 `architecture-base.md` §3 mówi o `src/lib/captureGeometry.ts` jako "fasada rejestru" — typowo facade jest reeksportem, ale tutaj nie wiadomo czego

**Obserwacja:** §3:
```
lib/
  captureGeometry.ts      ← fasada rejestru
  shapeBounds.ts          ← fasada rejestru
```

Bez kontekstu nie wiadomo, czym konkretnie jest ta "fasada". Czytelnik dopiero w §5 / §21 dowiaduje się, że `SHAPE_REGISTRY[type].captureGeometry` i `getBoundingBox` są częścią `ShapeDefinition`.

**Rozwiązanie:** doprecyzować w komentarzu drzewa:
```diff
- captureGeometry.ts      ← fasada rejestru
- shapeBounds.ts           ← fasada rejestru
+ captureGeometry.ts      ← reeksport SHAPE_REGISTRY[type].captureGeometry
+                            (used by store: commitShapeUpdate)
+ shapeBounds.ts           ← reeksport SHAPE_REGISTRY[type].getBoundingBox
+                            (used by SNAP, exportEngine, multi-select)
```

---

### 3.9 `tests/smoke.test.ts` i `e2e/smoke.spec.ts` istnieją, ale nie są wspomniane w `architecture-base.md`

**Obserwacja:** repo zawiera szablony testowe (Vitest + Playwright). `architecture-base.md` §18 wspomina o testach jednostkowych i e2e, ale **nie pokazuje katalogów testów w drzewie §3**.

**Rozwiązanie:** dodać do §3:
```
tests/                    ← Vitest unit/integration (poza src/)
  smoke.test.ts
e2e/                      ← Playwright e2e
  smoke.spec.ts
```

**Rekomendacja:** drobna; wartość pedagogiczna dla nowego deweloperа.

---

### 3.10 `vitest.config.ts` ma `include: ['tests/**', 'src/**']` — `architecture-base.md` nie precyzuje, gdzie pisać testy

**Obserwacja:** vitest.config.ts pozwala na testy zarówno w `tests/` jak i w `src/`. PRD i architecture-base nie precyzują konwencji.

**Rozwiązanie:** ustalić konwencję w `CLAUDE.md` lub `CONTRIBUTING.md`:
- testy jednostkowe (czyste funkcje, slice'y store): `src/**/*.test.ts` (kolokacja)
- testy integracyjne (cross-module): `tests/**`
- e2e: `e2e/**`

**Rekomendacja:** drobna; do uściślenia przy pierwszym teście jednostkowym.

---

## 4. Status problemów z `api-plan-issues.md`

Poniżej weryfikacja, czy 13 problemów z poprzedniej analizy jest faktycznie zaadresowanych w aktualnej dokumentacji i kodzie:

| # | Tytuł | Status w docs | Status w kodzie | Komentarz |
|---|---|---|---|---|
| 1 | architecture-base.md §15 schemat | ✅ zaktualizowany | ✅ migracja zgodna | Patrz 2.7 — duplikuje db-plan; warto skondensować |
| 2 | architecture-base.md §16 brakujące endpointy | ✅ zaktualizowany | 🟡 tylko `/api/health` istnieje | reszta w pre-implementation |
| 3 | tech-stack.md §13 brakujące env vars | ✅ uzupełnione | ✅ `.env.example` zgodny | `architecture-base.md` §18 wciąż nie — patrz 1.3 |
| 4 | tech-stack.md §12 brak `crons` | ✅ przykład zaktualizowany | 🔴 `vercel.json` BEZ `crons` | Patrz 1.1 |
| 5 | Przepływ rejestracji z consent | ✅ udokumentowany | 🟡 nie zaimplementowany | architecture §14 zawiera flow |
| 6 | Duplikowanie dokumentu (US-012) | ✅ udokumentowane | 🟡 nie zaimplementowane | Patrz 2.5 — uściślić limit UI |
| 7 | `effective_plan` RPC kiedy wywoływać | ✅ udokumentowane | 🟡 nie zaimplementowane | api-plan §2.2 jasno definiuje |
| 8 | `lib/ipAnonymize.ts` w drzewie | ❌ wciąż brak w §3 | 🟡 nie zaimplementowane | Patrz 1.2 — propozycja drzewa zawiera |
| 9 | architecture-base.md proxy.ts | ✅ §16 zaktualizowane | ✅ kod zgodny | |
| 10 | architecture-base.md §14 stare nazwy | ✅ zaktualizowane | ✅ types zgodne | |
| 11 | tech-stack.md §12 region | ✅ zaktualizowane | ✅ vercel.json zgodny | |
| 12 | architecture-base.md §16 wzorzec Server Component | ✅ tech-stack.md §7 ma | ✅ kod zgodny | `lib/supabase/{client,server}.ts` |
| 13 | db-plan.md §5.14 pkt 9 lookup webhooka | ✅ api-plan §2.1 udokumentowany | 🟡 nie zaimplementowane | Patrz 2.4 — zamknąć pkt 9 w db-plan |

**Podsumowanie:** problem #4 (vercel.json `crons`) jest aktywny — eskalacja do 1.1 niniejszego dokumentu. Problem #8 (drzewo katalogów + ipAnonymize) jest aktywny — eskalacja do 1.2.

---

## 5. Problemy w kodzie (poza zakresem dokumentów)

### 5.1 `src/store/types.ts:AllShapeGeometry = {}` — placeholder

Pre-implementation, zgodnie z `CLAUDE.md`. ✅ żadnej akcji.

### 5.2 `src/shapes/registry.ts:SHAPE_REGISTRY = {}` — pusty rejestr

Pre-implementation. ✅ żadnej akcji.

### 5.3 `src/store/use-canvas-store.ts` — placeholder bez slice'ów

Pre-implementation. ✅ żadnej akcji.

### 5.4 `src/lib/snapEngine.ts` — funkcje zwracają `null` / no-op

Pre-implementation. ✅ żadnej akcji. CLAUDE.md i architecture §10.4 deklarują kontrakt, implementacja deferred.

### 5.5 `src/canvas-kit/impl-konva/activeStage.ts` — singleton ref do Stage

**Obserwacja:** singleton stage jest pragmatyczny dla `rasterize()`, ale wprowadza **globalny stan** (anti-pattern w testach). W jsdom lub e2e testach z wieloma instancjami (np. snapshot unit z wieloma kanwasami) wystąpią konflikty.

**Rozwiązanie:** rozważyć przy implementacji `exportEngine.ts` przejście na pattern context (React context z `Stage`-ref). Architectura §22.6 nie precyzuje sposobu dostępu — singleton jest jedną z opcji.

**Rekomendacja:** zostawić singleton dla MVP; dopisać uwagę w `architecture-base.md` §22.6 o trade-offie.

---

## 6. Podsumowanie — priorytety naprawy

### Akcje przed kolejną iteracją implementacyjną (kolejność rekomendowana):

1. **🔴 1.1** — Dodać `crons` do `vercel.json` (1 minuta).
2. **🔴 1.2** — Zaktualizować drzewo katalogów `architecture-base.md` §3 (uwzględnić `i18n/`, `lib/supabase/`, `types/`, `proxy.ts`, `[locale]/`, `api/{...}`).
3. **🔴 1.3** — Zsynchronizować `architecture-base.md` §18 env vars z `tech-stack.md` §13 (lub usunąć duplikat z §18).
4. **🔴 1.4** — Naprawić `architecture-base.md` §17 (usunąć "ustawienia przeglądarki", dodać `localeDetection: false`).
5. **🔴 1.5** — Naprawić `architecture-base.md` §18 diagram CI/CD (usunąć fałszywy "deploy step").
6. **🔴 1.6** — Naprawić preambułę `db-plan.md` (plik 0001 fizycznie usunięty, nie historyczny).
7. **🔴 1.7** — Refaktor `src/lib/supabase/server.ts:createAdminClient` na `createClient` z `@supabase/supabase-js`.
8. **🟡 2.1** — Decyzja: `pipe-front` używa `outerDiameter` (zalecane) lub udokumentować konwersję.
9. **🟡 2.2** — Decyzja: czy MVP ma 2 BeadShape czy więcej (zalecane: 2, doprecyzować PRD).
10. **🟡 2.3** — Decyzja: literal vs full B-tree na `documents.schema_version` (zalecane: full B-tree).
11. **🟡 2.4** — Domknąć otwarte tematy w `db-plan.md` §5.14 (timing crona, lookup webhooka).
12. **🟡 2.7** — Skondensować `architecture-base.md` §15 do przeglądu (db-plan jako SSOT schematu).

Drobne (3.x) — można dopisać do backlogu housekeepingu.

---

## 7. Zasady na przyszłość (rekomendacje organizacyjne)

1. **Single source of truth per topic.** Schemat DB: `db-plan.md`. Zmienne środowiskowe: `tech-stack.md` §13. Kontrakt API: `api-plan.md`. Inne dokumenty linkują, **nie duplikują**.
2. **Drzewo katalogów aktualizować razem z każdym `git mv` / nowym katalogiem** — najprościej dodać krok do `.husky/pre-commit` (np. ostrzeżenie gdy zmieniono `src/**/{routing,request,proxy,middleware}.ts` bez zmian w `architecture-base.md`).
3. **Otwarte tematy zamykać przez aktualizację dokumentu, nie nowy dokument** — `db-plan.md` §5.14 zawiera 11 otwartych punktów, z czego co najmniej 4 zostały rozstrzygnięte w innych docs ale wciąż nie zaktualizowane w db-plan.
4. **PRD zostaje na poziomie produktowym**, architecture-base na poziomie implementacyjnym, tech-stack na poziomie wersji/setupu, db-plan na poziomie SQL. Nie mieszać.
5. **Po każdej zmianie schematu DB:** regenerować `src/types/database.ts`, sprawdzić commit do repo. Skrypt `pnpm supabase:types` jest gotowy.