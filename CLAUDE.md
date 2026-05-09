# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

WelderDoc is a browser SaaS for drawing proportional cross-sections of welded joints and weld bead sequences. The repo is in **post-bootstrap, pre-implementation** state: scaffolding, configs, and `.ai/` design docs are in place, but most files under `src/` (shapes, store slices, components, libs) are empty placeholders. Use `.ai/architecture-base.md` as the authoritative implementation spec — it defines types, slices, state machines, and SNAP algorithms in full. PRD: `.ai/prd.md`. Tech stack matrix: `.ai/tech-stack.md`. UI strings are Polish; in-code identifiers and comments are mixed PL/EN.

**Currently implemented in `src/lib/`:** `snapEngine.ts` (stub with pure-function signatures + constants); `supabase/{client,server,middleware}.ts` (the three Supabase client variants per `tech-stack.md` §7); `ipAnonymize.ts` (RODO IPv4 `/24` + IPv6 `/48` — used by `/api/consent`, co-located unit test). **Not yet implemented:** `supabase/errors.ts` (`BusinessError` enum + `mapPostgrestError`/`mapAuthError` — full stub in `api-plan.md` §9); `supabase/profile.ts` (`updateProfile()` wrapper — full stub in `api-plan.md` §2.2); `documentCodec.ts`; `exportEngine.ts`; `overlapDetector.ts`. Architecture §3 also lists `captureGeometry.ts` and `shapeBounds.ts` — these are thin registry-reexport proxies (not standalone helpers): `captureGeometry.ts` re-exports `SHAPE_REGISTRY[type].captureGeometry` for the store; `shapeBounds.ts` re-exports `SHAPE_REGISTRY[type].getBoundingBox` for SNAP, exportEngine, and multi-select — created when the first shape is registered.

**Route Handlers implemented** (`api-plan.md` §2.1):

- `src/app/api/health/route.ts`
- `src/app/api/consent/route.ts` (uses RPC `record_consent_bundle`)
- `src/app/api/user/export/route.ts`
- `src/app/api/paddle/webhook/route.ts` (HMAC verify, idempotent upsert, dispatch-before-marker)
- `src/app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts`

**Route Handler NOT YET implemented:**

- `src/app/api/user/account/route.ts` (DELETE — RODO art. 17; re-auth + hard delete via `auth.admin.deleteUser`) — **TODO**

