# WelderDoc

Przeglądarkowa aplikacja SaaS do tworzenia proporcjonalnych przekrojów złączy spawanych i sekwencji ściegów.

> **Status:** bootstrap lokalny. Vercel/Supabase/Paddle nie są jeszcze podpięte — patrz `.ai/init-project-setup-analysis.md` §4.

---

## Wymagania

- **Node.js** `22.x` (Active LTS) — patrz `.nvmrc`
- **pnpm** `>= 9`
- **Docker** — wymagany przez `supabase start` (lokalne Postgres + Auth + Storage)

```bash
nvm use                # ustawi Node 22 zgodnie z .nvmrc
npm i -g pnpm@9        # jeśli pnpm jeszcze nie jest zainstalowany
```

---

## Pierwsze uruchomienie

```bash
# 1. Instalacja zależności
pnpm install

# 2. Skopiuj template zmiennych środowiskowych
cp .env.example .env.local
# Wypełnij NEXT_PUBLIC_SUPABASE_ANON_KEY wartością z `supabase start` (krok 3)

# 3. Wystartuj lokalną instancję Supabase (Docker)
pnpm supabase start

# 4. Wystartuj aplikację
pnpm dev
```

Aplikacja dostępna na `http://localhost:3000`. Supabase Studio: `http://127.0.0.1:54323`.

---

## Skrypty

| Komenda               | Opis                           |
| --------------------- | ------------------------------ |
| `pnpm dev`            | Next.js dev server (Turbopack) |
| `pnpm build`          | Build produkcyjny              |
| `pnpm start`          | Serwer produkcyjny             |
| `pnpm lint`           | ESLint                         |
| `pnpm typecheck`      | `tsc --noEmit`                 |
| `pnpm format`         | Prettier — zapis               |
| `pnpm format:check`   | Prettier — weryfikacja         |
| `pnpm test`           | Vitest (watch)                 |
| `pnpm test:run`       | Vitest (single run)            |
| `pnpm test:ui`        | Vitest UI                      |
| `pnpm test:coverage`  | Vitest z pokryciem (V8)        |
| `pnpm test:e2e`       | Playwright                     |
| `pnpm test:e2e:ui`    | Playwright UI                  |
| `pnpm supabase:types` | Generowanie typów z Supabase   |

---

## Struktura

```
src/
  app/             # Next.js App Router (layout, page, route handlers)
  components/      # canvas, sidebar, toolbar, project-list
  shapes/          # rejestr kształtów (architecture §5)
  store/           # Zustand store + slice'y
  lib/             # snapEngine, exportEngine, documentCodec
  weld-units/      # state machine WeldUnit
  i18n/            # next-intl: routing, request, navigation
  messages/        # tłumaczenia pl.json / en.json
  middleware.ts    # Supabase + next-intl chain

supabase/
  migrations/      # SQL migracje (zarządzane przez Supabase CLI)
  config.toml      # konfiguracja lokalnej instancji

tests/             # Vitest (unit/integration)
e2e/               # Playwright
```

Pełna architektura: `.ai/architecture-base.md`.
Tech stack i wersje: `.ai/tech-stack.md`.
PRD: `.ai/prd.md`.

---

## Konwencje

- **Commity:** Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`). Wymuszane przez commitlint.
- **Formatowanie:** Prettier — uruchamiane automatycznie w pre-commit przez lint-staged.
- **Lint:** ESLint (Next 16 flat config) — uruchamiany automatycznie w pre-commit.
- **i18n:** zero hardcoded stringów w komponentach — wszystkie teksty w `src/messages/`.

Szczegóły: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Co jest świadomie odsunięte

Te elementy bootstrap zostawia jako placeholdery — uzupełniane w kolejnych etapach (analiza §4, §8):

- Projekty Vercel / Supabase / Paddle (cloud) — bootstrap obsługuje wyłącznie lokalny Supabase
- Domena produkcyjna i preview
- Branding (paleta, fonty, logo, favicon)
- Sentry / analityka
- LICENSE
- Branch protection rules
- Lighthouse CI / performance budgets
- React Compiler (`experimental.reactCompiler` — pomiar po pierwszym dotknięciu canvasu)
