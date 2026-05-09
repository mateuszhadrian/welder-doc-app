# API Endpoint Implementation Plan: GET User Profile (`GET /rest/v1/user_profiles?id=eq.{uid}`)

## 1. Endpoint Overview

This endpoint returns the authenticated user's profile row from `public.user_profiles`. The response carries the cached plan (`free` | `pro`), the authoritative UI locale (`pl` | `en`), the most recently accepted consent version, and the row timestamps. It is **not** a custom Next.js Route Handler — the spec deliberately uses Supabase JS SDK directly against PostgREST, with RLS doing the authorisation. Consumers in WelderDoc are:

1. **Bootstrap after sign-in** — root `[locale]/layout.tsx` (or a `LocaleGuard`) fetches the profile, decides on locale redirect (`pathname locale ≠ user.locale`) and consent re-check (`current_consent_version` vs current TOS/PP).
2. **Plan gating** — `useUserProfile().plan === 'pro'` before feature-gated actions.
3. **Locale guard** — `[locale]/layout.tsx` uses `user_profiles.locale` as the authoritative source.
4. **Consent re-check on every sign-in** — compare `current_consent_version` with the latest TOS/PP version; redirect to `/[locale]/consent-required` when stale.

**Key architectural rules (enforced project-wide):**
- This is a SELECT only. Writes to `user_profiles` go through `updateProfile()` in `src/lib/supabase/profile.ts` (TODO) — never directly via `.update()`.
- Errors must be normalised through `mapPostgrestError()` from `src/lib/supabase/errors.ts` (TODO). No `error?.message.includes(...)` string matching in components.
- The DTO already exists: `UserProfileDto` in `src/types/api.ts` — never invent ad-hoc shapes.

## 2. Request Details

- **HTTP Method:** `GET` (issued automatically by `supabase-js` against PostgREST)
- **URL Structure (PostgREST contract — for reference, not invoked manually):**
  ```
  GET {SUPABASE_URL}/rest/v1/user_profiles
    ?id=eq.{uid}
    &select=id,plan,locale,current_consent_version,created_at,updated_at
  ```
- **Headers** (transparently set by `supabase-js`):
  - `apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}`
  - `Authorization: Bearer <session JWT>` — required for RLS to evaluate `auth.uid()`. On client this is the user's session JWT held by `createBrowserClient`; on server it is the JWT injected by `@supabase/ssr` from the request cookies.
  - `Accept: application/vnd.pgrst.object+json` — added by `.single()` to force the 0/1-row contract.
- **Parameters:**
  - **Required:**
    - `id=eq.{uid}` — the calling user's `auth.uid()`. The caller passes their UUID explicitly (defence-in-depth) but RLS will reject any other UUID.
    - `select=id,plan,locale,current_consent_version,created_at,updated_at` — explicit allowlist; never select `paddle_customer_id` from a session client.
  - **Optional:** none. (`paddle_customer_id` is intentionally excluded from the projection.)
- **Request Body:** none (GET).
- **Idempotency:** safe; cache-friendly per request.

## 3. Used Types

All types already live in `src/types/api.ts` and `src/types/database.ts` — do **not** re-declare them.

```typescript
// From src/types/api.ts
export type UserProfileDto = Pick<
  Tables<'user_profiles'>,
  'id' | 'plan' | 'locale' | 'current_consent_version' | 'created_at' | 'updated_at'
>;

// From src/types/api.ts (literal unions used downstream by store/UI)
export type UserPlan = 'free' | 'pro';
export type AppLocale = 'pl' | 'en';

// From src/lib/supabase/errors.ts (TODO — see Implementation Steps §1)
export enum BusinessError { /* … */ UNAUTHORIZED, UNKNOWN, … }
export interface MappedError {
  business: BusinessError;
  message: string;     // i18n key, e.g. 'errors.unknown'
  rawCode?: string;
  rawMessage?: string;
}
```

The thin service wrapper (Implementation §3) returns a discriminated result:

```typescript
type GetUserProfileResult =
  | { data: UserProfileDto; error: null }
  | { data: null; error: MappedError };
```

## 4. Response Details

### 4.1 200 OK
Body shape (matches `UserProfileDto`):
```json
{
  "id": "uuid-...",
  "plan": "free",
  "locale": "pl",
  "current_consent_version": "1.0",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-05-08T09:00:00Z"
}
```
- `plan` is the **cached** value (refreshed by trigger `subscriptions_after_iu_refresh_plan`). For post-checkout reconciliation, callers must use the RPC `effective_plan(uid)` instead — see `effective-plan-rpc-post-endpoint-data.md`.
- `current_consent_version` may be `null` for a freshly created profile that has not yet POSTed `/api/consent`.

