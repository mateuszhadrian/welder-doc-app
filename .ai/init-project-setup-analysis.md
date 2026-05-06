# Analiza wstępnego setupu projektu — WelderDoc

> Dokument analityczny przygotowany jako wejście do fazy bootstrapu repozytorium.
> Bazuje na: `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/tech-stack.md`.
> Data: 2026-05-06.
> **Status:** decyzje organizacyjne zebrane (sekcja 7) — gotowe do implementacji bootstrapu lokalnego.

---

## 1. Stan repozytorium na dziś

```
welder-doc-app/
├── .ai/                        ← dokumentacja (PRD, architektura, tech stack)
├── .git/                       ← repo zainicjalizowane, branch `main`
├── .idea/                      ← konfiguracja IDE (JetBrains)
└── draft-docs/                 ← robocze materiały
```

**Brak całkowicie:**

- `package.json`, `pnpm-lock.yaml`, `node_modules/`
- Kodu źródłowego (`src/`, `app/`, `public/`)
- Konfiguracji TypeScript/Next.js/Tailwind/Vitest/Playwright/ESLint/Prettier
- Plików `.env.example`, `.nvmrc`, `.gitignore`, `.editorconfig`
- Workflowów GitHub Actions
- README, LICENSE, CONTRIBUTING

Innymi słowy — startujemy „od zera" mając jedynie dokumentację.

---

## 2. Co jest jasno określone w dokumentacji

### 2.1 PRD (`prd.md`)

Pełen, dojrzały dokument MVP:

- **Modele subskrypcji:** Guest / Free / Pro z konkretnymi limitami i ceną (49 PLN/mies., 399 PLN/rok, MoR = Paddle).
- **Funkcjonalność:** biblioteka prymitywów (plate, pipe-front, pipe-longitudinal, profile I/C/L/T), system połączeń spawalniczych z sekwencjami ściegów, tryby kursora, gesty dotykowe, SNAP w dwóch trybach, undo/redo z historią 100 kroków.
- **Wymagania niefunkcjonalne:** ≥ 30 FPS, < 200 ms reakcji UI, GDPR minimum, region EU/Frankfurt.
- **51 historyjek użytkownika** z kryteriami akceptacji.
- **Metryki sukcesu** wraz z metodami pomiaru.

### 2.2 Architecture (`architecture-base.md`)

- **Pełna struktura katalogów** `src/` (shapes, weld-units, store, components, lib, app).
- **Wzorce projektowe:** Shape Registry, WeldUnit state machine (`locked` / `sequence` / `detached`), transient vs. committed updates, separacja `FieldUpdate` / `ShapeUpdate`.
- **Definicje typów** dla wszystkich kształtów MVP, store'ów Zustand i API SNAP engine'u.
- **Schemat bazy:** tabele `documents` + `user_profiles` z politykami RLS.
- **Niezmienniki performance'u** (Konva pixelRatio, Pointer Events, hit area 8/20 px).

### 2.3 Tech Stack (`tech-stack.md`)

