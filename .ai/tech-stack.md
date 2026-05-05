# Tech Stack — WelderDoc

> **Single source of truth** dla wszystkich technologii i wersji w projekcie.
> Wersja dokumentu: 1.0 · Data: 2026-05-05 · Status: zatwierdzony do implementacji
>
> Źródło decyzji: `.ai/tech-stack-analysis.md` (Phase 1).
> Zmiany w tym dokumencie wymagają aktualizacji `.ai/prd.md` oraz `.ai/architecture-base.md`.

---

## 1. Runtime i menedżer pakietów

| Co | Wersja | Notatka |
|---|---|---|
| **Node.js** | `22.x` (Active LTS do 2027-10) | Wspólny mianownik: Vercel + Playwright + Vitest |
| **pnpm** | `9.x` | Manager pakietów; szybszy install w CI |
| **package.json `engines.node`** | `"22.x"` | Wymusza wersję na Vercel i w CI |

---

## 2. Frontend — framework i język

| Pakiet | Wersja | Rola |
|---|---|---|
| `next` | `^16.2.0` | App Router, Turbopack stable, React Compiler stable |
| `react` | `^19.2.0` | UI runtime |
| `react-dom` | `^19.2.0` | DOM renderer |
| `typescript` | `^5.7.0` | Język |
| `@types/node` | `^22.0.0` | Typy Node |
| `@types/react` | `^19.0.0` | Typy React |
| `@types/react-dom` | `^19.0.0` | Typy React DOM |

**Wymagane konfiguracje:**

- `tsconfig.json`: `"strict": true`, `"moduleResolution": "Bundler"`, `"jsx": "preserve"`, `"types": ["vitest/jsdom"]`
- `next.config.ts` musi zawierać `turbopack.resolveAlias` dla `canvas` → `./empty.js` (patrz §6 Konva).

---

## 3. Frontend — UI / styling / ikony

| Pakiet | Wersja | Rola |
|---|---|---|
| `tailwindcss` | `^4.0.0` | Styling — konfiguracja w CSS (`@theme`, `@variant`) |
| `@tailwindcss/postcss` | `^4.0.0` | PostCSS plugin (wymagany w Next.js) |
| `lucide-react` | `^1.14.0` | Ikony (tylko web; nie używać `lucide-react-native`) |

**Wymagane pliki:**

- `postcss.config.mjs`:
  ```javascript
  export default { plugins: { '@tailwindcss/postcss': {} } }
  ```
- `app/globals.css` rozpoczyna się od:
  ```css
  @import 'tailwindcss';
  @variant dark (&:where(.dark, .dark *));
  @theme { /* tokens — kolory, spacing, fonty */ }
  ```

**Reguła**: import ikon pojedynczo (`import { Pencil } from 'lucide-react'`) — nigdy `import * as Icons`.

---

## 4. State management

| Pakiet | Wersja | Rola |
|---|---|---|
| `zustand` | `^5.0.0` | Store globalny (slice pattern) |
| `immer` | `^10.0.0` | Middleware do mutacyjnego API |

**Wzorzec**: Zustand z middlewarem `immer` z `zustand/middleware/immer`. Slice'y typowane jako `StateCreator<RootStore, [['zustand/immer', never]], [], Slice>`.

---

## 5. Internacjonalizacja

| Pakiet | Wersja | Rola |
|---|---|---|
| `next-intl` | `^4.0.0` | i18n dla App Router |

**Reguły**:

- `setRequestLocale(locale)` w każdym `page.tsx` i `layout.tsx` przed użyciem hooków `next-intl`.
- `generateStaticParams()` zwraca wszystkie locale (`['pl', 'en']`) dla SSG.
- Pliki tłumaczeń: `src/messages/pl.json`, `src/messages/en.json`.
- Zero hardcoded stringów w komponentach.

---

## 6. Canvas / silnik 2D

| Pakiet | Wersja | Rola |
|---|---|---|
| `konva` | `^9.0.0` | Silnik canvas |
| `react-konva` | `^19.2.3` | React bindings (peer-dep `react@19`) |

**Wymagane konfiguracje:**

- Wszystkie komponenty `react-konva` muszą być w plikach z `'use client'`.
- Komponent `<Canvas>` ładowany przez `next/dynamic({ ssr: false })`.
- `next.config.ts`:
  ```typescript
  import type { NextConfig } from 'next'
  const config: NextConfig = {
    turbopack: {
      resolveAlias: { canvas: './empty.js' },
    },
  }
  export default config
  ```
- Plik `empty.js` w roocie projektu: pusty (`export {}`).

**Reguły z architektury**:

- Pointer Events API wszędzie (`pointer*`); nie używać `mouse*` ani `touch*`.
- `setPointerCapture` przy każdym starcie dragu.
- `<Stage pixelRatio={window.devicePixelRatio}>` dla retina; `Konva.pixelRatio = 1` na mobile po detekcji.
- Pinch-to-zoom: śledzenie dwóch `pointerId` w `CanvasApp.tsx`. Zakaz `gesturestart`/`gesturechange`.

