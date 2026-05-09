# API Endpoint Implementation Plan: POST /rest/v1/rpc/effective_plan

## 1. Endpoint Overview

`effective_plan` is a Supabase RPC (PostgREST-exposed `SECURITY DEFINER` SQL function) that returns the **real-time effective plan** (`'free'` or `'pro'`) of a given user, computed directly from `public.subscriptions` rather than from the cached `user_profiles.plan` column.

It is **not** a Next.js Route Handler — there is no `src/app/api/...` file to create. The function already exists in migration `20260507000000_complete_schema.sql` and is invoked from the client (Browser/Server Component, Server Action, or Route Handler) via the Supabase JS SDK:

```typescript
const { data: effectivePlan, error } = await supabase
  .rpc('effective_plan', { uid: userId });
// data: 'pro' | 'free' | null (on error)
```

**Use cases (only):**
- After returning from Paddle Checkout success page (US-045) — the Paddle webhook may not have updated `user_profiles.plan` yet, so the cached value is stale.
- Suspected desync between billing and UI plan badge.

**Standard reads** of plan use `user_profiles.plan` (cache, refreshed by `subscriptions_after_iu_refresh_plan` trigger and the daily `refresh_expired_plans` cron). Calling RPC on every render is forbidden — it bypasses the cache and adds DB load.

The implementation work for this "endpoint" is therefore limited to: (1) verifying the SQL function and supporting index are deployed, (2) providing a typed thin client wrapper in `src/lib/supabase/plan.ts`, (3) wiring the call into the post-checkout flow, and (4) integration tests.

---

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `POST {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/effective_plan` (PostgREST-generated; never constructed manually — always via SDK).
- **Headers (set by SDK automatically):**
  - `apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}`
  - `Authorization: Bearer ${user_jwt}` (cookie-derived in SSR helper, in-memory in browser helper)
  - `Content-Type: application/json`
- **Parameters:**
  - **Required:**
    - `uid` (`UUID`, body) — UUID of the user whose plan is to be computed. The client **must always pass `auth.uid()`** of the currently authenticated user (the SQL function does NOT enforce this — see §6 Security).
  - **Optional:** none.
- **Request Body:**

```json
{ "uid": "<UUID>" }
```

- **Idempotency:** read-only; safe to retry.

---

## 3. Used Types

All types are **already defined** in `src/types/api.ts` and `src/types/database.ts` — no new types are required. The plan implementation only adds a thin wrapper that consumes them.

| Type | File | Purpose |
|---|---|---|
| `UserPlan = 'free' \| 'pro'` | `src/types/api.ts` | Return value (narrowed from raw `string`) |
| `Database['public']['Functions']['effective_plan']` | `src/types/database.ts` (auto-generated, line 213) | `{ Args: { uid: string }; Returns: string }` — typed by `supabase.rpc('effective_plan', ...)` |
| `User` (from `@supabase/supabase-js`) | n/a | Source of `auth.uid()` passed as `uid` |

**No new DTO/Command Models are needed.** The RPC has a single primitive scalar argument and a primitive scalar return — encapsulating it in a DTO would add noise.

**Wrapper signature** (added in `src/lib/supabase/plan.ts`):

```typescript
import type { UserPlan } from '@/types/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export async function fetchEffectivePlan(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserPlan>;
```

---

## 4. Response Details

| Status | Body | When |
|---|---|---|
| `200 OK` | `"pro"` (JSON string) | Subscription exists in `trialing`/`active`/`past_due` OR `canceled` with `current_period_end > now()` |
| `200 OK` | `"free"` | No qualifying subscription |
| `401 Unauthorized` | PostgREST error JSON | No active session (missing/expired JWT). PostgREST returns the standard error envelope; the SDK exposes it as `{ data: null, error: { code, message, ... } }` |
| `500 Internal Server Error` | PostgREST error JSON | DB unreachable, function execution error |

**Important: PostgREST returns 200 with the body `"pro"` or `"free"` — the response is a single JSON-encoded scalar string, not an object.** The SDK unwraps it; `data` is `string | null` and must be narrowed to `UserPlan` by the wrapper (defensive `assertIsUserPlan` — see Implementation Steps §9.4).

