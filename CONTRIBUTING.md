# Contributing — WelderDoc

## Workflow

1. Stwórz branch z `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. Wprowadź zmiany. Pre-commit hook uruchomi ESLint + Prettier na zmienionych plikach (lint-staged).
3. Commit message zgodny z [Conventional Commits](https://www.conventionalcommits.org). Commitlint odrzuci niezgodny format.
4. Otwórz PR przeciw `main`. CI musi przejść (lint, typecheck, vitest, playwright chromium-desktop).

## Conventional Commits

Dozwolone typy:

| Typ        | Kiedy używać                              |
| ---------- | ----------------------------------------- |
| `feat`     | nowa funkcjonalność                       |
| `fix`      | naprawa buga                              |
| `chore`    | utrzymanie repo (deps, narzędzia, konfig) |
| `docs`     | tylko dokumentacja                        |
| `refactor` | refactor bez zmiany zachowania            |
| `test`     | testy bez zmian w produkcyjnym kodzie     |
| `style`    | formatowanie / whitespace                 |
| `perf`     | poprawa wydajności                        |
| `build`    | build system / pakiety                    |
| `ci`       | konfiguracja CI                           |

Zakres opcjonalny:

```
feat(canvas): pinch-to-zoom on touch devices
fix(snap): edge-snap release threshold leaks attachment
docs: update README bootstrap steps
```

## Testy

### Unit / integration (Vitest)

```bash
pnpm test            # watch mode
pnpm test:run        # single run
pnpm test:ui         # interaktywny dashboard
pnpm test:coverage   # raport pokrycia (V8)
```

Pliki: `tests/**/*.{test,spec}.ts`, `src/**/*.{test,spec}.ts`.

**Coverage thresholds** (analiza §4.5/§5.1) — egzekwowane dla `src/lib/**`, `src/shapes/**`, `src/weld-units/**`, `src/store/**`:

- lines 80, functions 80, branches 70, statements 80

Komponenty UI nie mają progu — pokrycie zapewniają testy E2E + visual regression.

### E2E (Playwright)

```bash
pnpm test:e2e                                  # wszystkie projekty
pnpm test:e2e -- --project=chromium-desktop    # tylko desktop Chromium
pnpm test:e2e:ui                               # tryb interaktywny
```

**Projekty CI:**

- `chromium-desktop` — **mandatory** (blokuje merge)
- `chromium-mobile`, `firefox-desktop`, `webkit-desktop` — **informational** (`continue-on-error: true`)

### Visual regression

Snapshoty PNG canvasu są commitowane do repo (analiza §4.5). Po pierwszym uruchomieniu testu lub po świadomej zmianie wizualnej:

```bash
pnpm test:e2e -- --update-snapshots
```

Po update snapshotów dodaj plik snapshotu do commita razem z resztą zmian. Code reviewer weryfikuje, czy zmiana wizualna była intencjonalna.

## Lokalna baza Supabase

```bash
pnpm supabase start    # uruchamia kontener Postgres + Studio + Auth
pnpm supabase stop     # zatrzymuje
pnpm supabase status   # podsumowanie portów + kluczy
```

Migracje: `supabase/migrations/0001_init.sql` itp. Po zmianie schema:

```bash
pnpm supabase db reset   # destruktywny reset + re-apply migracji
```

## i18n

Wszystkie stringi UI w `src/messages/{pl,en}.json`. Brak hardcoded stringów w komponentach.

```tsx
const t = useTranslations('Toolbar');
return <button>{t('addPlate')}</button>;
```

## Code style

- Prettier: 100 znaków, single quotes, no trailing comma, semicolons. Pluginy: `prettier-plugin-tailwindcss` (sortowanie klas).
- ESLint: Next.js core-web-vitals + TypeScript + Prettier.
- TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`.

Pre-commit hook formatuje i lintuje zmienione pliki — wystarczy `git commit`.