- **Konkretne wersje** wszystkich pakietów (Next 16, React 19, Konva 9, Vitest 4, Playwright 1.50, Tailwind 4, itd.).
- **Wymagane pliki konfiguracyjne** w postaci szkicu: `next.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `postcss.config.mjs`, `vercel.json`.
- **Macierz zmiennych środowiskowych** (sekcja 13).
- **Skrypty package.json** (sekcja 14).
- **Workflow CI** (sekcja 12) — lint, tsc, vitest, playwright, deploy via Vercel GitHub Integration.
- Trzy świadome odstępstwa od „najnowszego majora" są udokumentowane.

---

## 3. Cel tego etapu — bootstrap LOKALNY

**Decyzja produktowa:** w tej fazie nie tworzymy projektów Vercel / Supabase / Paddle ani nie konfigurujemy domeny / CI deploy. Skupiamy się na pełnowartościowym środowisku **dla developera lokalnego** i przygotowaniu struktury, która bezboleśnie wpięcie w Vercel + Supabase staging w kolejnym kroku — gdy podstawowa funkcjonalność będzie już dodana w trybie lokalnym.

Co znaczy „lokalny bootstrap":

- Repozytorium ma `pnpm dev` „bezbłędnie" startować Next.js 16 z React 19, Tailwind v4, Konvą i Zustand.
- `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm build` przechodzą na pustym, ale poprawnie strukturalnie zainicjalizowanym projekcie.
- Lokalna baza Supabase startuje przez `supabase start` (Docker); migracje w `supabase/migrations/0001_init.sql` zgodne z architekturą §15.
- Husky + lint-staged + commitlint zainstalowane i działają.
- `.env.example` opisuje wszystkie zmienne środowiskowe; `.env.local` template gotowy.
- README opisuje procedurę startową dla nowego dewelopera.
- GitHub Actions workflow przygotowany jako "ready-to-go" (lint + typecheck + unit + E2E), ale nie blokuje bootstrapu — będzie aktywowany, gdy podepniemy projekt do GitHub i Vercel.
- Wszystko, co dotyczy **deployu / CI / sekretów / domain** — zaślepione i czeka na osobny krok.

---

## 4. Decyzje uzgodnione

### 4.1 Zewnętrzne usługi i CI/CD — odsunięte w czasie

- **Supabase, Vercel, Paddle:** nie ma jeszcze projektów; bootstrap przygotowuje strukturę, ale nie tworzy zasobów.
- **Domena:** nieustalona; na lokalnym bootstrapie nie potrzebna.
- **Workflow GitHub Actions:** plik `ci.yml` przygotowany jako szkielet (lint, typecheck, vitest, playwright headless), ale aktywacja po podpięciu repo do GitHub.

### 4.2 Persistencja historii — sprzeczność rozstrzygnięta

**Decyzja:** historia operacji **wyłącznie w localStorage**. Architektura `architecture-base.md` §11 i §13 ma rację. Plik `prd.md` został zaktualizowany w trzech miejscach (§3.5, §4 zakres MVP, US-029).

### 4.3 Code quality — pre-commit i konwencja

- **Husky** (zarządzanie hookami git).
- **lint-staged** w pre-commit: tylko zmienione pliki, `eslint --fix` + `prettier --write`.
- **commitlint** w commit-msg: `@commitlint/config-conventional` (Conventional Commits).
- **typecheck w pre-commit pominięty** — drogi, lepiej w CI / pre-push (opcjonalnie później).
- Brak pre-push hooka na start — żeby nie spowalniać iteracji; CI to wyłapie.

Zalecane typy commitów (Conventional Commits): `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`. Zakres opcjonalny, np. `feat(canvas): ...`, `fix(snap): ...`.

### 4.4 Prettier — formatowanie

```
printWidth: 100
singleQuote: true
semi: true
trailingComma: 'none'
arrowParens: 'always'        // sensowny default
plugins: ['prettier-plugin-tailwindcss']
```

### 4.5 Testy — coverage i scope CI

**Coverage (rekomendacja, sekcja 5.1):**

- Próg globalny dla katalogów z czystą logiką (`src/lib/**`, `src/shapes/**`, `src/weld-units/**`, `src/store/**`):
  - lines 80%, functions 80%, branches 70%, statements 80%.
- Komponenty UI (`src/components/**`, `src/app/**`) bez progu — pokrycie zapewnia E2E.
- `--coverage` w `pnpm test:coverage`; raport `lcov` + `text-summary`.

**Playwright — projekty CI:**

- `chromium-desktop` → **blokuje merge** (mandatory).
- `chromium-mobile`, `firefox-desktop`, `webkit-desktop` → **informational** (uruchamiane, ale nie wymuszane do greena).
- W CI configuration: `--project=chromium-desktop` w głównym kroku, reszta w osobnym `continue-on-error: true`.

**Visual regression:** snapshoty commitowane do repo. Setup `--update-snapshots` dokumentowany w `CONTRIBUTING.md`. (Bez Git LFS — przy ~50–100 snapshotach PNG canvasu repo nie spuchnie krytycznie; przegląd po pierwszych 6 miesiącach.)

### 4.6 Środowisko E2E — staging

- W trybie lokalnym deweloper używa `supabase start` (Docker). Cypress/Playwright łączy się z `localhost:54321`.
- Docelowo (post-bootstrap): **dedykowana instancja Supabase „staging"** dla GitHub Actions E2E. Bootstrap przygotowuje:
  - Sekcję w `.env.example` dla `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`.
  - Krok w `ci.yml` (zaślepiony), który po dodaniu sekretów aktywuje testy przeciw stagingowi.

### 4.7 Branding i UI tokeny — odsunięte

- Paleta kolorów (light + dark), font stack, logo, favicon — **do uzgodnienia w fazie designu frontendu**.
- Bootstrap przygotowuje pusty `app/globals.css` z `@import 'tailwindcss';` i `@variant dark (...)`, plus pusty `@theme {}` jako placeholder.
- Czcionka tymczasowo `next/font/google` Inter (zmienne CSS ustawione, łatwa podmiana).

### 4.8 Migracje DB — Supabase CLI

- **Oficjalny Supabase CLI** (`supabase/migrations/*.sql`).
- `supabase start` lokalnie (Docker) dla każdego dewelopera.
- Migracja `0001_init.sql` zgodna z architekturą §15 (tabele `documents`, `user_profiles`, RLS policies).
- Generowanie typów: skrypt `pnpm supabase:types` zapisany w `package.json`.

### 4.9 Error tracking i analityka — odsunięte

Sentry / Plausible / GA — decyzja na później, po MVP. Bootstrap nie konfiguruje ich.

---

## 5. Rekomendacje (decyzje delegowane)

### 5.1 Coverage threshold (delegowane → moja rekomendacja)

**Rekomendowane progi** (Vitest `coverage.thresholds`):

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text-summary', 'lcov'],
  include: [
    'src/lib/**',
    'src/shapes/**',
    'src/weld-units/**',
    'src/store/**'
  ],
  exclude: [
    '**/*.{test,spec}.{ts,tsx}',
    '**/index.ts',                  // re-exports
    'src/shapes/_base/types.ts'     // pure types, nothing to cover
  ],
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 70,
    statements: 80
  }
}
```

**Uzasadnienie:** czysta logika (Shape Registry, WeldUnit state machine, snapEngine, exportEngine, autosize) jest sercem produktu i krytyczna do regresji. Komponenty UI są lepiej pokrywane przez Playwright (visual regression + interakcja). Próg 80/70 jest realny w MVP — wyższy generuje opór, niższy nie pilnuje regresji.

### 5.2 i18n routing dla `next-intl` (delegowane → moja rekomendacja)

**Rekomendacja: prefix-based „as-needed" z domyślnym `pl`** (bez prefiksu) oraz prefiksowany `/en/...`.

Konfiguracja `next-intl`:

```typescript
// src/i18n/routing.ts
export const routing = defineRouting({
  locales: ['pl', 'en'],
  defaultLocale: 'pl',
  localePrefix: 'as-needed'   // pl bez prefiksu, en z /en
})
```

Wówczas:
- `welderdoc.app/canvas/abc` → wersja PL
- `welderdoc.app/en/canvas/abc` → wersja EN

**Za:**
- Główna grupa docelowa = inżynierowie spawalnicy w Polsce — krótszy URL bez prefiksu = lepszy UX i pamiętalność dla domyślnych użytkowników.
- SEO: domyślny język nadal indeksuje się czysto bez duplicate-content, jeśli ustawimy `hreflang` i `canonical` poprawnie (next-intl to robi).
- Łatwo dodać kolejny locale (np. `de`, `cs`) bez rearanżacji URL-i istniejących użytkowników.
- Wzorzec dobrze udokumentowany w `next-intl` v4 i Next.js App Router.

**Przeciw:**
- Asymetria URL (jeden locale ma prefix, drugi nie) bywa myląca przy debugowaniu middleware.
- Cookies / browser locale detection z fallbackiem na `defaultLocale` wymaga ostrożności (redirect tylko przy pierwszej wizycie, żeby nie nadpisywać świadomego wyboru).

**Alternatywa „always" prefix (`/pl/...`, `/en/...` zawsze):**

- Za: spójna struktura, prostsza middleware logic, łatwiejsze cache'owanie per-locale.
- Przeciw: każdy URL polski ma `/pl/` co nie jest naturalne dla głównej grupy odbiorców; redirect z `/` zawsze konieczny; trochę dłuższe linki w komunikacji.

Idziemy więc w **„as-needed"** — modern best practice dla SaaS targetującego głównie jeden rynek z opcją międzynarodową.

### 5.3 Path aliases w `tsconfig.json` (delegowane → moja rekomendacja)

**Rekomendacja: pojedynczy alias `@/* → src/*`.**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Wariant A — pojedynczy alias `@/*`:**

- **Za:**
  - Default Next.js — żaden deweloper Next nie potrzebuje tłumaczenia.
  - Mniej do utrzymania w `tsconfig.json`, `vitest.config.ts`, ESLint i Vercel.
  - Refactor struktury katalogów = zero zmian w aliasach.
  - Minimalne ryzyko konfliktu z node_modules (`@`).
- **Przeciw:**
  - Importy w głębokich modułach mogą być długie: `import { foo } from '@/shapes/weld-joint/anchors'`.

**Wariant B — granularne aliasy (`@shapes/*`, `@store/*`, `@lib/*`, `@components/*`):**

- **Za:**
  - Krótsze importy (`import { foo } from '@shapes/weld-joint/anchors'`).
  - Domain boundaries widać w imporcie.
- **Przeciw:**
  - Każdy nowy domain-katalog (np. dodanie `@features/*`) wymaga update w 3+ plikach: `tsconfig.json`, `vitest.config.ts` (lub `vite-tsconfig-paths`), ewentualnie ESLint `import-x/resolver`.
  - Refactor struktury (przeniesienie folderu) = zmiana aliasu wszędzie, gdzie używany.
  - Mniej standardowo — nowy deweloper Next.js musi się tego nauczyć.

Architektura ma 4 główne domeny (`shapes/`, `weld-units/`, `store/`, `components/`) plus `lib/` i `app/`. Granularne aliasy dałyby ~6 wpisów. Zysk czytelności jest realny, ale nie krytyczny — różnica między `@/shapes/x` a `@shapes/x` to 2 znaki. Idziemy więc w **wariant A** (single `@/*`) — niższy koszt utrzymania, wyższe szanse, że nowy deweloper zrozumie kod od razu.

---

## 6. Pozostałe szczegóły konfiguracji do dopracowania w bootstrapie

Poniższe są drobne, nie wymagają już decyzji od Ciebie — zostaną ustawione na rozsądny default w trakcie bootstrapu (z jasnymi komentarzami w kodzie do ewentualnej weryfikacji po pierwszym dotknięciu):

- **`tsconfig.json`:** `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `noUncheckedIndexedAccess: true` (rekomenduję — wyłapuje błędy przy indeksowaniu tablic), `lib: ['ES2022', 'DOM', 'DOM.Iterable']`.
- **ESLint flat config:** `eslint-config-next/core-web-vitals`, `@typescript-eslint/recommended-type-checked`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-import-x`, `eslint-config-prettier` (na końcu).
- **Husky hooks:** `pre-commit` → `lint-staged`; `commit-msg` → `commitlint --edit "$1"`.
- **`next.config.ts`:** włączamy `turbopack.resolveAlias { canvas: './empty.js' }`; **NIE** włączamy `experimental.reactCompiler` w MVP — Next 16 ma go „stable", ale lepiej dodać świadomie po pierwszym deploy'u, żeby zmierzyć impact.
- **Bounded canvas — limit:** dodam walidację 100 ≤ width/height ≤ 10000 px w `setCanvasSize` żeby ochronić RAM.

---

## 7. Plan kolejności bootstrapu (zaktualizowany)

1. `package.json` (skrypty z tech-stack §14, `engines.node: '22.x'`).
2. `pnpm install` — wszystkie pakiety z tech-stack §15.
3. `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22), `.npmrc` (`engine-strict=true`).
4. `tsconfig.json` z `@/* → src/*`.
5. `next.config.ts`, `postcss.config.mjs`, `app/globals.css` ze skeletonowym `@theme {}`.
6. `app/layout.tsx`, `app/page.tsx` placeholder, `src/i18n/{routing,request}.ts`, `middleware.ts` (Supabase + next-intl chain), `src/messages/{pl,en}.json`.
7. Struktura `src/` z pustymi modułami (registry, store slices, components/canvas placeholders) — żeby `tsc --noEmit` przechodził.
8. ESLint flat config, Prettier config, `prettier-plugin-tailwindcss`.
9. Husky + lint-staged + commitlint.
10. `vitest.config.ts`, `vitest.setup.ts`, pierwszy smoke test (`tests/smoke.test.ts`).
11. `playwright.config.ts` z 4 projektami; pierwszy smoke E2E (`e2e/smoke.spec.ts`).
12. `supabase/migrations/0001_init.sql` zgodne z architekturą §15.
13. `supabase/seed.sql` (opcjonalnie — testowy user dla E2E).
14. `.env.example` (komplet zmiennych z tech-stack §13 + sekcja STAGING dla CI).
15. `.github/workflows/ci.yml` jako szkielet (zaślepiony do momentu podpięcia repo).
16. `README.md` (procedura startowa: `pnpm install`, `supabase start`, `pnpm dev`).
17. `CONTRIBUTING.md` (Conventional Commits, jak uruchamiać testy, jak update snapshotów).
18. `LICENSE` — **decyzja czeka** (sugeruję MIT lub proprietary; jeśli SaaS komercyjny — proprietary albo brak LICENSE = "all rights reserved" by default).

Po tym etapie: `pnpm dev` startuje localhost:3000, `pnpm test` przechodzi, `pnpm test:e2e` przechodzi przy działającym `supabase start`, `pnpm build` przechodzi. Aplikacja jeszcze nic nie robi (placeholdery), ale fundament jest gotowy do iteracyjnego dodawania feature'ów z PRD §5.

---

## 8. Otwarte punkty do rozstrzygnięcia w kolejnych etapach

| # | Temat | Etap |
|---|---|---|
| 1 | Założenie projektów Supabase / Vercel / Paddle | Po pierwszych feature'ach lokalnych |
| 2 | Domena produkcyjna i preview-domain konwencja | Wraz z #1 |
| 3 | LICENSE (MIT vs proprietary) | Przed pierwszym public push |
| 4 | Branding tokens (paleta, fonty, logo) | Faza designu frontendu |
| 5 | Sentry / analityka produktowa | Po MVP, przed launch |
| 6 | Branch protection rules na `main` (mandatory CI, review) | Po podpięciu repo do GitHub |
| 7 | Lighthouse CI / performance budgets | Po pierwszym deployu produkcyjnym |
| 8 | Włączenie React Compiler (`experimental.reactCompiler`) | Po pierwszym dotknięciu canvasu — pomiar impactu |

---

## 9. Podsumowanie

Po podjętych decyzjach jesteśmy gotowi do bootstrapu **lokalnego, dewelopersko-kompletnego projektu**. Wszystkie krytyczne sprzeczności w dokumentacji są wyjaśnione (historia → localStorage, naprawione w `prd.md`). Konfiguracja narzędzi jest dopięta lub ustawiona na rozsądny default. Każda zewnętrzna integracja (Vercel, Supabase, Paddle, domena, monitoring) jest świadomie odsunięta z bootstrapu i ma wyznaczone miejsce w późniejszych etapach. Plan z sekcji 7 jest gotowy do realizacji.