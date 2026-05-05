# Technical Stack Analysis — WelderDoc

> Wersja dokumentu: 1.1 · Data: 2026-05-05 · Status: Faza 1 (analiza do akceptacji)
> **Zmiana w v1.1**: test runner zmieniony z Jest na **Vitest** — patrz sekcja Testing Stack i Identified Issues #1.

## Executive Summary

WelderDoc to przeglądarkowa aplikacja SaaS oparta na nowoczesnym stosie React/Next.js z silnikiem canvas opartym o Konva.js. PRD i `architecture-base.md` definiują stos jednoznacznie — niniejszy dokument weryfikuje **najnowsze stabilne wersje** każdego pakietu (stan na 2026-05-05) oraz wzajemną kompatybilność.

**Kluczowe wnioski:**

1. **Stos jest spójny i kompatybilny** — wszystkie warstwy (Next.js 16, React 19, react-konva 19, TypeScript 5.x, Vitest 4) tworzą skoordynowaną linię wersji. Łańcuch wymagań sprowadza się do **React 19 jako kotwicy** — wszystkie pozostałe biblioteki w stosie mają wersje React-19-ready.
2. **Trzy obszary uwagi:**
   - **Test runner: Vitest 4 zamiast Jest** (odstępstwo od PRD §1 — wymaga aktualizacji PRD). Powody: aktywnie rozwijany, natywne ESM, znacznie szybszy start, lepsze wsparcie dla Vite-ekosystemu i bibliotek canvas. Mocking canvas: `vitest-canvas-mock` (port z `jest-canvas-mock`, aktywnie utrzymywany).
   - **`@supabase/ssr` jest formalnie w fazie beta** — API może się zmieniać, ale jest oficjalnie rekomendowane przez Supabase i stabilne w produkcji u wielu użytkowników.
   - **`lucide-react-native` nie wspiera React 19** — *nie dotyczy MVP* (używamy `lucide-react` na web), ale warto odnotować przed ewentualną wersją mobilną natywną.
3. **Wymagana wersja Node.js: 22 LTS** (lub 24 LTS) — wymaganie Playwright + Vercel + Next.js 16 zbiegają się tutaj.
4. **Tailwind CSS v4** wymaga w Next.js dodatkowej konfiguracji (`@tailwindcss/postcss` + `postcss.config.mjs`) — niewielki, ale realny krok różniący od v3.
5. Plan migracji `next-intl` → `setRequestLocale` jest obowiązkowy w App Routerze Next.js 16 — należy uwzględnić w architekturze warstwy `app/`.

---

## Frontend Stack

### Next.js (App Router)
- **Recommended Version**: `16.2.x` (najnowsza linia stabilna z 2026)
- **Compatibility Notes**:
  - Wymaga **React ≥ 19.0**, `@types/react ≥ 19`, `@types/react-dom ≥ 19`.
  - Turbopack jest **stabilny i domyślny** dla `next dev` i `next build` (od v16). Plan: nie dodawać własnej konfiguracji webpack.
  - React Compiler 1.0 jest stabilny — można włączyć (`experimental.reactCompiler: true`) dla automatycznej memoizacji; rekomendowane po MVP, gdy scena urośnie.
  - Adapter API (16.2) gwarantuje, że Vercel-deployment jest "first-class" i nie wymaga dodatkowych konfiguracji.
- **Dependencies**: `react@19`, `react-dom@19`, `typescript@^5.4`.

### React + React DOM
- **Recommended Version**: `react@19.2.x`, `react-dom@19.2.x`
- **Compatibility Notes**:
  - Funkcje React 19 (`use`, Server Components, Server Actions, View Transitions, `useEffectEvent`, `<Activity />`) są kanoniczne dla Next.js 16.
  - **Wpływ na `react-konva`**: wszystkie komponenty canvas pozostają client-side (`'use client'`). Brak ryzyka, ale architektura zakłada podział na komponenty serwerowe (auth, lista projektów) i klienckie (canvas).
- **Dependencies**: brak zewnętrznych.

### TypeScript
- **Recommended Version**: `5.7.x` lub nowsza (≥ `5.4` to twardy wymóg Jest 30).
- **Compatibility Notes**:
  - Zgodne z React 19 typami (`@types/react@19`, `@types/react-dom@19`).
  - `ShapeUpdate` (intersection-derived) z architektury wymaga TS ≥ 5.0 dla zaawansowanych typów warunkowych — bezproblemowe.