### 4.2 PostgREST status codes (mapped from raw response)
| Status | Cause | Where it bubbles to UI |
|---|---|---|
| 200 | row found | `data` populated |
| 401 | missing/expired JWT (cookies) | `BusinessError.UNAUTHORIZED` → redirect to `/[locale]/sign-in` |
| 406 | `single()` returned 0 rows OR > 1 rows | `BusinessError.UNKNOWN` (logged) — see Error Handling §6 |
| 500 | unreachable DB / Supabase outage | `BusinessError.UNKNOWN` |

### 4.3 Internal application status codes
The wrapper does **not** rewrite PostgREST statuses; it surfaces `MappedError` objects only. Components decide what to render — typically a translated toast plus, for `UNAUTHORIZED`, a navigation side-effect.

## 5. Data Flow

```
React component / Server Component / route layout
        │
        ▼
useUserProfile() hook  ← (client only; SWR/Zustand cache)
        │ or direct call from Server Component
        ▼
getUserProfile(supabase, userId)   ← src/lib/supabase/profile.ts (Implementation §3)
        │
        │ supabase
        │   .from('user_profiles')
        │   .select('id,plan,locale,current_consent_version,created_at,updated_at')
        │   .eq('id', userId)
        │   .single()
        ▼
@supabase/ssr  → Authorization: Bearer <session JWT>
        │
        ▼
PostgREST  →  RLS:  user_profiles_select_authenticated  (id = auth.uid())
        │
        ▼
Postgres  →  pk index (user_profiles_pkey)
        │
        ▼
Row → JSON → mapped to UserProfileDto OR mapPostgrestError(err)
```

**Caller variants:**
1. **Server Component / Route layout** (locale guard, consent re-check): `await createClient()` from `src/lib/supabase/server.ts` (cookie-bound), then call `getUserProfile()`.
2. **Client Component / hook** (plan gating): `createClient()` from `src/lib/supabase/client.ts`. If we adopt SWR/React Query, key on `['user-profile', userId]` and let the cache absorb subsequent reads.
3. **Zustand bootstrap**: `UserSlice` runs `getUserProfile()` once on app shell mount and stores the DTO; downstream selectors (`useUserProfile().plan`, `…locale`) read from the slice with `useShallow` if multiple fields are pulled at once.

**External services:** Supabase Postgres + PostgREST only. No Paddle / Vercel cache / queue interactions. Profile rows are created by the DB trigger `on_auth_user_created` → `handle_new_user()` at `signUp` time, so the lookup is guaranteed to find a row for any authenticated user (any 0-row result indicates an inconsistency — see §6).

## 6. Security Considerations

1. **Authentication:** active Supabase session is mandatory. On the server side, `createClient()` from `src/lib/supabase/server.ts` reads the JWT from cookies (refreshed by `src/proxy.ts` middleware). On the client side, `createBrowserClient` keeps the JWT in localStorage / cookies. A missing/expired JWT triggers PostgREST `401` → mapped to `BusinessError.UNAUTHORIZED`.
2. **Authorisation:** RLS policy `user_profiles_select_authenticated`:
   ```sql
   CREATE POLICY user_profiles_select_authenticated ON public.user_profiles
     FOR SELECT TO authenticated
     USING (id = auth.uid());
   ```
   Even if a malicious caller forges `id=eq.<other-uid>`, RLS returns 0 rows; `.single()` then raises a 406. **Never pass a `userId` from untrusted user input** — always derive it from `supabase.auth.getUser()` or `supabase.auth.getClaims()` server-side.
3. **Column allowlist:** the `select` string deliberately excludes `paddle_customer_id`. Even though the column is owned by the user (RLS would let them read it), it is operational metadata and has no UI use case. Keep the allowlist explicit; never use `select('*')`.
4. **No service-role in this path.** This endpoint never uses `createAdminClient()`. Only the Paddle webhook and crons may bypass RLS.
5. **`updateProfile()` invariant.** This plan covers the SELECT only. All writes flow through the wrapper in `src/lib/supabase/profile.ts` (TODO M3) which strips protected fields. Direct `.update()` on `user_profiles` is forbidden by code review.
6. **Defence-in-depth.** The DB trigger `block_protected_columns_update` blocks writes to `plan`, `paddle_customer_id`, `current_consent_version`. Reads here are unaffected, but the same enforcement mindset applies: do not trust client input for `id`.
7. **No PII leakage in logs.** `MappedError.rawMessage` may include `auth.uid()` fragments; never log `MappedError` to client-side telemetry without redaction.