The wrapper translates SDK errors into a `BusinessError` so callers can render i18n keys instead of raw PostgREST messages (per architecture-base.md §9 / `mapPostgrestError`).

---

## 5. Data Flow

```
Component / Server Action / Route Handler
        │
        ▼
[ Supabase client wrapper: createClient() (browser or server.ts) ]
        │
        ▼
fetchEffectivePlan(supabase, userId)
        │  POST /rest/v1/rpc/effective_plan  { uid }
        ▼
Supabase Edge / PostgREST
        │
        ▼
public.effective_plan(uid)  -- SECURITY DEFINER, search_path=''
        │
        ▼
public.subscriptions (filtered by user_id, status, current_period_end)
        │  (uses index subscriptions_user_id_status_period_end_idx)
        ▼
TEXT  →  'pro' | 'free'
        │
        ▼
SDK return  →  { data: 'pro' | 'free', error: null }
        │
        ▼
Wrapper narrows to UserPlan, throws BusinessError on error
        │
        ▼
Caller updates UI (e.g. plan badge after Paddle return)
```

**Key data-flow notes:**

- The function reads only from `public.subscriptions`. `user_profiles.plan` is **not** consulted — that is exactly why this RPC exists (cache-bypass).
- `SECURITY DEFINER` runs as the function owner (`postgres`). Combined with `SET search_path = ''`, this prevents search-path injection (architecture invariant).
- Index `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)` makes the lookup an index-only scan in the common case (free tier — no rows; pro user — one row).
- Trigger `subscriptions_after_iu_refresh_plan` (on `subscriptions` INSERT/UPDATE) calls `refresh_user_plan_from_subscriptions(uid)` which itself runs `effective_plan(uid)` server-side and writes `user_profiles.plan`. The same pure function is reused for cache refresh and for the explicit RPC — guarantees consistency.

---

## 6. Security Considerations

1. **Authentication.**
   - The Supabase REST endpoint requires a valid JWT via `Authorization: Bearer ...`. Anonymous calls (only `apikey` header) are rejected with 401 by PostgREST — the function does not have an explicit anon `GRANT EXECUTE`.
   - Required: `GRANT EXECUTE ON FUNCTION public.effective_plan(uuid) TO authenticated;` (verify migration; if missing, add a follow-up migration — see Implementation Steps §9.1).

2. **Authorization gap (documented, accepted for MVP).**
   - `effective_plan(uid)` does **not** check `uid = auth.uid()`. Any authenticated user can pass any UUID and receive that user's plan.
   - **Mitigation in client code:** the `fetchEffectivePlan` wrapper takes `userId: string` but the caller must pass `auth.getUser().data.user.id` — never user-supplied input. Add a JSDoc warning to the wrapper.
   - **Defense-in-depth post-MVP** (out of scope, tracked): add a function guard `IF uid != auth.uid() AND auth.role() != 'service_role' THEN RAISE EXCEPTION` and a new migration. Acceptable now because leaking the binary Pro/Free status of an arbitrary user is not a meaningful data leak (no PII, no business secret).

3. **`SECURITY DEFINER` hardening.**
   - `SET search_path = ''` is set on the function definition — confirm in migration `20260507000000_complete_schema.sql`. Prevents an attacker who can create a same-named relation in their own schema from hijacking the lookup.
   - All references inside the function are schema-qualified (`public.subscriptions`).

4. **Client-side input validation.**
   - The wrapper validates that `userId` is a non-empty string before calling RPC; on browser side it can additionally cross-check against `supabase.auth.getUser()`.
   - The DB itself coerces invalid UUID strings into a `22P02` PostgreSQL error → SDK returns an error → wrapper maps to `BusinessError.InvalidPayload`.

5. **Rate limiting.**
   - No dedicated rate limit. Mitigated by call-site discipline: only post-checkout return page and explicit "refresh plan" UX action.
   - Add a soft client-side throttle in the wrapper (do not call more often than once per 1500 ms per session) to defend against accidental render-loop bugs.

6. **CSRF / cookie hygiene.**
   - SSR cookie-based JWT is delivered via `@supabase/ssr` httpOnly cookies; the SDK adds `Authorization: Bearer ...` from cookies on the server, or from in-memory session in the browser. No additional CSRF token is needed (Supabase RPCs are routed through the public anon endpoint with JWT auth — same as any other PostgREST call).

