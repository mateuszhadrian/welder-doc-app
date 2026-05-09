# API Endpoint Implementation Plan: GET /api/cron/expire-subscriptions

## 1. Endpoint Overview

Time-based fallback that recalculates `user_profiles.plan` for users whose subscriptions have ended their grace period. Triggered by Vercel Cron daily at `0 3 * * *` UTC. The endpoint is a thin shell around the database function `public.refresh_expired_plans()` (`SECURITY DEFINER`, `SET search_path = ''`), which iterates over `subscriptions` rows with `status = 'canceled' AND current_period_end < now()` and downgrades the corresponding `user_profiles.plan` to `'free'` whenever `effective_plan(uid)` evaluates to `'free'`.

The handler complements the real-time path executed by trigger `subscriptions_after_iu_refresh_plan` after each Paddle webhook; the cron exists so users whose Paddle billing state ages past `current_period_end` without any new webhook activity are still downgraded.

Idempotent by construction — repeated invocations after the first daily run report `updated: 0`. Operationally critical: missing this handler causes Vercel Cron to hit 404 and silently breaks downgrade-after-grace-period (`tech-stack.md` §12 guardrail).

The route handler already exists at `src/app/api/cron/expire-subscriptions/route.ts`. This plan documents the contract and provides hardening / refactoring steps to bring it fully in line with `api-plan.md` §2.1, the typed DTOs in `src/types/api.ts`, and the project conventions in `CLAUDE.md`.

## 2. Request Details

- **HTTP Method:** `GET` (mandatory — Vercel Cron sends `GET` by default; exporting `POST` instead returns 405 Method Not Allowed and the cron silently no-ops).
- **URL Structure:** `/api/cron/expire-subscriptions`
- **Path / Query Parameters:** none.
- **Headers:**
  - **Required:** `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron auto-injects this header from the project env var `CRON_SECRET`.
- **Request Body:** none.
- **Vercel configuration** (`vercel.json` — already present):
  ```json
  {
    "crons": [
      {
        "path": "/api/cron/expire-subscriptions",
        "schedule": "0 3 * * *"
      }
    ]
  }
  ```

## 3. Used Types

All response and error DTOs are already defined in `src/types/api.ts` and must be imported from there — do not redefine inline.

| Symbol | Source | Purpose |
|---|---|---|
| `ExpireSubscriptionsResponseDto` | `src/types/api.ts` | Success response body: `{ updated: number; timestamp: string }` |
| `TypedApiErrorDto<CronApiErrorCode>` | `src/types/api.ts` | Error response body |
| `CronApiErrorCode` | `src/types/api.ts` | `'unauthorized' \| 'internal_error'` — exhaustive error code union for both cron handlers |
| `Database['public']['Functions']['refresh_expired_plans']` | `src/types/database.ts` | Generated RPC signature (`Args: never; Returns: number`) — used implicitly via `supabase.rpc('refresh_expired_plans')` |

No new Command Models are required (no request body).

## 4. Response Details

### 200 OK — success

```json
{
  "updated": 5,
  "timestamp": "2026-05-08T03:00:00Z"
}
```

- `updated` — integer count returned by `refresh_expired_plans()`. Defaults to `0` if the RPC returns `null` (defensive, should not happen in practice).
- `timestamp` — server-side ISO-8601 timestamp captured at response time (`new Date().toISOString()`).

### 401 Unauthorized

```json
{ "error": "unauthorized" }
```

Returned for missing `Authorization` header, malformed header, or mismatched `CRON_SECRET`.

### 500 Internal Server Error

```json
{ "error": "internal_error" }
```

Returned when the RPC call fails or any unexpected error escapes the handler.

> Method Not Allowed (405) is not an explicit branch — Next.js produces it automatically when only `GET` is exported and a different verb is requested.

## 5. Data Flow

```
 Vercel Cron (03:00 UTC)
        │
        │ GET /api/cron/expire-subscriptions
        │ Authorization: Bearer ${CRON_SECRET}
        ▼
 ┌─────────────────────────────────────────────┐
 │ src/app/api/cron/expire-subscriptions/      │
 │   route.ts  →  GET(request: Request)        │
 │                                              │
 │ 1. verifyCronSecret(request)                 │
 │    → 401 on mismatch (timing-safe compare)   │
 │                                              │
 │ 2. createAdminClient()                       │
 │    (service-role; bypasses RLS, no cookies)  │
 │                                              │
 │ 3. supabase.rpc('refresh_expired_plans')     │
 │                                              │
 │ 4. Map result:                               │
 │      error  → 500 internal_error             │
 │      data   → 200 { updated, timestamp }     │
 └────────────────┬────────────────────────────┘
                  │  RPC (HTTPS)
                  ▼
 ┌─────────────────────────────────────────────┐
 │ Supabase Postgres (EU-Frankfurt)             │
 │                                              │
 │ public.refresh_expired_plans()  (SECURITY    │
 │   DEFINER, SET search_path = '')             │
 │                                              │
 │   FOR each subscription row WHERE            │
 │     status = 'canceled' AND                  │
 │     current_period_end < now()               │
 │   IF effective_plan(user_id) = 'free' THEN   │
 │     UPDATE user_profiles SET plan = 'free'   │
 │       WHERE id = user_id;                    │
 │   RETURN count.                               │
 └─────────────────────────────────────────────┘