- **Dependencies**: `@types/node@22`, `@types/react@19`, `@types/react-dom@19`.

### Konva.js + react-konva
- **Recommended Version**: `react-konva@19.2.3`, `konva@9.x` (peer-dep pasująca do react-konva 19)
- **Compatibility Notes**:
  - **Twarde sprzężenie major version**: `react-konva@19` wymaga `react@19`. Każde przyszłe upgrade React będzie pociągać upgrade `react-konva`.
  - `react-konva` musi być importowane wyłącznie po stronie klienta — w plikach z `'use client'` lub przez `next/dynamic({ ssr: false })`. Architektura już to zakłada (`CanvasApp.tsx`).
  - **Turbopack (default w Next.js 16) wymaga aliasu `canvas` → empty file** w `next.config.ts` (`turbopack.resolveAlias`), aby uniknąć błędu "Module not found: Can't resolve 'canvas'" (Konva ma `canvas` jako optional Node-side dep). Stwórz pusty plik `empty.js` w roocie projektu i wskaż go w aliasie.
  - Pinch-zoom: `Konva` natywnie obsługuje touch events, ale architektura zaleca Pointer Events API i dwa `pointerId` w `CanvasApp.tsx` — to poprawna decyzja (uniknięcie iOS `gesturestart` i tabletów Wacom).
  - `pixelRatio={window.devicePixelRatio}` na `<Stage>` — zalecane przez dokumentację Konva dla retina.
- **Dependencies**: `react@19`, `react-dom@19`.