7. **Logging.**
   - Do **not** log `userId` at info level on the client (PII). Log only `business: BusinessError` and HTTP status.
   - Server-side wrapper calls (e.g. inside `app/(billing)/checkout-return/page.tsx`) may use `console.error` with the mapped `BusinessError` — captured by Vercel runtime logs.

---

## 7. Error Handling

The DB function itself never raises — it returns `'free'` for any UID with no rows (including non-existent users). All error scenarios are at the transport layer.

| Scenario | Trigger | SDK Surface | Wrapper Maps To | UI Action |
|---|---|---|---|---|
| No session / expired JWT | Cookie missing or `auth.refreshSession()` failed | `error.code = 'PGRST301'` or HTTP 401 | `BusinessError.Unauthorized` | Redirect to `/[locale]/sign-in` |
| Invalid UUID format in `uid` | Caller passed non-UUID string | `error.code = '22P02'` | `BusinessError.InvalidPayload` | Caller bug — log + report; render generic error toast |
| Network error / Supabase down | DNS, fetch failure, 5xx from PostgREST | `error.code = 'fetch_error'` or 5xx | `BusinessError.NetworkError` | Toast "spróbuj ponownie", keep stale `user_profiles.plan` |
| Unexpected scalar value (forward-compat) | DB returns something other than `'free'`/`'pro'` | `data = '<other>'` | `BusinessError.UnexpectedResponse` | Treat as `'free'` (safe default), log to Sentry post-MVP |
| `data === null` despite no error | Should never happen | n/a | `BusinessError.UnexpectedResponse` | Fall back to cached `user_profiles.plan` |

**No DB error_log table writes** are needed — `effective_plan` is a read-only SELECT-equivalent function; failures are transient transport issues already captured by Vercel/Supabase logs. (Architecture-base.md §9 reserves persistent error logging for write paths and webhook ingest.)

**Error mapping uses `mapPostgrestError`** from `src/lib/supabase/errors.ts` (still TODO per CLAUDE.md). Until that file lands, the wrapper inlines a minimal mapper and a TODO comment pointing at `api-plan.md` §9 — replace with the shared mapper once `errors.ts` is implemented.

---

## 8. Performance Considerations

1. **Query plan.** With `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)`, the `EXISTS (...)` clause becomes an index range scan limited to the user's rows. P99 latency under 1 ms for a single-row case (verified with `EXPLAIN ANALYZE` during migration review).

2. **Latency budget.** End-to-end (browser → Supabase fra1 → DB → response): ~50–80 ms typical from Vercel `fra1`. Acceptable for the post-checkout success page where the user expects a brief "verifying your subscription..." spinner.

3. **Avoid call-site amplification.**
   - Do **not** invoke from layout/root components or hot paths (canvas, store hooks).
   - Do **not** invoke on every navigation — `user_profiles.plan` is the cache for that.
   - Suggested pattern: a single call in `app/[locale]/(billing)/checkout-return/page.tsx` (Server Component) with up to 3 retries (200 ms / 600 ms / 1800 ms backoff) waiting for webhook propagation; if still `'free'` after 3 retries, fall back to `user_profiles.plan` and surface a "your plan will activate within a minute" notice.

4. **Caching.**
   - **Do not** wrap the result in `unstable_cache` / Next.js fetch cache — by definition this RPC must bypass cache.
   - Browser-side: do **not** memoise across component remounts — every call must hit the DB. Acceptable to memoise for the lifetime of one component instance to prevent double-fire in StrictMode.

5. **Connection reuse.** PostgREST runs over Supabase's PgBouncer pool — one RPC = one short transaction. No cold-connect cost beyond the standard Supabase request.

6. **Index health.** Add an alert (post-MVP) on `pg_stat_user_indexes.idx_scan` for `subscriptions_user_id_status_period_end_idx` — should grow proportionally to checkout returns.

---

## 9. Implementation Steps