## 7. Error Handling

| Scenario | PostgREST | Mapped business code | UX |
|---|---|---|---|
| No active session (cookies missing/expired) | `401` | `BusinessError.UNAUTHORIZED` | redirect to `/[locale]/sign-in?next=...`; do not toast |
| Forged `id` (RLS rejects) | `406` (single returned 0 rows) | `BusinessError.UNKNOWN` | dev-only `console.error`; in prod redirect to sign-in (treat as session corruption) |
| Profile genuinely missing (race: signed up but trigger failed — should not happen) | `406` | `BusinessError.UNKNOWN` | toast `errors.unknown`; report to Sentry (post-MVP) |
| Network error / Supabase down | `fetch` rejection or `5xx` | `BusinessError.UNKNOWN` (or `NETWORK_ERROR` if added to `errors.ts`) | toast `errors.network_error`; offline banner |
| Unexpected `PostgrestError` | any | `BusinessError.UNKNOWN` | toast `errors.unknown` |

**Error mapping contract:**
```typescript
import { mapPostgrestError, BusinessError } from '@/lib/supabase/errors';

const { data, error } = await supabase.from('user_profiles')…single();
const mapped = mapPostgrestError(error);

if (mapped?.business === BusinessError.UNAUTHORIZED) {
  router.replace(`/${locale}/sign-in`);
  return;
}
if (mapped) {
  toast.error(t(mapped.message));   // 'errors.unknown' fallback
  return;
}
return data!;
```

**Error logging:**
- No dedicated `errors` table. `webhook_events` is unrelated.
- Dev: `console.error` with `mapped.rawCode` + `mapped.rawMessage`.
- Prod: future Sentry hook (deferred per `init-project-setup-analysis.md` §4).

## 8. Performance Considerations

- **Index:** lookup is by primary key (`user_profiles_pkey`), single-row, sub-millisecond at any realistic scale.
- **No rate limiting** required (cheap PK read, RLS-restricted to one row).
- **Hot path: bootstrap.** Called once per app shell mount + once per consent re-check. Cache aggressively on the client:
  - In `UserSlice` (Zustand) for the lifetime of the session.
  - Optionally an SWR layer keyed on `['user-profile', userId]` if a component tree has parallel readers.
- **Server Component caching:** because the call depends on per-request cookies, do **not** wrap it in `unstable_cache` / `cache()`. Letting Next.js render dynamically is correct and cheap.
- **Avoid request waterfalls.** When a server layout fetches both `auth.getUser()` and the profile, run them sequentially (the second needs the user id). Do not `Promise.all` them — `auth.getUser()` must succeed first.
- **No N+1 risk** — single row, single round-trip.
- **Network egress:** ~6 small fields × ~50 bytes = trivial. No need for `Cache-Control` finesse.

## 9. Implementation Steps

> **Pre-condition for tasks 1 and 3:** `src/lib/supabase/errors.ts` and `src/lib/supabase/profile.ts` are listed in `CLAUDE.md` as "not yet implemented". They must exist before any consumer code starts string-matching errors. Skip the parts already present.

### Step 1 — Implement `src/lib/supabase/errors.ts` (if not yet done)
Create the file with the full `BusinessError` enum, `MappedError` interface, `mapPostgrestError(err)`, and `mapAuthError(err)` per `api-plan.md` §9.1. For this endpoint specifically, ensure the function returns:
- `{ business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }` when the PostgREST error indicates JWT issues (HTTP `401` surfaces in `supabase-js` as `error.code === 'PGRST301'` or `code === '42501'` for missing auth context — handle both).
- `{ business: BusinessError.UNKNOWN, message: 'errors.unknown' }` for everything else, with `rawCode` / `rawMessage` populated for dev logs.
Add unit tests covering at least: null input → null result, 401-shaped error → `UNAUTHORIZED`, generic error → `UNKNOWN`.

### Step 2 — Add the i18n keys
Add to `src/messages/pl.json` and `src/messages/en.json` under `errors.*`:
- `errors.unknown`, `errors.unauthorized`, `errors.network_error`, `errors.profile_locale_invalid` (already required by other endpoints).
- For this endpoint use `errors.unknown` and `errors.unauthorized` only — no profile-specific keys are needed for a read.