```

External services touched: Supabase Postgres only. No webhook log row is written for cron runs (rely on Vercel function logs).

## 6. Security Considerations

- **Auth header verification.** The header is the only access control. Use a constant-time comparison (`crypto.timingSafeEqual`) to avoid leaking secret length / prefix via response-time differences. Reject if:
  - header is missing,
  - the value does not start with `Bearer `,
  - the trailing token does not match `process.env.CRON_SECRET` byte-for-byte and length-for-length.
- **Env presence guard.** If `process.env.CRON_SECRET` is unset, fail closed (return 500) rather than accepting any request. Production deploy guardrail: include `CRON_SECRET` in `.env.example` and Vercel project env (`tech-stack.md` §13).
- **Service-role key isolation.** `createAdminClient()` (`src/lib/supabase/server.ts`) reads `SUPABASE_SERVICE_ROLE_KEY` — never expose this in client code. Used here because there is no JWT cookie context for the cron caller and the RPC's grants do not allow the `authenticated` role to invoke it.
- **RLS posture.** `refresh_expired_plans()` is `SECURITY DEFINER` — it runs as `postgres` and intentionally bypasses RLS to update many users' profiles. Do not relax this to `SECURITY INVOKER`.
- **HTTP method lock.** Only export `GET`. Do not export `POST`/`PUT`/`DELETE`. Vercel Cron sends GET; allowing other verbs widens the attack surface.
- **No PII in logs.** Do not log the `updated` value at PII level — counts are safe, but never log user ids on success. Log structured error info on failure (no secrets).
- **Idempotent and replay-safe.** Re-running the cron is a no-op after the first successful run of the day, so an accidental retry storm cannot corrupt data. No idempotency key is needed.
- **No CSRF surface.** Endpoint is invoked server-to-server with a Bearer secret; not callable by browser sessions.

## 7. Error Handling

| Scenario | Detection | HTTP | Response body | Notes |
|---|---|---|---|---|
| Missing/malformed `Authorization` header | `request.headers.get('authorization')` is `null` or does not start with `Bearer ` | 401 | `{ "error": "unauthorized" }` | Same response shape for both subcases — do not differentiate to avoid info leak |
| Wrong secret | Constant-time compare fails | 401 | `{ "error": "unauthorized" }` | Use `crypto.timingSafeEqual` |
| `CRON_SECRET` env not set | `process.env.CRON_SECRET` is `undefined` | 500 | `{ "error": "internal_error" }` | Fail closed; log the misconfig server-side |
| RPC returns `error` (DB unreachable, function missing, etc.) | `error` from `supabase.rpc(...)` is non-null | 500 | `{ "error": "internal_error" }` | Log `error.code`, `error.message`, `error.hint` (no secrets) for ops debugging via Vercel function logs |
| RPC returns `data === null` | `data` is `null` after a non-error response | 200 | `{ "updated": 0, "timestamp": ... }` | Defensive default; not expected from the function definition |
| Unhandled exception | `try/catch` wrapping the RPC | 500 | `{ "error": "internal_error" }` | Last-resort branch; logs `err.stack` |

No persistent error log — `webhook_events` is not used by this handler. Operational visibility comes from Vercel function logs and (later) Sentry.

## 8. Performance Considerations

- **Latency budget:** the endpoint is invoked once a day, so latency is non-critical, but the RPC itself is `O(n)` over `subscriptions` rows with `status = 'canceled' AND current_period_end < now()`. Postgres should use the partial / btree index on `(status, current_period_end)` declared in migration `20260507000000_complete_schema.sql` (verify in `db-plan.md`); without it, full table scans degrade as `subscriptions` grows.
- **Connection lifecycle:** the admin client is created once per invocation (cold start tolerable for daily cron). Do not memoise the client at module scope — Next.js may reuse the function instance across invocations and stale clients would survive secret rotation.
- **Single round-trip:** all work happens inside `refresh_expired_plans()`, so there is exactly one RPC call. Avoid pre-fetching candidate rows from the handler — that would re-implement the function and break encapsulation (`api-plan.md` §2.1 keeps the truth on the DB side so the trigger and cron share logic).
- **Vercel function timeout:** default 10 s on Hobby, 60 s on Pro. Even at 10k expirations this should complete in well under that. If the plan ever scales past that, add a server-side `LIMIT` and re-invoke the cron via a self-trigger.
- **Region affinity:** `vercel.json` pins `regions: ['fra1']`, colocated with Supabase EU-Frankfurt, minimising RPC round-trip latency.

## 9. Implementation Steps

The route file already exists. Steps below describe the work needed to bring it to the documented contract; skip steps already satisfied by the current implementation.

1. **Audit current handler against contract.**
   - File: `src/app/api/cron/expire-subscriptions/route.ts`.
   - Confirm it exports only `GET`, uses `createAdminClient()`, calls `supabase.rpc('refresh_expired_plans')`, and returns `{ updated, timestamp }` on success.

2. **Introduce a typed cron-auth helper** (shared with the sibling `cleanup-webhook-events` handler).
   - Create `src/lib/cron/auth.ts` exporting `verifyCronSecret(request: Request): { ok: true } | { ok: false; reason: 'missing_secret_env' | 'unauthorized' }`.
   - Use `crypto.timingSafeEqual` for the comparison; fall back to `false` on length mismatch (length difference itself is information-poor here because the secret length is fixed).
   - Return `{ ok: false, reason: 'missing_secret_env' }` when `process.env.CRON_SECRET` is undefined so callers can render 500 vs 401 distinctly.

3. **Refactor the handler to use the helper and typed responses.**
   - Import `ExpireSubscriptionsResponseDto`, `TypedApiErrorDto`, `CronApiErrorCode` from `@/types/api`.
   - Annotate the success and error JSON responses with these types via `NextResponse.json<...>(...)` or a small helper to ensure compile-time enforcement of the body shape.
   - Branch on the `verifyCronSecret` result before instantiating the admin client (do not leak existence of misconfigured env to unauthenticated callers — both `unauthorized` and `missing_secret_env` should produce the documented JSON, but with different status codes per Section 7).

4. **Wrap the RPC in a defensive `try/catch`.**
   - Catch any thrown exception (network, JSON parse, etc.) and return `internal_error` 500.
   - Log the error with `console.error('[cron/expire-subscriptions]', { code, message, hint })` — no secrets, no user ids.

5. **Coerce the RPC payload defensively.**
   - `const updated = typeof data === 'number' ? data : 0;`
   - This guards against `data === null` and any unexpected wire shape.

6. **Force dynamic execution.**
   - Add `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'` to the route module. Cron invocations must not be cached or pre-rendered, and the Node runtime is required for `crypto.timingSafeEqual` and the Supabase service-role client.