Four Supabase migrations are applied: `20260507000000_complete_schema.sql`, `20260508000000_record_consent_bundle.sql`, `20260509000000_paddle_webhook_hardening.sql`, `20260510000000_fix_consent_version_comment.sql` (reissues `COMMENT ON COLUMN user_profiles.current_consent_version` so `pg_description` reflects the actual write source — `/api/consent` route handler on a session client + RPC `record_consent_bundle()` running as `postgres`, not `service_role`). Domain layer (shapes, weld-units, store slices, canvas components) is not yet implemented.

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
pnpm supabase:types           # regenerate types from REMOTE Supabase (needs SUPABASE_PROJECT_ID in .env.local)
pnpm supabase:types:local     # regenerate types from LOCAL stack (run after `supabase db reset`)
pnpm verify:routes            # check vercel.json crons[].path + Paddle/consent/export handlers exist
```

Run a single Vitest test: `pnpm test:run path/to/file.test.ts -t "test name"`.
Run a single Playwright test: `pnpm test:e2e e2e/path.spec.ts -g "test name"`.

## Architecture invariants

These are non-obvious rules from `.ai/architecture-base.md` that infrastructure code is built around. Violating them breaks the registry-driven model.

- **`@/canvas-kit` is the only path to the rendering engine.** Shape `Renderer`s, `exportEngine`, weld-unit overlays, and anything else outside `src/canvas-kit/impl-*` and `src/components/canvas/` MUST import primitives (`G`, `Rect`, `Line`, `Arc`, `Circle`, `Path`, `Text`), `CanvasShell`/`GroupLayer`/`OverlayLayer`, `rasterize`, `usePointerInput`, and `HIT_AREA_*` / `devicePixelRatio` from `@/canvas-kit` — never from `konva` / `react-konva` / `pixi.js` / `@pixi/*`. ESLint (`no-restricted-imports`) blocks direct engine imports outside the two whitelisted zones; do not bypass. Engine-specific APIs (`stage.toDataURL`, `node.cache()`, `Konva.Animation`, `e.evt.touches[]`, `Konva.Node` refs) are forbidden in shape/store/lib code — add a primitive prop to `src/canvas-kit/primitives.ts` instead, then implement it in `impl-konva/`. Boundary spec: `architecture-base.md` §22; migration playbook: `.ai/canvas-kit-migration-plan.md`. Goal: swapping Konva → PixiJS is a new `impl-pixi/` plus three re-export lines in `src/canvas-kit/index.ts`, not a project-wide refactor.
- **Shape Registry is the only extension point.** `SHAPE_REGISTRY` (`src/shapes/registry.ts`) maps `ShapeType → ShapeDefinition<S>`. Store, handles, sidebar, SNAP, and export consume only the `ShapeDefinition` interface. Adding a new shape touches **exactly four files**: `src/shapes/[type]/`, `src/shapes/index.ts` (union), `src/shapes/registry.ts` (entry), `src/store/types.ts` (`AllShapeGeometry`). Anything else means infrastructure is leaking into shape-specific code.
- **Z-index = array order in `shapes[]`.** No layer system; reorder = pure array reorder.
- **WeldUnit is a rigid movement unit** with three states (`locked` | `sequence` | `detached`) and a checksum-gated dormant-sequence restore. State machine and history mapping are in `architecture-base.md` §7 — read it before touching `WeldUnitsSlice` or `bead-sequence.ts`. In `locked`/`sequence`, weld-joint params and member-element params are read-only.
- **Transient vs committed updates:** `updateShapeTransient` runs during live drag/edit and skips history + localStorage. `commitShapeUpdate` writes the diff entry to `history[]` and triggers persist. Never push history from a transient path.
- **`FieldUpdate` (loose) at the registry boundary, `ShapeUpdate` (strict, intersection-derived) inside the store.** This split exists to break the `shapes/` ↔ `store/` import cycle — keep it.
- **Pointer Events only, multi-touch only via `usePointerInput`.** No `mouse*` / `touch*` / `gesturestart` / `e.evt.touches[]`. Pinch/pan/drag/tap normalization lives in `src/canvas-kit/pointerInput.ts` and works on raw DOM `PointerEvent` (engine-agnostic). `setPointerCapture` is called by the hook on each pointer down; canvas components consume the emitted `PointerGesture` instead of wiring their own multi-touch logic. `window.devicePixelRatio` is read **only** inside `src/canvas-kit/` (`CanvasShell` + `constants.ts`).
- **History `groupId`** ties a shape-remove to its cascading `removeUnit` so one Ctrl+Z restores both atomically. Required when removing a `weld-joint` or any element in a unit's `elementIds`.
- **SNAP has two coexisting modes** (`architecture-base.md` §10): point-snap (stateless, threshold 8 px, `weld-joint` mode + alignment) and edge-snap with attachment (stateful in `UISlice.attachment`, attach 8 px / release 16 px hysteresis, parallel-only). Both share the `snapEnabled` toggle and `Alt` temporary disable. `snapEngine.ts` exports pure functions — keep them Konva- and store-free for unit testing.
- **`updateProfile()` is the only allowed path to update `user_profiles`.** Never call `supabase.from('user_profiles').update(...)` directly from components — always use `src/lib/supabase/profile.ts#updateProfile()`. It strips protected columns (`plan`, `paddle_customer_id`, `current_consent_version`) before the PATCH, and TypeScript enforces `SafeUpdate`. The DB trigger `block_protected_columns_update` is defense-in-depth, not the primary guard.
- **Error handling uses `BusinessError` enum + mappers, never raw string checks.** `src/lib/supabase/errors.ts` exports `mapPostgrestError(err)` and `mapAuthError(err)` — use them to get a typed `{ business: BusinessError, message: string (i18n key) }`. No component uses `error?.message.includes('...')` directly. Stub with full enum in `api-plan.md` §9.
- **`WeldJointShape` has no `_geometryChecksum` field** — the field was explicitly removed. `computeWeldJointChecksum(s: WeldJointShape): string` is a pure function in `src/weld-units/bead-sequence.ts` that computes the checksum on-the-fly from `joinType`, `leg1`, `leg2`, `angle`, `rootGap`, `depth`, `diameter`. It is stored in `WeldUnit.sequenceJointChecksum`, not in the shape itself.

## Zustand store conventions

- **`useShallow` przy selektorach obiektowych.** Gdy komponent subskrybuje więcej niż jedno pole store'a naraz (np. `const { shapes, selection } = useCanvasStore(...)`), opakuj selektor w `useShallow` z `zustand/shallow`. Bez tego Zustand porównuje referencje zwróconego obiektu, a każda niezwiązana zmiana store'a re-renderuje komponent.
- **`devtools` middleware tylko w dev.** Store powinien być owiknięty w `devtools()` z `zustand/middleware` warunkowo: `process.env.NODE_ENV !== 'production'`. Umożliwia inspekcję stanu i time-travel w Redux DevTools podczas implementacji slice'ów; zero kosztu w produkcji.
- **Custom hook per slice.** Każdy slice eksportuje własny hook (`useShapesSlice`, `useHistorySlice`, `useUISlice` itd.) zamiast eksponować `useCanvasStore` bezpośrednio w komponentach. Enkapsuluje logikę selektora i ułatwia mockowanie w testach jednostkowych slice'ów.

## Project-specific configuration quirks

- **Konva needs the `canvas` alias** to `./empty.js` in `next.config.ts` (already wired). This is impl-konva-specific; it gets removed when `impl-pixi/` ships. All `react-konva` users live inside `src/canvas-kit/impl-konva/` (and must be `'use client'`); the canvas root in `src/components/canvas/` is loaded with `next/dynamic({ ssr: false })`.
- **Middleware file is `src/proxy.ts`, not `middleware.ts`** (Next 16 convention used here). It exports `proxy` and `config`; chains Supabase `updateSession()` (`src/lib/supabase/middleware.ts`) → `next-intl` middleware. The chain is mandatory: Supabase must refresh the JWT cookies before next-intl decides on locale rewrite/redirect, and any locale-rewrite response must propagate the `Set-Cookie` headers from the Supabase response. The matcher excludes `/api/*` (Route Handlers refresh sessions on first `auth.getUser()` call inside the handler).
- **i18n routing uses `localePrefix: 'as-needed'` with `localeDetection: false`** and a `[locale]` segment in `src/app/[locale]/`. Default locale is `pl` — it has **no URL prefix** (served at `/`); `en` is at `/en/`. `localeDetection: false` is intentional — avoids surprising redirects from `/` to `/en/` on first visit from an English browser. Every `page.tsx`/`layout.tsx` must call `setRequestLocale(locale)` before any `next-intl` hook, and `generateStaticParams()` must return both locales.
- **Zero hardcoded UI strings.** All copy lives in `src/messages/{pl,en}.json` and is read via `useTranslations(...)`.
- **Coverage thresholds are enforced** for `src/lib/**`, `src/shapes/**`, `src/weld-units/**`, `src/store/**`: lines 80, functions 80, branches 70, statements 80 (`vitest.config.ts`). UI components are intentionally excluded — they are covered by Playwright + visual regression instead.
- **Vitest uses `jsdom` + `vitest-canvas-mock`** (registered in `vitest.setup.ts`). `tsconfig.json` deliberately omits `compilerOptions.types` to keep `@types/node`/`@types/react` auto-loaded; vitest globals come from `globals: true` in `vitest.config.ts`.
- **Playwright `chromium-desktop` is the only mandatory CI project**; `chromium-mobile`, `firefox-desktop`, `webkit-desktop` are informational. Visual-regression PNGs are committed — if you intentionally change canvas output, run with `--update-snapshots` and commit the new baselines.
- **Vercel region is pinned to `fra1`** (`vercel.json`) to colocate with the Supabase EU-Frankfurt instance required by GDPR.
- **TypeScript runs with `strict` + `noUncheckedIndexedAccess`.** Array/record indexing returns `T | undefined`; handle it.
- **Path alias:** `@/*` → `src/*`.

## Workflow guardrails (enforced by hooks)

- Pre-commit (`.husky/pre-commit` → lint-staged): runs `eslint --fix` + `prettier --write` on staged TS/JS, and `prettier --write` on JSON/MD/CSS/YAML. Don't bypass with `--no-verify`.
- Commit-msg (`.husky/commit-msg` → commitlint): Conventional Commits required. Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`. Optional scope, e.g. `feat(canvas): pinch-to-zoom`.
- Branch off `main`; PRs must pass lint, typecheck, Vitest, and Playwright `chromium-desktop`.
- PR review checklist for canvas-touching changes: (1) no new file outside `src/canvas-kit/impl-*` and `src/components/canvas/` imports `konva` / `react-konva`; (2) every shape `Renderer` uses **only** primitives from `@/canvas-kit`; (3) any new touch/pen gesture is added to `src/canvas-kit/pointerInput.ts`, not to the component; (4) `exportEngine` calls `rasterize()` from `@/canvas-kit`, never `stage.toDataURL` directly. A failure here means a future engine swap stops being a local change.
- PR checklist for Route Handlers (pre-merge to `main`):
  - **Cron:** if `vercel.json crons[]` is non-empty, every path must have a matching `src/app/api/<path>/route.ts` exporting `GET` (not POST — Vercel Cron sends GET by default) with `Authorization: Bearer ${CRON_SECRET}` header verification.
  - **Paddle webhook:** if the app uses Paddle Checkout (`@paddle/paddle-js`), `src/app/api/paddle/webhook/route.ts` must exist, export `POST`, and verify `paddle-signature` via `PADDLE_WEBHOOK_SECRET` before processing. Without it, `subscription.activated` events drop and US-045 upgrade silently fails.
  - **Consent:** if the registration form is wired up, `src/app/api/consent/route.ts` must exist, export `POST`, accept the bundle payload (`types[]`) per `api-plan.md` §2.1, and anonymise the IP via `src/lib/ipAnonymize.ts` before any INSERT to `consent_log`.
  - **User export (RODO art. 20):** `src/app/api/user/export/route.ts` must exist before any production deploy that touches `documents`/`consent_log`. Required for compliance, not just feature parity.
- PR checklist for auth implementation (US-002 sign-in):
  - **Locale redirect after sign-in.** Per `architecture-base.md` §17, after `setRequestLocale(locale)` the root `[locale]/layout.tsx` (or a dedicated `LocaleGuard`) must call `auth.getUser()`, fetch `user_profiles.locale`, and `redirect()` to `/<user.locale>/...` when `pathname locale ≠ user.locale`. Without this guard, signing in on a device with a different URL prefix leaves the user on the wrong locale until manual switch (cross-device UX desync).
  - **Consent re-check on every sign-in.** After loading the session, fetch `user_profiles.current_consent_version`. If `NULL` or older than current TOS/PP version → redirect to `/[locale]/consent-required` before letting the user reach the canvas. `POST /api/consent` (bundle) updates the version; the protected trigger prevents direct UPDATE from `authenticated` role.
- PR checklist for Paddle Checkout implementation (US-045):
  - **`customData: { user_id }` is mandatory** in every `Paddle.Checkout.open({...})` call. Without it the first `subscription.created` webhook falls through the 3-step user lookup and may log as an orphan if `customer.email` doesn't match `auth.users`. This is NOT verified by code — PR reviewer must check manually (`architecture-base.md` §16).
- **localStorage autosave keys** (important for `DocumentSlice` + migration logic): primary key `'welderdoc_autosave'` stores `{ schemaVersion, scene: CanvasDocument, history: HistoryEntry[], historyIndex, savedAt: ISO }`. Migration sentinel key `'welderdoc_migrated_at'` written before clearing autosave on guest→cloud migration. On `QuotaExceededError`: trim history to 50 entries and retry; on second failure show toast recommending cloud save (`architecture-base.md` §13).

## What is intentionally deferred

Per `.ai/init-project-setup-analysis.md` §4: cloud Vercel/Supabase/Paddle hookup, production domain, branding (palette, brand-specific fonts beyond the current `Inter` placeholder loaded via `next/font/google` in `src/app/[locale]/layout.tsx`, logo, favicon), Sentry, LICENSE, branch protection, Lighthouse CI, and `experimental.reactCompiler`. Don't add these without a corresponding task — they are tracked.