---

## 7. Backend / baza danych / auth

| Pakiet | Wersja | Rola |
|---|---|---|
| `@supabase/supabase-js` | `^2.45.0` | Klient bazy + auth |
| `@supabase/ssr` | `~0.10.0` | Cookies-based session w Next.js (pin patch — beta API) |

**Region instancji Supabase**: `EU (Frankfurt)` — wymóg PRD §3.10 (GDPR).

**Schema bazy**: zgodnie z `architecture-base.md` §15 (`documents`, `user_profiles`, RLS na `auth.uid()`).

**Cookies API**: używać współczesnego `getAll`/`setAll` (nie `get`/`set`/`remove`). Pełen `middleware.ts` chainuje:
1. `@supabase/ssr` `updateSession()` (refresh tokenu)
2. `next-intl` middleware (locale routing)

**Generowanie typów**:
```bash
npx supabase gen types typescript --project-id <id> --schema public > src/types/database.ts
```

---

## 8. Płatności

| Pakiet | Wersja | Rola |
|---|---|---|
| `@paddle/paddle-js` | `^1.0.0` | Frontend SDK do checkoutu inline |

**Server-side**: Paddle Billing API v2 — wywoływane bezpośrednio z `app/api/paddle/webhook/route.ts` (Node runtime, weryfikacja signature przez `PADDLE_WEBHOOK_SECRET`).

**Waluty MVP**: PLN (Pro Monthly 49 PLN, Pro Annual 399 PLN).

---

## 9. Testowanie — unit / integration

| Pakiet | Wersja | Rola |
|---|---|---|
| `vitest` | `^4.0.0` | Test runner (Vite-native, ESM, jest-compatible API) |
| `@vitejs/plugin-react` | `^4.3.0` | Transformer JSX dla Vitest |
| `vite-tsconfig-paths` | `^5.0.0` | Resolve aliasów `@/*` z `tsconfig.json` |
| `jsdom` | `^26.0.0` | DOM environment dla Vitest |
| `vitest-canvas-mock` | `^0.3.0` | Mock `CanvasRenderingContext2D` dla testów Konva |
| `@testing-library/react` | `^16.3.2` | Render komponentów React |
| `@testing-library/user-event` | `^14.5.0` | Symulacja interakcji użytkownika |
| `@testing-library/jest-dom` | `^6.4.0` | Matchers DOM (entry point `/vitest`) |
| `@vitest/ui` | `^4.0.0` | (opcjonalny) interaktywny dashboard |
| `@vitest/coverage-v8` | `^4.0.0` | Coverage przez V8 |

**Wymagane pliki:**

- `vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config'
  import react from '@vitejs/plugin-react'
  import tsconfigPaths from 'vite-tsconfig-paths'

  export default defineConfig({
    plugins: [react(), tsconfigPaths()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      globals: true,
      css: true,
    },
  })
  ```

- `vitest.setup.ts`:
  ```typescript
  import '@testing-library/jest-dom/vitest'
  import 'vitest-canvas-mock'
  ```

- `tsconfig.json` `compilerOptions.types` zawiera `["vitest/jsdom"]`.

---

## 10. Testowanie — E2E

| Pakiet | Wersja | Rola |
|---|---|---|
| `@playwright/test` | `^1.50.0` | E2E + visual regression |

**Wymagania**:
- Node ≥ 20 (mamy 22).
- W CI: image `mcr.microsoft.com/playwright:v1.50.0-noble` (Node 24 LTS).
- Visual regression dla canvasu: `await expect(page).toHaveScreenshot()` — uzupełnia `vitest-canvas-mock` (który nie renderuje wizualnie).
- Touch emulation: `page.touchscreen` dla testów PRD US-016.

**Wymagane pliki**:
- `playwright.config.ts` z projektami: `chromium-desktop`, `chromium-mobile` (touch emulation), `firefox-desktop`, `webkit-desktop`.

---

## 11. Linting / formatowanie

| Pakiet | Wersja | Rola |
|---|---|---|
| `eslint` | `^9.0.0` | Linter (flat config) |
| `eslint-config-next` | `^16.0.0` | Reguły Next.js |
| `@typescript-eslint/eslint-plugin` | `^8.0.0` | Reguły TS |
| `@typescript-eslint/parser` | `^8.0.0` | Parser TS |
| `prettier` | `^3.3.0` | Formatter |
| `prettier-plugin-tailwindcss` | `^0.6.0` | Sortowanie klas Tailwind v4 |

**Konfiguracja**: `eslint.config.mjs` (flat config), `prettier.config.mjs`, `.prettierignore`.

---

## 12. Hosting / deployment / CI

| Co | Wersja / Konfiguracja |
|---|---|
| **Vercel** | Stabilna platforma; region `fra1` w `vercel.json` (zgodny z Supabase EU-Frankfurt) |
| **GitHub Actions** | `actions/checkout@v4`, `actions/setup-node@v4` z Node 22, `pnpm/action-setup@v4` |
| **Wersja Node w CI** | `22.x` (musi pokrywać się z `engines.node`) |