1. **Verify DB artefacts are deployed** (no migration changes expected).
   - Confirm `public.effective_plan(uuid)` exists in the live schema: `select pg_get_functiondef('public.effective_plan(uuid)'::regprocedure);`
   - Confirm `subscriptions_user_id_status_period_end_idx` exists: `\d public.subscriptions`
   - Confirm `GRANT EXECUTE ON FUNCTION public.effective_plan(uuid) TO authenticated;` is in migration `20260507000000_complete_schema.sql`. **If missing**, add a new migration `2026XXXXXXXXXX_grant_effective_plan_authenticated.sql` with that single GRANT statement and re-apply.
   - No new migration is needed for the 401-on-no-session behaviour — that is enforced by PostgREST automatically when no `authenticated` JWT is present and only the `authenticated` role has EXECUTE.

2. **Regenerate types if any DB change happened.**
   - `pnpm supabase:types:local` (or `pnpm supabase:types` against remote) → confirm `Database['public']['Functions']['effective_plan']` is `{ Args: { uid: string }; Returns: string }` (already present at `src/types/database.ts:213`).

3. **Create the wrapper** `src/lib/supabase/plan.ts`:
   - Export `fetchEffectivePlan(supabase, userId): Promise<UserPlan>`.
   - Validate `userId` is a non-empty UUID-shaped string (regex match — fail fast before round-trip).
   - Call `supabase.rpc('effective_plan', { uid: userId })`.
   - On `error`: map via `mapPostgrestError(error)` (or inline minimal mapper with TODO referencing `errors.ts`) → throw a typed error or return a discriminated result type — match the convention used by `updateProfile()` once that lands; until then return `Promise<UserPlan>` and throw an `Error` with `cause` containing the `BusinessError`.
   - On `data`: narrow with `assertIsUserPlan(data)` (rejects `null` and unknown strings) → return.
   - Add JSDoc with: (a) "use only post-checkout / desync recovery — not in render hot paths", (b) "always pass `auth.getUser().id`, never user-controlled input — see security-note in `effective-plan-rpc-post-endpoint-data.md`".
   - Co-locate a unit test `src/lib/supabase/plan.test.ts` mocking the SDK (`createMockSupabase`) and asserting: happy path returns `'pro'`/`'free'`; null data → throws; unknown string → throws; SDK error → throws with `cause.business`.

4. **Add an `assertIsUserPlan` type guard** (either in `plan.ts` or in `src/types/api.ts` as a sibling of `UserPlan`):

   ```typescript
   export function assertIsUserPlan(value: unknown): asserts value is UserPlan {
     if (value !== 'free' && value !== 'pro') {
       throw new Error(`Unexpected effective_plan value: ${String(value)}`);
     }
   }
   ```

5. **Wire into post-checkout flow** (US-045 — separate PR if not in scope yet, but document the call-site):
   - In `src/app/[locale]/(billing)/checkout-return/page.tsx` (Server Component, to be created in the Paddle Checkout US):
     - `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();`
     - If no user → redirect to sign-in.
     - `const plan = await fetchEffectivePlan(supabase, user.id);` (with retry logic — §8.3).
     - Pass `plan` to client component for the badge / success message.

6. **Add Vitest integration test** under `src/lib/supabase/plan.test.ts`:
   - Use `vi.mock` to swap the Supabase client with a stub that returns canned `{ data, error }` pairs.
   - Cover all rows of the §7 error table.

7. **Add a Playwright smoke test** (post-checkout US):
   - Stubbed Paddle webhook + checkout redirect → verify the page calls RPC and renders the correct plan badge after the simulated webhook delay.

8. **Documentation hooks.**
   - Add the `fetchEffectivePlan` helper to the "Currently implemented in `src/lib/`" inventory in `CLAUDE.md` once merged.
   - Cross-reference this implementation plan from `.ai/api-plan.md` §2.2 (the "Kiedy używać cache vs RPC" subsection).

9. **Verification checklist before merge.**
   - `pnpm typecheck` clean.
   - `pnpm test:run src/lib/supabase/plan.test.ts` green.
   - Manual: log in, simulate a checkout return with a fake `subscriptions` row → RPC returns `'pro'`; remove row → returns `'free'`.
   - No `supabase.from('user_profiles').select('plan')` was replaced with `fetchEffectivePlan` in non-checkout paths (review diff for accidental over-application — RPC is **not** the standard read path).