### Zustand + Immer
- **Recommended Version**: `zustand@5.x`, `immer@10.x`
- **Compatibility Notes**:
  - `zustand@5` ma stabilną integrację React 19 (brak problemów z `useSyncExternalStore`).
  - Middleware `zustand/middleware/immer` wymaga `immer` jako bezpośredniej zależności.
  - Wzorzec slicing (architektura: 6 slice'ów) jest oficjalnie wspierany; typowanie slice'ów z Immer wymaga `StateCreator<T, [['zustand/immer', never]], [], Slice>` — udokumentowane w Zustand 5.
- **Dependencies**: `react@19`.

### Tailwind CSS
- **Recommended Version**: `tailwindcss@4.x` + `@tailwindcss/postcss@4.x`
- **Compatibility Notes**:
  - **Inna instalacja niż v3**: konfiguracja w CSS (`@theme` w globals.css), nie w `tailwind.config.js`.
  - Wymagany krok dla Next.js: `postcss.config.mjs` z `@tailwindcss/postcss` jako pluginem.
  - Pełna kompatybilność z Next.js 16 (App Router) i Turbopack.
  - **Implikacja dla Dark Mode** (PRD §3.9): w v4 dark mode robi się przez `@variant dark (&:where(.dark, .dark *));` w CSS — różnica względem v3 (`darkMode: 'class'`).
- **Dependencies**: `postcss`, `autoprefixer` (opcjonalnie — v4 obsługuje bez).

### Lucide React (ikony)
- **Recommended Version**: `lucide-react@1.14.x`
- **Compatibility Notes**:
  - **Tylko `lucide-react` (web)** — pakiet `lucide-react-native` *nie* wspiera jeszcze React 19 (peerDep `react@^16-18`). Dla MVP nie jest istotne, ale flagujemy jako blocker dla ewentualnej apki natywnej post-MVP.
  - Tree-shaking działa poprawnie z Turbopack — importować ikony pojedynczo: `import { Pencil } from 'lucide-react'`.
- **Dependencies**: `react@19`.

### next-intl
- **Recommended Version**: `next-intl@4.x`
- **Compatibility Notes**:
  - Pełna kompatybilność z Next.js 16 App Router.
  - **Obowiązkowy wzorzec w 16**: `setRequestLocale(locale)` w każdym `page.tsx` i `layout.tsx` przed użyciem hooków `next-intl`. `generateStaticParams` ze wszystkimi locale dla SSG.
  - SWC plugin + AoT message compilation dostępne — warto włączyć dla wydajności (~2KB bundle).
  - Architektura `src/messages/{pl,en}.json` z `architecture-base.md` jest zgodna z konwencją.
- **Dependencies**: `next@16`, `react@19`.

---

## Backend / Edge Stack

### Next.js Route Handlers
- **Recommended Version**: część `next@16.2.x`
- **Compatibility Notes**:
  - Architektura ogranicza Route Handlery do `/api/paddle/webhook` i `/api/health` — wszystko inne idzie przez Supabase client SDK + RLS. Decyzja poprawna i prosta w utrzymaniu.
  - `Node.js Runtime` (nie Edge) — `paddle/webhook` weryfikuje signature, lepiej w pełnym Node (dostęp do `crypto`, brak ograniczeń Edge).

### Node.js (runtime)
- **Recommended Version**: `Node.js 22 LTS` (alternatywa: 24 LTS)
- **Compatibility Notes**:
  - Vercel wspiera 20.x, 22.x, 24.x; Playwright wymaga 20.x/22.x/24.x; Jest 30 wspiera 18+ — **22 LTS jest "wspólnym mianownikiem"**.
  - Należy ustawić `"engines": { "node": "22.x" }` w `package.json` dla powtarzalności CI.

---

## Database & Data Layer

### Supabase (PostgreSQL EU-Frankfurt)
- **Recommended Version**: PostgreSQL 15 lub 16 (zgodnie z domyślną konfiguracją Supabase Cloud w 2026)
- **Compatibility Notes**:
  - Schema z architektury (`documents`, `user_profiles`) z RLS na `auth.uid()` — kanoniczny wzorzec Supabase.
  - JSONB dla `documents.data` jest właściwym wyborem dla scen 2D (pełny kodek `documentCodec.ts`).
  - Region EU (Frankfurt) — wymóg PRD §3.10 (GDPR).

### @supabase/supabase-js
- **Recommended Version**: `@supabase/supabase-js@2.x` (najnowsza)
- **Compatibility Notes**:
  - Pełne wsparcie dla Next.js 16, React 19, TypeScript 5.x.
  - Generowanie typów z bazy: `supabase gen types typescript --project-id ...` — rekomendowane w pipelinie CI dla type-safety.

### @supabase/ssr (auth + cookies w Next.js)
- **Recommended Version**: `@supabase/ssr@0.10.x`
- **Compatibility Notes**:
  - **⚠️ Status: beta** — API może mieć breaking changes. Mimo to jest oficjalnym, rekomendowanym pakietem (zastąpił `@supabase/auth-helpers-*`).
  - Konieczny `middleware.ts` w roocie projektu do refresh-owania sesji. Trzeba uważać na kolizję z middleware `next-intl` — oba muszą być **chainowane** (oficjalna recepta: middleware wywołuje obie funkcje sekwencyjnie).
  - Cookies-based session — działa w SSR, RSC, Route Handlers i Server Actions.

---

## Infrastructure & Hosting

### Vercel
- **Recommended Version**: stabilna platforma (kontynuacyjna)
- **Compatibility Notes**:
  - Zero-config deployment dla Next.js 16; preview URL dla każdego PR (zgodne z PRD §3 i `architecture-base.md` §18).
  - Funkcje serverless w regionie zbliżonym do Supabase (Frankfurt) → ustawić `vercel.json` z `regions: ["fra1"]` aby zminimalizować latency do bazy.
  - Limit free plan: 100 GB-h/miesiąc — wystarczające dla beta/MVP; rekomendowany **Pro plan przy launchu produktu**.
- **Dependencies**: integracja Vercel ↔ GitHub.

### Hosting plików statycznych (eksport)
- Eksport PNG/JPG generowany **client-side** przez `stage.toDataURL()` w `exportEngine.ts` — **brak storage'u plików**. Vercel hostuje wyłącznie statyczne assety i SSR.

---

## Third-Party Services

### Paddle (Merchant of Record)
- **Recommended Version**: `@paddle/paddle-js@1.x` (frontend SDK do checkoutu) + Paddle Billing API v2 (server-side)
- **Compatibility Notes**:
  - Oficjalny starter kit `paddle-nextjs-starter-kit` używa Paddle Billing + Supabase + Vercel — identyczny stos co WelderDoc. Można czerpać wzorce 1:1.
  - Webhook signature verification w `/api/paddle/webhook` — wymaga `PADDLE_WEBHOOK_SECRET` w env (zgodne z architekturą §18).
  - PLN (PRD): Paddle wspiera, ale rekomenduje konfigurację cen per-region — założyć przed launchem.

---

## Development & Build Tools

### Pakiet menedżer
- **Recommended**: `pnpm` (alternatywa: `npm`)
- **Compatibility Notes**:
  - `pnpm` zalecany dla Next.js 16 (lepsza obsługa workspace + szybszy install w CI).
  - Vercel natywnie wspiera obie opcje.

### ESLint + konfiguracja Next.js
- **Recommended Version**: `eslint@9.x`, `eslint-config-next@16.x`
- **Compatibility Notes**:
  - ESLint 9 wymaga **flat config** (`eslint.config.mjs`); `eslint-config-next` od v15 oficjalnie wspiera flat config.
  - Reguły TypeScript: `@typescript-eslint@8.x` (peer-dep `typescript@^5.4`).

### Prettier
- **Recommended Version**: `prettier@3.x`, `prettier-plugin-tailwindcss@latest`
- **Compatibility Notes**: plugin Tailwind v4 wymaga prettier-plugin-tailwindcss ≥ 0.6.

---

## Testing Stack

> **Odstępstwo od PRD §1**: PRD wymienia Jest jako wybór testowy. W tej analizie zmieniono na **Vitest** ze względów technicznych (patrz Identified Issues #1). PRD wymaga aktualizacji w sekcji "Stos technologiczny" przed Phase 2.

### Vitest (testy jednostkowe i integracyjne)
- **Recommended Version**: `vitest@4.0.x` (najnowsza linia stabilna w 2026)
- **Compatibility Notes**:
  - **Natywne ESM + TypeScript** — zero konfiguracji transformerów (Vite obsługuje to out-of-the-box). Brak problemów z importami `react-konva`, `konva`, `next-intl`, które są ESM-first.
  - **Jest-compatible API**: `describe`, `it`/`test`, `expect`, `vi.mock`, `vi.fn`, `vi.spyOn` — migracja istniejących testów Jest jest mechaniczna (`jest.fn` → `vi.fn`).
  - **Watch mode + HMR**: re-uruchamia tylko dotknięte testy, czas inkrementalny < 100 ms — krytyczne dla TDD na canvasie.
  - **Vitest UI** (`@vitest/ui`) — interaktywny dashboard testów, opcjonalny ale przydatny przy debugowaniu testów `react-konva`.
  - **Wymaga Node ≥ 18** (mamy 22 LTS) i TypeScript ≥ 5.0 (mamy 5.7).
- **Dependencies**: `vite@5.x`, `@vitejs/plugin-react@4.x`, `vite-tsconfig-paths@5.x` (do mapowania `@/*` zgodnie z `tsconfig.json`).

### Środowisko DOM dla Vitest
- **Recommended Version**: `jsdom@26.x` (alternatywa: `happy-dom@15.x`)
- **Compatibility Notes**:
  - `jsdom` — pełniejsza implementacja DOM, w tym `HTMLCanvasElement` jako stub (wymaga `vitest-canvas-mock`). Rekomendowane dla testów canvas-heavy.
  - `happy-dom` — szybsze (~2x), lżejsze, ale niepełna obsługa canvas. Mniej rekomendowane dla `react-konva`.
  - Konfiguracja: `test.environment: 'jsdom'` w `vitest.config.ts`.

### vitest-canvas-mock (mock canvas dla testów Konva)
- **Recommended Version**: `vitest-canvas-mock@latest` (port `jest-canvas-mock` przygotowany pod Vitest API)
- **Compatibility Notes**:
  - Eksportuje wszystkie metody `CanvasRenderingContext2D` jako `vi.fn()`-stuby — pozwala asercje "co Konva narysował" (np. `expect(ctx.fillRect).toHaveBeenCalledWith(...)`)
  - Setup w `vitest.setup.ts`: `import 'vitest-canvas-mock'`.
  - **Ograniczenie**: nie renderuje rzeczywistego canvasu. Dla testów wizualnych (np. czy uchwyt jest w prawidłowym miejscu) używamy Playwright + screenshot diff.

### @testing-library/react + @testing-library/jest-dom
- **Recommended Version**: `@testing-library/react@16.3.2`, `@testing-library/jest-dom@6.x`, `@testing-library/user-event@14.x`
- **Compatibility Notes**:
  - **Pełna kompatybilność z Vitest** — `@testing-library/jest-dom/vitest` rozszerza `expect` Vitestowy o matchers DOM (`toBeInTheDocument`, `toHaveAttribute` itp.).
  - **Pełna kompatybilność z React 19** od v16.3.2.
  - Identyczne API jak w Jest — żadnych różnic dla pisania testów komponentów.

### Playwright (E2E)
- **Recommended Version**: `@playwright/test@1.x` (najnowsza linia 2026)
- **Compatibility Notes**:
  - Wymaga **Node 20.x / 22.x / 24.x** — zgodne z naszą bazą Node 22.
  - Image obrazu Docker przeszedł na Node 24 LTS — w CI można użyć tego image'u dla determinizmu.
  - Wsparcie touch emulation (`page.touchscreen`) — krytyczne dla testów PRD US-016 (gesty mobile).
  - **Visual regression**: `expect(page).toHaveScreenshot()` — używać dla weryfikacji renderingu canvas (czego nie zweryfikuje `vitest-canvas-mock`).

---

## CI/CD Pipeline

### GitHub Actions
- **Recommended**: `actions/checkout@v4`, `actions/setup-node@v4` z Node 22
- **Compatibility Notes**:
  - Dwa workflow zgodnie z architekturą §18:
    - `on: pull_request` → lint, tsc, test:unit, test:e2e (headless Chromium)
    - `on: push → main` → build, deploy
  - **Recommendation**: Vercel Preview deployments zastępują manualny deploy w PR — tylko `main` deploy w GitHub Actions byłby redundantny (Vercel sam deployuje z `main`). Można skupić Actions wyłącznie na lint/test.
- **Dependencies**: integracja Vercel ↔ GitHub repo.

---

## Compatibility Matrix

| Komponent | Wersja | React 19 | Next.js 16 | Node 22 | Tailwind v4 | Vitest 4 | Komentarz |
|---|---|---|---|---|---|---|---|
| `next` | 16.2.x | ✅ | n/a | ✅ | ✅ | ✅ | Kotwica stosu |
| `react` / `react-dom` | 19.2.x | n/a | ✅ | ✅ | ✅ | ✅ | Wymóg twardy |
| `typescript` | 5.7.x | ✅ | ✅ | ✅ | ✅ | ✅ | Min 5.0 dla Vitest 4 |
| `react-konva` | 19.2.3 | ✅ | ✅ | ✅ | ✅ | ✅ | + vitest-canvas-mock |
| `konva` | 9.x | ✅ | ✅ | ✅ | n/a | ✅ | Pinch przez Pointer Events |
| `zustand` | 5.x | ✅ | ✅ | ✅ | n/a | ✅ | + middleware/immer |
| `immer` | 10.x | n/a | ✅ | ✅ | n/a | ✅ | Peer-dep `zustand` |
| `tailwindcss` | 4.x | n/a | ✅ | ✅ | n/a | n/a | + @tailwindcss/postcss |
| `lucide-react` | 1.14.x | ✅ | ✅ | ✅ | ✅ | ✅ | Tylko web (nie native) |
| `@supabase/supabase-js` | 2.x | ✅ | ✅ | ✅ | n/a | ✅ | |
| `@supabase/ssr` | 0.10.x | ✅ | ✅ | ✅ | n/a | n/a | ⚠️ Beta |
| `next-intl` | 4.x | ✅ | ✅ | ✅ | ✅ | ✅ | Wymaga setRequestLocale |
| `vitest` | 3.x | ✅ | ✅ | ✅ | n/a | n/a | Natywne ESM, Vite-based |
| `@vitejs/plugin-react` | 4.x | ✅ | ✅ | ✅ | n/a | ✅ | Transformer dla Vitest |
| `jsdom` | 26.x | ✅ | ✅ | ✅ | n/a | ✅ | environment dla Vitest |
| `vitest-canvas-mock` | latest | ✅ | ✅ | ✅ | n/a | ✅ | Mock CanvasRenderingContext2D |
| `@testing-library/react` | 16.3.2 | ✅ | ✅ | ✅ | n/a | ✅ | |
| `@testing-library/jest-dom` | 6.x | ✅ | ✅ | ✅ | n/a | ✅ | `/vitest` entry point |
| `@playwright/test` | 1.x (2026) | ✅ | ✅ | ✅ | ✅ | n/a | Node ≥ 20 |
| `@paddle/paddle-js` | 1.x | ✅ | ✅ | ✅ | ✅ | ✅ | |

---

## Identified Issues

### 1. Test runner — Vitest zamiast Jest (📝 odstępstwo od PRD §1)
- **Decyzja**: zamiast Jest 30 (wymienionego w PRD §1) używamy **Vitest 4**.
- **Powody techniczne**:
  - `jest-canvas-mock` (wymagany dla testów `react-konva`) **nie ma wydania od ~3 lat** — ryzyko niezgodności z Jest 30 + JSDOM 26 + Konva 9.
  - Vitest ma natywne wsparcie ESM — brak workaroundów dla bibliotek typu `react-konva`, `konva`, `next-intl` (wszystkie ESM-first).
  - Znacznie szybszy (start < 1s vs 3-5s w Jest), watch mode oparty o Vite HMR.
  - `vitest-canvas-mock` (port `jest-canvas-mock`) jest aktywnie utrzymywany.
  - Aktywny rozwój i dominacja w nowych projektach Vite/Next w 2026.
- **Wymagana akcja**: aktualizacja PRD §1 (sekcja "Stos technologiczny" → "Testowanie") — zamienić wymienione pakiety Jest na ich odpowiedniki Vitest.

### 2. `@supabase/ssr` w fazie beta (⚠️ niskie ryzyko, wysokie prawdopodobieństwo zmian)
- **Problem**: API formalnie nie-stabilne; możliwe breaking changes między 0.10.x a 1.0.
- **Wpływ**: refactor middleware przy upgradeach.
- **Mitygacja**: pinning patch version w `package.json`, śledzenie changelog na GitHubie Supabase.

### 3. Konflikt middleware `next-intl` ↔ `@supabase/ssr` (⚠️ niskie ryzyko, wymaga uwagi)
- **Problem**: oba pakiety oczekują własnego `middleware.ts` w roocie.
- **Wpływ**: bez chainingu sesja Supabase nie odświeża się na zlokalizowanych ścieżkach.
- **Mitygacja**: jeden `middleware.ts` chainujący `updateSession()` (Supabase) → `intlMiddleware()` (next-intl), z propagacją cookies.

### 4. Tailwind v4 — inny model konfiguracji (⚠️ niskie ryzyko)
- **Problem**: brak `tailwind.config.{js,ts}` — teraz wszystko w CSS (`@theme`, `@variant`).
- **Wpływ**: zmiana wzorców (devs przyzwyczajeni do v3 mogą nie znaleźć configu).
- **Mitygacja**: dokumentacja w `CLAUDE.md` projektu.

### 5. Brak macierzowych testów na fizycznym tablecie (architektura §20)
- **Problem**: PRD §3.3 wymaga obsługi pinch + stylus na tabletach, ale Playwright emuluje touch tylko częściowo.
- **Wpływ**: ryzyko regresji UX na tablecie Wacom / iPad Pro.
- **Mitygacja** (zgodnie z architekturą §20): manualne testy na fizycznym urządzeniu przed launchem.

### 6. `lucide-react-native` brak React 19 (post-MVP)
- **Problem**: jeśli kiedyś planowana wersja natywna mobile, peer-dep blokuje React 19.
- **Wpływ**: post-MVP — teraz nie blokuje.
- **Mitygacja**: śledzić issue #2951 na GitHub `lucide-icons/lucide`.

---

## Recommendations

### A. Decyzje wymagane przed Phase 2 (`tech-stack.md`)

1. **Test runner — Vitest** ✅ (zatwierdzone)
   - Wybór: **Vitest 4 + jsdom + vitest-canvas-mock** zamiast Jest.
   - **Wymagana akcja**: aktualizacja PRD §1 (sekcja "Stos technologiczny" / "Testowanie") na pakiety Vitest:
     - `jest` → `vitest`
     - `jest-environment-jsdom` → (wbudowane w Vitest, konfigurowane jako `environment: 'jsdom'`)
     - `jest-canvas-mock` → `vitest-canvas-mock`
     - `@testing-library/jest-dom` → pozostaje (działa z Vitest przez `/vitest` entry)
   - Bez zmian: `@testing-library/react`, `@testing-library/user-event`, `@playwright/test`.

2. **PNG export — alternatywa dla `stage.toDataURL()`**
   - Dla bardzo dużych canvasów (PRD §3.3: 2970×2100 px = 6.2 Mpx) `toDataURL` może być wolne. Rozważyć `stage.toBlob()` (Konva 9) jako szybsze. Decyzja może poczekać do implementacji.

3. **Wersja Node.js**: pin do **22.x** (Active LTS do października 2027).

4. **CI/CD scope**: czy GitHub Actions ma robić deploy, czy tylko lint+test (bo Vercel sam deployuje)? Rekomendacja: **tylko lint + test** w Actions; deploy zostawić Vercelowi.

### B. Konwencje techniczne do zapisania w finalnym `tech-stack.md`

- `pnpm` jako menedżer pakietów
- `engines.node: "22.x"` w `package.json`
- ESLint flat config + `prettier-plugin-tailwindcss`
- Wszystkie komponenty `react-konva` muszą być client-side (`'use client'`)
- Pinning patch version dla `@supabase/ssr` (np. `~0.10.0`)
- Region Vercel: `fra1` (zgodny z Supabase EU-Frankfurt)

### C. Bezpieczeństwo

- `SUPABASE_SERVICE_ROLE_KEY` — wyłącznie w Route Handlers (`/api/paddle/webhook`); **nigdy** w komponentach.
- `PADDLE_WEBHOOK_SECRET` — weryfikacja signature na serwerze (architektura §18).
- RLS włączone na `documents` i `user_profiles` (architektura §15) — krytyczne, sprawdzić w testach E2E (Playwright zalogowany użytkownik nie widzi cudzych dokumentów).
- Cookie consent z PRD §3.10 — można zrealizować bez dodatkowych pakietów (custom banner) lub przez minimalne zewnętrzne (np. `cookies-next`).

### D. Performance (PRD §6: ≥ 30 FPS, < 200 ms)

- React Compiler (Next.js 16) — włączyć dla auto-memoizacji po stabilizacji MVP.
- `Konva.pixelRatio = 1` na retina mobile (architektura §20).
- `updateShapeTransient` bez historii — zgodne z PRD; w `architecture-base.md` poprawnie odróżnione od `commitShapeUpdate`.
- Przy > 50 elementach: `node.cache()` na profilach (architektura §20) — gotowy plan.

---

## Next Steps

1. **Decyzja użytkownika** o:
   - Zakres GitHub Actions (lint+test vs lint+test+deploy) — patrz Recommendations A.4.
   - Akceptacja odstępstwa od PRD w obszarze testowym (Vitest zamiast Jest) i zgoda na aktualizację PRD §1.
2. **Zatwierdzenie listy wersji** (Compatibility Matrix powyżej) lub modyfikacje.
3. Po akceptacji → **Phase 2**: utworzenie `.ai/tech-stack.md` jako single source of truth (lista pakietów z dokładnymi wersjami, skrypty `package.json`, struktury config files, env vars).
4. Walidacja techniczna we wczesnym spike (≤ 1 dzień): minimalne `next@16` + `react-konva@19` + Stage z `pointer*` na fizycznym tablecie — zanim ruszy pełna implementacja MVP.

---

**Źródła weryfikacji wersji (stan na 2026-05-05):**
- [Next.js 16 release notes](https://nextjs.org/blog/next-16-2)
- [react-konva GitHub releases](https://github.com/konvajs/react-konva/releases)
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4)
- [Vitest documentation](https://vitest.dev/)
- [vitest-canvas-mock on npm](https://www.npmjs.com/package/vitest-canvas-mock)
- [@testing-library/react releases](https://github.com/testing-library/react-testing-library/releases)
- [@supabase/ssr on npm](https://www.npmjs.com/package/@supabase/ssr)
- [Playwright release notes](https://playwright.dev/docs/release-notes)
- [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Lucide React on npm](https://www.npmjs.com/package/lucide-react)
- [next-intl docs](https://next-intl.dev/)
- [Paddle Next.js starter kit](https://github.com/PaddleHQ/paddle-nextjs-starter-kit)
