# Verification Report: List Subscriptions (GET)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- **`order=created_at.desc` not natively covered by the documented index.** The implementation plan acknowledges this in §8 (Performance), but `api-plan.md` §2.2 (Subskrypcje) and §6 (RLS) reference `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)`. The plan's mitigation steps (extra index vs. switch ordering) are sound, but should be flagged to the reviewer so the chosen mitigation lands in the same PR if the team prefers an exact-match index from day one.
- **PostgREST 401 specifics.** The plan classifies `error.code === 'PGRST301'` as a 401 and prescribes a single forced `refreshSession()` retry. `api-plan.md` §3 mentions JWT refresh exclusively in the context of `auth.getUser()` inside Route Handlers; client-side single-retry semantics for SDK calls are not codified in `api-plan.md`. Behavior is correct, but reviewers should confirm the retry policy is intentional and uniform with other SDK callers.
- **Empty array semantics for free-tier users.** `api-plan.md` does not explicitly state the empty-array contract. The implementation plan adds it (UI must treat `[]` as "no subscription yet"); aligned with the model but worth promoting into the API plan eventually.

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- **US-044 covers viewing plans, not viewing subscription history.** PRD US-044 acceptance criteria are about presenting the plan tiers (limits, prices). The implementation plan attaches itself to a "Settings → Billing" page that displays subscription history and a Customer Portal CTA — this is consistent with `api-plan.md` §2.2 (which routes the GET specifically to US-044) but goes beyond the literal acceptance criteria of the PRD story. No conflict, but the PR description should make the cross-mapping explicit so reviewers do not look for the plans table content here.
- **US-045 polling backoff.** PRD US-045 only requires that "after a successful payment, the user's plan is updated to Pro" without specifying client polling. The implementation plan's 1s/2s/4s backoff is reasonable and matches `api-plan.md` §2.2 hints, but the timeout fallback ("Płatność jest przetwarzana") should be aligned with i18n keys covered by US-045 acceptance.
- **No PRD mention of the Customer Portal.** The Customer Portal CTA is an `api-plan.md` §2.2 concept; PRD does not describe self-service cancel/manage flows. Implementation plan correctly limits its responsibility to gating logic, but if PRD coverage is required for compliance/launch readiness, that gap should be raised separately (it is an API plan vs. PRD gap, not an implementation plan defect).

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- **`mapPostgrestError` is unimplemented.** §3 (Used Types) references `MappedError`; §7 (Error Handling) routes everything through `mapPostgrestError`; §9 step 1 states the helper must "pass any returned `error` through `mapPostgrestError(err)` (when `errors.ts` lands; until then return `{ business: 'unknown', message: 'errors.unknown', rawCode, rawMessage }` inline and refactor in the same PR that creates `errors.ts`)". This dependency is captured but creates a sequencing risk: if `errors.ts` is not delivered first, the helper ships with an inline fallback that must be remembered for refactor. Recommend either (a) blocking this endpoint on `errors.ts` landing, or (b) creating an explicit follow-up task.
- **`AnySupabaseClient` typedef precedence.** §3 declares `AnySupabaseClient` as a union of `ReturnType<typeof createClient (browser)>` and `Awaited<ReturnType<typeof createClient (server)>>`. The browser `createClient` is synchronous and the server one is async. The union is correct, but unit tests in step 2 mock the SDK directly — make sure the mocked client structurally matches both shapes so the test does not silently pass with only the server-shape signature.
- **Column whitelist deviates slightly between sections.** §2 says "Default in code: `id,status,plan_tier,current_period_start,current_period_end,cancel_at,created_at`" while §5 (Data Flow) writes the same list with extra whitespace. The unit test in §9 step 2 must assert against the exact string passed to `.select(...)` — confirm that the test fixture matches the actual implementation literally (including comma/space style) to avoid brittle assertions.
- **Coverage thresholds.** §9 step 2 references `vitest.config.ts` thresholds for `src/lib/**`. The unit-test plan covers happy path, missing session, empty array, and PostgREST error mapping — sufficient for lines/branches 80/70 in a small helper, but the "second 401 redirect" branch from §7 is not enumerated in the test list. Consider adding it explicitly or document why it is covered at the consumer layer.
- **Dependency on `effective_plan()` RPC.** §5 and §8 mention pairing this read with `effective_plan()` RPC for plan resolution and post-checkout polling. Make sure that RPC's verification (separate endpoint) lands consistently — otherwise the polling flow in step 4 cannot be implemented even if this helper is complete.
- **Documentation step (§9 step 6) is not load-bearing for correctness** but creates a soft dependency on a CLAUDE.md edit. If the docs update is forgotten, the next session will not know `subscriptions.ts` exists. Consider promoting it to a checklist item rather than a numbered step or coupling it with PR template enforcement.

## 4. Summary
The implementation plan is faithful to `api-plan.md` §2.2 (Subskrypcje): same HTTP method, URL pattern, column whitelist, ordering, RLS reliance, and absence of a custom Route Handler. It also captures the PRD US-044/US-045 dependencies and the Customer Portal SDK gating logic. The plan is safe to hand off, with two soft preconditions to track: (1) `src/lib/supabase/errors.ts` should ideally land first (or in the same PR) so the temporary inline error mapping does not leak, and (2) the `effective_plan()` RPC verification must land in lockstep so the post-checkout polling flow has both reads available. None of the warnings are blocking.
