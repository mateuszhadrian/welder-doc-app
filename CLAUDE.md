# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

WelderDoc is a browser SaaS for drawing proportional cross-sections of welded joints and weld bead sequences. The repo is in **post-bootstrap, pre-implementation** state: scaffolding, configs, and `.ai/` design docs are in place, but most files under `src/` (shapes, store slices, components, libs) are empty placeholders. Use `.ai/architecture-base.md` as the authoritative implementation spec — it defines types, slices, state machines, and SNAP algorithms in full. PRD: `.ai/prd.md`. Tech stack matrix: `.ai/tech-stack.md`. UI strings are Polish; in-code identifiers and comments are mixed PL/EN.

## Commands

Node `22.x` + pnpm `9.x` are required (`engines` enforces this). Use `nvm use` then `pnpm install`.

```bash
pnpm dev                      # Next.js dev (Turbopack)
pnpm build                    # production build
pnpm lint                     # ESLint (flat config)
pnpm typecheck                # tsc --noEmit
pnpm format                   # Prettier write
pnpm test                     # Vitest watch
pnpm test:run                 # Vitest single run
pnpm test:coverage            # Vitest + V8 coverage (thresholds enforced — see below)
pnpm test:e2e                 # Playwright (auto-starts dev server via webServer config)
pnpm test:e2e -- --project=chromium-desktop          # only the mandatory CI project
pnpm test:e2e -- --update-snapshots                  # accept new visual baselines
pnpm supabase start           # local Postgres + Auth + Studio (requires Docker)
pnpm supabase db reset        # destructive: re-apply migrations from supabase/migrations/
```

Run a single Vitest test: `pnpm test:run path/to/file.test.ts -t "test name"`.
Run a single Playwright test: `pnpm test:e2e e2e/path.spec.ts -g "test name"`.

## Architecture invariants

These are non-obvious rules from `.ai/architecture-base.md` that infrastructure code is built around. Violating them breaks the registry-driven model.

- **Shape Registry is the only extension point.** `SHAPE_REGISTRY` (`src/shapes/registry.ts`) maps `ShapeType → ShapeDefinition<S>`. Store, handles, sidebar, SNAP, and export consume only the `ShapeDefinition` interface. Adding a new shape touches **exactly four files**: `src/shapes/[type]/`, `src/shapes/index.ts` (union), `src/shapes/registry.ts` (entry), `src/store/types.ts` (`AllShapeGeometry`). Anything else means infrastructure is leaking into shape-specific code.
- **Z-index = array order in `shapes[]`.** No layer system; reorder = pure array reorder.
- **WeldUnit is a rigid movement unit** with three states (`locked` | `sequence` | `detached`) and a checksum-gated dormant-sequence restore. State machine and history mapping are in `architecture-base.md` §7 — read it before touching `WeldUnitsSlice` or `bead-sequence.ts`. In `locked`/`sequence`, weld-joint params and member-element params are read-only.
- **Transient vs committed updates:** `updateShapeTransient` runs during live drag/edit and skips history + localStorage. `commitShapeUpdate` writes the diff entry to `history[]` and triggers persist. Never push history from a transient path.
- **`FieldUpdate` (loose) at the registry boundary, `ShapeUpdate` (strict, intersection-derived) inside the store.** This split exists to break the `shapes/` ↔ `store/` import cycle — keep it.
- **Pointer Events only in canvas code.** No `mouse*` / `touch*` / `gesturestart`. `setPointerCapture` on every drag start. Pinch-zoom = tracking two `pointerId`s in `CanvasApp.tsx`.
- **History `groupId`** ties a shape-remove to its cascading `removeUnit` so one Ctrl+Z restores both atomically. Required when removing a `weld-joint` or any element in a unit's `elementIds`.
- **SNAP has two coexisting modes** (`architecture-base.md` §10): point-snap (stateless, threshold 8 px, `weld-joint` mode + alignment) and edge-snap with attachment (stateful in `UISlice.attachment`, attach 8 px / release 16 px hysteresis, parallel-only). Both share the `snapEnabled` toggle and `Alt` temporary disable. `snapEngine.ts` exports pure functions — keep them Konva- and store-free for unit testing.

## Project-specific configuration quirks

- **Konva needs the `canvas` alias** to `./empty.js` in `next.config.ts` (already wired). All `react-konva` users must be `'use client'`; the canvas root is loaded with `next/dynamic({ ssr: false })`.
- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains `next-intl` middleware and is the place to add Supabase `updateSession()` (currently stubbed).
- **i18n routing uses `localePrefix: 'as-needed'` with `localeDetection: false`** and a `[locale]` segment in `src/app/[locale]/`. Default locale is `pl`. Every `page.tsx`/`layout.tsx` must call `setRequestLocale(locale)` before any `next-intl` hook, and `generateStaticParams()` must return both locales.
- **Zero hardcoded UI strings.** All copy lives in `src/messages/{pl,en}.json` and is read via `useTranslations(...)`.
- **Coverage thresholds are enforced** for `src/lib/**`, `src/shapes/**`, `src/weld-units/**`, `src/store/**`: lines 80, functions 80, branches 70, statements 80 (`vitest.config.ts`). UI components are intentionally excluded — they are covered by Playwright + visual regression instead.
- **Vitest uses `jsdom` + `vitest-canvas-mock`** (registered in `vitest.setup.ts`); `tsconfig.json` includes `vitest/jsdom` types.
- **Playwright `chromium-desktop` is the only mandatory CI project**; `chromium-mobile`, `firefox-desktop`, `webkit-desktop` are informational. Visual-regression PNGs are committed — if you intentionally change canvas output, run with `--update-snapshots` and commit the new baselines.
- **Vercel region is pinned to `fra1`** (`vercel.json`) to colocate with the Supabase EU-Frankfurt instance required by GDPR.
- **TypeScript runs with `strict` + `noUncheckedIndexedAccess`.** Array/record indexing returns `T | undefined`; handle it.
- **Path alias:** `@/*` → `src/*`.

## Workflow guardrails (enforced by hooks)

- Pre-commit (`.husky/pre-commit` → lint-staged): runs `eslint --fix` + `prettier --write` on staged TS/JS, and `prettier --write` on JSON/MD/CSS/YAML. Don't bypass with `--no-verify`.
- Commit-msg (`.husky/commit-msg` → commitlint): Conventional Commits required. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`. Optional scope, e.g. `feat(canvas): pinch-to-zoom`.
- Branch off `main`; PRs must pass lint, typecheck, Vitest, and Playwright `chromium-desktop`.

## What is intentionally deferred

Per `.ai/init-project-setup-analysis.md` §4: cloud Vercel/Supabase/Paddle hookup, production domain, branding (palette, fonts, logo, favicon), Sentry, LICENSE, branch protection, Lighthouse CI, and `experimental.reactCompiler`. Don't add these without a corresponding task — they are tracked.