**Workflow** (`.github/workflows/ci.yml`):
- `on: pull_request` → lint, tsc --noEmit, test:unit (Vitest), test:e2e (Playwright headless Chromium)
- Deploy: **wyłącznie przez Vercel GitHub integration** (preview na każdy PR, production na push do `main`). Brak deploy stepa w GitHub Actions.

**`vercel.json`**:
```json
{
  "regions": ["fra1"],
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile"
}
```

---

## 13. Zmienne środowiskowe

| Nazwa | Scope | Notatka |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | URL projektu Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Anon key (RLS chroni dane) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Wyłącznie w `app/api/paddle/webhook/route.ts` |
| `PADDLE_WEBHOOK_SECRET` | server only | Weryfikacja signature webhooka Paddle |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | client | Inicjalizacja Paddle.js w UI |
| `NEXT_PUBLIC_PADDLE_ENV` | client | `sandbox` / `production` |
| `NEXT_PUBLIC_APP_URL` | client + server | Public URL aplikacji (potrzebne do absolutnych linków) |

**`.env.example`** zawiera wszystkie powyższe z pustymi wartościami i komentarzami.
**`.env.local`** w `.gitignore` (Next.js domyślnie).

---

## 14. Skrypty `package.json`

```json
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
    "supabase:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts"
  },
  "engines": {
    "node": "22.x",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.0"
}
```

---

## 15. Pełna lista zależności (tylko top-level)

### `dependencies`

```
next@^16.2.0
react@^19.2.0
react-dom@^19.2.0
konva@^9.0.0
react-konva@^19.2.3
zustand@^5.0.0
immer@^10.0.0
tailwindcss@^4.0.0
@tailwindcss/postcss@^4.0.0
lucide-react@^1.14.0
next-intl@^4.0.0
@supabase/supabase-js@^2.45.0
@supabase/ssr@~0.10.0
@paddle/paddle-js@^1.0.0
```

### `devDependencies`

```
typescript@^5.7.0
@types/node@^22.0.0
@types/react@^19.0.0
@types/react-dom@^19.0.0

vitest@^4.0.0
@vitejs/plugin-react@^4.3.0
vite-tsconfig-paths@^5.0.0
jsdom@^26.0.0
vitest-canvas-mock@^0.3.0
@vitest/ui@^4.0.0
@vitest/coverage-v8@^4.0.0

@testing-library/react@^16.3.2
@testing-library/user-event@^14.5.0
@testing-library/jest-dom@^6.4.0

@playwright/test@^1.50.0

eslint@^9.0.0
eslint-config-next@^16.0.0
@typescript-eslint/eslint-plugin@^8.0.0
@typescript-eslint/parser@^8.0.0
prettier@^3.3.0
prettier-plugin-tailwindcss@^0.6.0
```

---

## 16. Macierz kompatybilności (skondensowana)

Wszystkie wersje powyżej tworzą spójny zestaw z **React 19 jako kotwicą**. Trzy świadome odstępstwa od „najnowszej" wersji:

| Pakiet | Wersja | Odstępstwo | Powód |
|---|---|---|---|
| `@supabase/ssr` | `~0.10.0` | Pin do patch range | Beta API, breaking changes możliwe między minor |
| `konva` | `^9.0.0` | Pin do major | Konva 10 (jeśli wyjdzie) wymusi sprawdzenie kompatybilności z `react-konva` |
| `vitest-canvas-mock` | `^0.3.0` | Major < 1.0 | Aktywnie rozwijany port `jest-canvas-mock`, ale przed-1.0 |

---

## 17. Co jest poza tym dokumentem (świadomie)

- **Konkretne wersje patch** — `pnpm install` z `^` rozstrzyga w czasie pierwszej instalacji; po niej `pnpm-lock.yaml` jest źródłem prawdy.
- **Style code review / branding tokens** — pojawią się w `app/globals.css` w ramach implementacji UI.
- **Konkretne komponenty UI** — projekt nie używa biblioteki gotowych komponentów (np. shadcn/ui) — własne komponenty na bazie Tailwind + Lucide. Decyzja może być ponownie rozważona, jeśli okaże się, że budowa komponentów wstrzymuje rozwój.

---

## 18. Procedura zmian

Każda zmiana technologii lub wersji w tym dokumencie wymaga:

1. Aktualizacji `.ai/prd.md` §1 ("Stos technologiczny").
2. Aktualizacji `.ai/architecture-base.md` §1 ("Stos technologiczny").
3. Aktualizacji `package.json` (z odpowiednim `pnpm install`).
4. Aktualizacji niniejszego dokumentu z wpisem w changelog na końcu.

---

## 19. Changelog

- **1.0** (2026-05-05): Pierwsza wersja zatwierdzona; bazuje na `.ai/tech-stack-analysis.md` v1.1. Decyzja o Vitest 4 zamiast Jest. PRD §1 i `architecture-base.md` §1 zaktualizowane synchronicznie.
