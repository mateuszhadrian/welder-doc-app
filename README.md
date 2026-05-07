# WelderDoc

> Browser-based SaaS for creating proportional cross-sections of welded joints and planning weld bead sequences — no CAD knowledge required.

## Table of Contents

- [Description](#description)
- [Tech Stack](#tech-stack)
- [Getting Started Locally](#getting-started-locally)
- [Available Scripts](#available-scripts)
- [Project Scope](#project-scope)
- [Project Status](#project-status)
- [License](#license)

---

## Description

WelderDoc is a browser-based SaaS application built for welding engineers and technologists. It enables users to:

- Draw **proportional cross-sections** of welded joints using a parametric primitive library (plates, pipes, standard profiles)
- Plan **multi-layer weld bead sequences** with automatic layer and bead count suggestions
- **Export** technical documentation as PNG or JPG — without installing any software or knowing CAD tools

The application runs on a **Guest / Free / Pro** subscription model. Guests and Free users can work with up to 3 elements and receive watermarked exports; Pro users get unlimited elements, unlimited cloud projects, and watermark-free exports. Payments are handled through Paddle.

**Target platforms:** Chrome, Edge, Firefox, and Safari on Windows and macOS desktops, with iterative touch support for tablets and mobile devices.

---

## Tech Stack

| Layer                    | Technology                                    | Version              |
| ------------------------ | --------------------------------------------- | -------------------- |
| Runtime                  | Node.js                                       | `22.x`               |
| Package manager          | pnpm                                          | `9.x`                |
| Framework                | Next.js (App Router, Turbopack)               | `^16.2.0`            |
| UI                       | React                                         | `^19.2.0`            |
| Language                 | TypeScript                                    | `^5.7.0`             |
| Styling                  | Tailwind CSS v4                               | `^4.0.0`             |
| Icons                    | Lucide React                                  | `^1.14.0`            |
| State management         | Zustand + Immer                               | `^5.0.0` / `^10.0.0` |
| Canvas engine            | Konva + react-konva (via `@/canvas-kit`)      | `^9.0.0` / `^19.2.3` |
| i18n                     | next-intl (PL / EN)                           | `^4.0.0`             |
| Database & Auth          | Supabase (EU Frankfurt)                       | `^2.45.0`            |
| Payments                 | Paddle Billing                                | `^1.0.0`             |
| Unit / integration tests | Vitest + Testing Library + vitest-canvas-mock | `^4.0.0`             |
| E2E / visual regression  | Playwright                                    | `^1.50.0`            |
| Linting / formatting     | ESLint 9 (flat config) + Prettier             | `^9.0.0` / `^3.3.0`  |
| Hosting                  | Vercel (`fra1` region)                        | —                    |
| CI                       | GitHub Actions                                | —                    |

---

## Getting Started Locally

### Prerequisites

- **Node.js 22.x** — use [nvm](https://github.com/nvm-sh/nvm): `nvm use` (reads `.nvmrc`)
- **pnpm 9.x** — `npm install -g pnpm@9`
- **Docker** — required for the local Supabase stack

### 1. Clone the repository

```bash
git clone https://github.com/<your-org>/welder-doc-app.git
cd welder-doc-app
nvm use
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

| Variable                          | Scope           | Description                              |
| --------------------------------- | --------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client + server | Supabase anon key (RLS enforced)         |
| `SUPABASE_SERVICE_ROLE_KEY`       | **server only** | Used exclusively in Paddle webhook route |
| `PADDLE_WEBHOOK_SECRET`           | server only     | Webhook signature verification           |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | client          | Paddle.js initialisation                 |
| `NEXT_PUBLIC_PADDLE_ENV`          | client          | `sandbox` or `production`                |
| `NEXT_PUBLIC_APP_URL`             | client + server | Public URL of the application            |

### 4. Start local Supabase

```bash
pnpm supabase start   # starts Postgres, Auth, and Studio via Docker
```

To reset the database and re-apply all migrations:

```bash
pnpm supabase db reset
```

### 5. Run the development server

```bash
pnpm dev
```

The app is available at [http://localhost:3000](http://localhost:3000). The dev server uses **Turbopack** for fast HMR.

---

## Available Scripts

| Script                | Description                                       |
| --------------------- | ------------------------------------------------- |
| `pnpm dev`            | Start Next.js dev server with Turbopack           |
| `pnpm build`          | Production build                                  |
| `pnpm start`          | Start production server                           |
| `pnpm lint`           | Run ESLint (flat config)                          |
| `pnpm typecheck`      | TypeScript type check (`tsc --noEmit`)            |
| `pnpm format`         | Format all files with Prettier                    |
| `pnpm format:check`   | Check formatting without writing                  |
| `pnpm test`           | Run Vitest in watch mode                          |
| `pnpm test:run`       | Run Vitest once                                   |
| `pnpm test:ui`        | Open Vitest interactive UI                        |
| `pnpm test:coverage`  | Run Vitest with V8 coverage (thresholds enforced) |
| `pnpm test:e2e`       | Run Playwright E2E tests (auto-starts dev server) |
| `pnpm test:e2e:ui`    | Open Playwright interactive UI                    |
| `pnpm supabase:types` | Regenerate TypeScript types from Supabase schema  |

**Targeted test runs:**

```bash
# Run a single Vitest test file / test name
pnpm test:run path/to/file.test.ts -t "test name"

# Run only the mandatory CI Playwright project
pnpm test:e2e -- --project=chromium-desktop

# Update visual regression baselines
pnpm test:e2e -- --update-snapshots
```

---

## Project Scope

### In MVP scope

- **Canvas:** bounded workspace (default 2970 × 2100 px, user-configurable), auto-center & zoom-to-fit on project open, pan (scroll / hand tool / touch), zoom (Ctrl/Cmd+scroll / pinch), viewport clamped to canvas bounds
- **Cursor modes:** default (arrow — drag to select or move) and Hand (drag to pan)
- **Primitive library:** Flat elements (plate), Hollow sections / tubes (front cross-section as ring, longitudinal cross-section as rectangle with axis), Standard profiles (I, C, L, T)
- **Bevel definitions:** none / single-sided (V/Y) / double-sided (X/K); angle 0°–80°, step 0.5°
- **Adjustment handles** on every edge; rotation handle on selection corner
- **Mirror** (horizontal / vertical) and **z-index management** from the properties panel
- **Multi-select:** selection marquee + Shift+click; auto-treated as a group for all operations
- **Magnetic SNAP:** point-snap (anchor points) + edge-snap with attachment/hysteresis; toggle button + temporary disable key
- **Undo / Redo:** 100 steps, Command Pattern, persisted in localStorage; Ctrl/Cmd+Z / Y / Shift+Z
- **Welding sequence mode:** select predefined weld joint shape → place & adjust with handles → lock to ≥2 elements → convert to multi-layer bead sequence → manage layers and beads ([+] / [−]) → choose bead shape
- **Export:** PNG and JPG (watermark for Guest/Free, none for Pro); optional annotation layer (bead numbering + legend); blocked on empty scene
- **Project management:** cloud save (1 project Free, unlimited Pro), localStorage auto-save for all users, guest-to-cloud migration on sign-in, rename / duplicate / delete
- **Auth:** email + password (+ optional OAuth via Supabase), password reset, protected routes
- **Plans & payments:** Guest / Free / Pro; Paddle Billing (49 PLN/month, 399 PLN/year Pro)
- **UI:** Dark mode and Light mode, PL / EN language switcher, inline validation, toast notifications
- **Legal minimum:** Privacy Policy + Terms pages, cookie consent banner, consent checkbox at registration, Supabase EU-Frankfurt

### Out of MVP scope

- Special / custom shapes, backing elements, user-defined shapes
- DXF, SVG, DWG, PDF export
- Dimensional tolerances and advanced dimensioning tools
- Geometric collision validation
- ISO 2553 / AWS A2.4 compliance validation
- User template library
- Link sharing
- Real-time collaborative editing (architecture is ready; feature is post-MVP)
- Interactive onboarding tutorial
- Full GDPR formalisation (DPA, extended reports)
- Currencies other than PLN
- Advanced analytics

---

## Project Status

**Post-bootstrap, pre-implementation.** Scaffolding, tooling configuration, and all design documents under `.ai/` are in place. Implementation of shapes, store slices, canvas components, and backend integrations is in progress.

Design documents:

- Architecture spec: `.ai/architecture-base.md`
- Product requirements: `.ai/prd.md`
- Tech stack matrix: `.ai/tech-stack.md`

---

## License

License TBD.