### Step 3 — Implement `src/lib/supabase/profile.ts` `getUserProfile()`
Add a thin read helper next to the future `updateProfile()` wrapper. The function must be **client-agnostic** (accept the Supabase client as an argument) so that Server Components, Route Handlers, and Client Components can all reuse it without importing the wrong `createClient`.

```typescript
// src/lib/supabase/profile.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { UserProfileDto } from '@/types/api';
import { mapPostgrestError, BusinessError, type MappedError } from './errors';

const PROFILE_COLUMNS = 'id, plan, locale, current_consent_version, created_at, updated_at' as const;

export type GetUserProfileResult =
  | { data: UserProfileDto; error: null }
  | { data: null; error: MappedError };

export async function getUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<GetUserProfileResult> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
    };
    return { data: null, error: mapped };
  }

  // PostgREST `.single()` guarantees `data` is non-null when `error` is null.
  return { data: data as UserProfileDto, error: null };
}
```

Notes:
- The cast to `UserProfileDto` is safe because the `select` string is an exact match for the `Pick<…>` projection. If you broaden the projection, broaden the DTO too.
- Do **not** call `supabase.auth.getUser()` inside the helper — the caller already has the user id (it had to fetch the user to get to this point) and we want a deterministic single-query helper.

### Step 4 — Add a client hook `useUserProfile()`
For Client Components, expose a Zustand-friendly hook. Two options:
1. **Bootstrap-once Zustand slice** (`src/store/userSlice.ts`): on app shell mount, the slice calls `getUserProfile(createClient(), user.id)` and caches the DTO. Components consume `const plan = useUserProfile((s) => s.plan)`. This matches the project's `Custom hook per slice` convention from CLAUDE.md.
2. **Plain hook** (no Zustand): start with `useEffect` + `useState`. Migrate to SWR/React Query post-MVP if the simple approach causes thrash.

Use option 1 unless something blocks it — the slice is already needed for plan gating.

### Step 5 — Wire the locale-guard / consent-recheck consumer in `src/app/[locale]/layout.tsx`
Server-side flow per `architecture-base.md` §17 and `api-plan.md` §6:

```typescript
// src/app/[locale]/layout.tsx (excerpt)
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserProfile } from '@/lib/supabase/profile';

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <>{children}</>;   // public route handling

  const { data: profile, error } = await getUserProfile(supabase, user.id);
  if (error || !profile) {
    // Treat as session corruption; force re-auth.
    redirect(`/${locale}/sign-in`);
  }

  if (profile.locale !== locale) {
    redirect(`/${profile.locale}${pathnameWithoutLocale(...)}`);
  }
  if (!profile.current_consent_version || profile.current_consent_version < CURRENT_CONSENT_VERSION) {
    redirect(`/${locale}/consent-required`);
  }

  return <>{children}</>;
}
```

### Step 6 — Tests
1. **Unit (Vitest)** — `src/lib/supabase/profile.test.ts`:
   - happy path returns `UserProfileDto`;
   - 406 (no row) returns `MappedError` with `BusinessError.UNKNOWN`;
   - 401 returns `BusinessError.UNAUTHORIZED`.
   Mock the Supabase client with the chainable mock factory pattern (`from().select().eq().single()`).
2. **Integration (optional, post-MVP)** — Playwright auth flow covers sign-in → bootstrap render. Visual regression baseline in `chromium-desktop` already covers the rendered shell.
3. **Coverage gate** — `src/lib/**` requires lines ≥ 80, functions ≥ 80, branches ≥ 70 (per `vitest.config.ts`). The two new files (`errors.ts`, `profile.ts`) must hit those numbers.

### Step 7 — PR-time checklist
- [ ] No component or store calls `supabase.from('user_profiles')` directly — only via `getUserProfile()` / `updateProfile()`.
- [ ] No `error.message.includes('…')` anywhere in `src/`. All consumers use `mapPostgrestError`.
- [ ] `select` allowlist excludes `paddle_customer_id`.
- [ ] Server-side caller awaits `createClient()` from `src/lib/supabase/server.ts` (not the browser client).
- [ ] No `unstable_cache` / `cache()` wrap (per-request cookie dependency).
- [ ] i18n keys present in both `pl.json` and `en.json`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm test:e2e -- --project=chromium-desktop` green.
