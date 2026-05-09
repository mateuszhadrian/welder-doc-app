# Verification Report: GET /api/cron/expire-subscriptions

## Overall Status
PASSED

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- api-plan.md §13 ("Weryfikacja CRON_SECRET") shows a non-constant-time string comparison (`authHeader !== \`Bearer ${process.env.CRON_SECRET}\``). The implementation plan strengthens this to `crypto.timingSafeEqual`. This is a hardening improvement, not a contradiction, but if the example in api-plan.md is treated as canonical by other readers it may be worth annotating that the plan intentionally diverges to a constant-time path.
- api-plan.md does not explicitly cover the "`CRON_SECRET` env is missing" case. The implementation plan defines this as a 500 `internal_error` (fail closed). This is sensible additional defense; consider noting the policy in api-plan.md to keep the two `crons[]` handlers symmetric.

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- The PRD does not explicitly describe a daily cron job for subscription expiration; the cron is the operational implementation that backs the Free/Pro plan model (US-045 → US-047) and the trigger-based downgrade path. This is appropriate (PRD is product-level, not infra-level), but worth noting that cron behavior cannot be acceptance-tested directly against PRD criteria — verification falls to db-plan.md and api-plan.md instead.

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- Section 8 references a partial / btree index on `subscriptions(status, current_period_end)` declared in migration `20260507000000_complete_schema.sql` and notes "verify in `db-plan.md`". The plan does not block on the verification — if the index is in fact missing the daily cron will degrade as the table grows. Worth turning the soft "verify" note into an explicit acceptance check before sign-off.
- Section 9 step 8 (unit tests) calls for restoring `process.env.CRON_SECRET` in `afterEach`. Best practice is also to snapshot the original value once in `beforeAll` and restore in `afterAll` to defend against early `delete` short-circuiting one of the assertions. Minor robustness nit, not a blocker.
- Section 6 states "do not log the `updated` value at PII level — counts are safe, but never log user ids on success." The phrasing is slightly internally redundant (the count is not PII to begin with); intent is clear from context but the sentence could be tightened to "log `updated` count only; never log user ids."

## 4. Summary
The implementation plan for `GET /api/cron/expire-subscriptions` is fully consistent with both `api-plan.md` §2.1 and the PRD's Free/Pro subscription model. The HTTP method, URL, auth, request/response contracts, schedule, and error codes all line up with the canonical API plan, and the plan correctly leans on the `SECURITY DEFINER` RPC `public.refresh_expired_plans()` so cron and webhook trigger share downgrade logic. Internal sections (Data Flow, Security, Error Handling, Implementation Steps) cross-reference cleanly, including defensive null-coercion of the RPC payload and a fail-closed branch for missing `CRON_SECRET`. The plan is safe to hand off to the development team; the listed warnings are minor documentation/process hygiene items, not implementation blockers.
