# Verification Report: GET /api/cron/cleanup-webhook-events

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found
No issues found.

- HTTP method matches (`GET`, with explicit warning that `POST` would 405 silently — same wording as `api-plan.md` §2.1 for `expire-subscriptions`).
- URL structure matches (`/api/cron/cleanup-webhook-events`).
- Required header matches (`Authorization: Bearer {CRON_SECRET}`).
- `vercel.json` cron entry (`schedule: "0 2 * * 0"`) matches `api-plan.md` exactly.
- 200 response body shape (`{ deleted: number, timestamp: ISO8601 }`) matches.
- 401 response body shape (`{ error: 'unauthorized' }`) matches.
- DB logic (`DELETE FROM webhook_events WHERE received_at < now() - INTERVAL '90 days'`, executed via `service_role`) matches §2.1 verbatim, with the implementation detail that the cutoff is computed in Node (`Date.now() - 90d`) rather than in SQL — semantically equivalent.

### Warnings
- `api-plan.md` §2.1 lists only **401** in the error code table for this endpoint — it does not formally enumerate **500**. The implementation plan (and the existing handler) returns 500 on PostgrestError, which is correct defensive behavior but technically extends the documented contract. Worth a one-line addition to `api-plan.md` for completeness.

## 2. Consistency with prd.md

### Issues Found
No issues found.

### Warnings
- The PRD does not explicitly mandate webhook retention or a 90-day cleanup. The justification rests on `db-plan.md` §1.6 and the GDPR data-minimization principle (PRD §3.10), which is acceptable — the endpoint is internal infrastructure derived from compliance requirements rather than a user-facing feature, so absence from the PRD is expected. The implementation plan correctly cites `db-plan.md` §1.6 as the source of the retention rule.
- PRD §3.10 mentions Frankfurt EU region and GDPR; the plan correctly inherits Vercel `fra1` pinning from `vercel.json` for colocation with Supabase EU-Frankfurt.

## 3. Internal Consistency

### Issues Found
No issues found.

- Data-flow diagram, error-handling table, and security section all agree: `service_role` is required because `webhook_events` has RLS enabled without any policy.
- Implementation steps (§9) are correctly framed as a **verification checklist** rather than greenfield steps, consistent with the §1 statement that the file already exists (commit `406aae7`). The handler at `src/app/api/cron/cleanup-webhook-events/route.ts` matches every checkbox in Step 1 (GET export, auth-before-DB, `createAdminClient`, `.lt('received_at', cutoffIso)`, `count: 'exact'`, 500 without error leakage, `count ?? 0`, ISO timestamp).
- 401 vs 500 paths in the error table align with the response section and the data-flow diagram.

### Warnings
- §6.1 states the implementation uses `!==` for secret comparison and accepts the timing-attack risk as negligible; §9 Step 4 lists `console.error` and `try/catch` as optional. These are coherent positions but should be flagged for the reviewer so they are explicitly accepted, not silently skipped.
- §7 mentions a "wyjątek niespodziewany" (unexpected exception) row that maps to 500, but the current handler has **no** outer `try/catch`. If `supabase.from(...).delete()` rejects (e.g., DNS/fetch failure to Supabase before PostgREST returns a structured error), the handler will return Next.js's default 500 HTML error page, not the JSON contract `{ error: 'internal_error' }`. The plan acknowledges this in §9 Step 4 as "opcjonalne wzmocnienie" — recommend promoting it to required, or explicitly accept the deviation in the PR review.
- §8.2 notes default function timeout (10 s Hobby / 60 s Pro) and recommends `export const maxDuration = 60` only at scale. For MVP this is fine, but worth confirming the target Vercel plan tier before first production run so the 10 s ceiling does not bite on a cold start with a backlog of deletes.

## 4. Summary
The implementation plan is consistent with `api-plan.md` §2.1, with `db-plan.md` §1.6 (90-day retention), and with the GDPR posture in `prd.md` §3.10 / §3.11. The actual handler at `src/app/api/cron/cleanup-webhook-events/route.ts` matches every contract point in the plan. The only blockers are advisory: (a) `api-plan.md` does not formally list 500 for this endpoint, (b) the lack of an outer `try/catch` means non-PostgREST errors fall through to Next.js's default error page rather than the documented JSON shape, and (c) the optional hardening items (logging, `maxDuration`, `dynamic = 'force-dynamic'`) should be either adopted or explicitly waived in PR review. None of these block merge — the plan is safe to hand off, with the warnings folded into the PR checklist.