7. **Update `pnpm verify:routes`** (script `scripts/verify-routes.sh`) only if it currently fails to detect the existing handler — the cron path → file mapping check should already pass, but rerun once after refactor.

8. **Unit tests** (`src/app/api/cron/expire-subscriptions/route.test.ts`).
   - Mock `createAdminClient` to return a stub whose `rpc('refresh_expired_plans')` resolves to `{ data: 7, error: null }`. Assert 200 + body `{ updated: 7, timestamp: <ISO> }`.
   - Test 401 paths: missing header, wrong scheme (`Token foo`), wrong secret. Assert body `{ error: 'unauthorized' }`.
   - Test 500 paths: RPC returns `{ data: null, error: { message: 'boom' } }` → body `{ error: 'internal_error' }`; thrown exception inside the handler → same.
   - Test env misconfig: `delete process.env.CRON_SECRET` → 500 `internal_error`. Restore env in `afterEach`.
   - Coverage target: `src/lib/**` plus the route — must keep `src/lib/**` thresholds (lines 80, branches 70) green per `vitest.config.ts`.

9. **Manual smoke test** (local).
   - `pnpm supabase start` then `pnpm dev`.
   - `curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-subscriptions` → 200 with `updated: 0`.
   - Repeat without header → 401; with wrong secret → 401.
   - Insert a fake `canceled` subscription with `current_period_end < now()` (in Supabase Studio), retry → 200 with `updated >= 1` and `user_profiles.plan` flipped to `'free'`.

10. **Production verification (post-deploy).**
    - In Vercel dashboard, confirm the cron is registered (Cron Jobs tab) and the next run time matches `0 3 * * *` UTC.
    - After the first scheduled run, check function logs for the JSON line and confirm `updated >= 0`.
    - Confirm `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are set in the Production environment in Vercel.

11. **Documentation.**
    - No README changes required — `CLAUDE.md` already lists this handler under "Route Handlers implemented".
    - If the handler is renamed or moved, update `vercel.json crons[].path` and run `pnpm verify:routes`.
