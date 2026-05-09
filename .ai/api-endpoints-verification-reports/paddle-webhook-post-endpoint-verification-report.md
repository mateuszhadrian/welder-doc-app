# Verification Report: POST /api/paddle/webhook

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
- **Processing order — marker vs dispatch.** `api-plan.md` §2.1 ("Logika przetwarzania") prescribes the order: (1) verify signature, (2) `INSERT INTO webhook_events ON CONFLICT DO NOTHING RETURNING id`, (3) duplicate short-circuit on empty `RETURNING`, (4) dispatch by `event_type`. The implementation plan inverts this and explicitly mandates "dispatch-before-marker" (§5 step diagram and §7 "Dispatch before marker ordering rationale"): dispatch first, then upsert `webhook_events` with `ignoreDuplicates: true`, then return `duplicate: true` if the upsert returned an empty array. The implementation plan's reasoning (avoid silently dropping a state change when dispatch fails after marker has been written) is technically defensible, but the ordering directly contradicts the canonical API plan and is a behaviorally meaningful divergence (it changes how partial failures interact with Paddle's retries). Either api-plan.md must be updated to reflect the dispatch-before-marker invariant, or the implementation plan must follow api-plan.md's order.

### Warnings
- The implementation plan claims `ignoreDuplicates: true` + `.select('id')` is the idempotency mechanism; api-plan.md describes it as `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. Functionally equivalent, but the plan should note these are the same primitive expressed via supabase-js helpers.
- The plan adds 500-class error sub-cases ("webhook secret not configured", "<db error>") that are not enumerated in api-plan.md (which only lists a generic `500 internal_error`). This is a strict superset and not a contradiction, but reviewers should confirm the additional `message` payloads are acceptable for a public webhook endpoint (Paddle log noise vs. forensic value).

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- US-045 acceptance criterion "Po udanej płatności plan użytkownika jest zaktualizowany do Pro" is satisfied indirectly via the DB triggers `subscriptions_after_iu_refresh_plan` and `subscriptions_after_iu_sync_customer`, which the plan correctly references but does not include in the "Implementation Steps" verification list (only mentioned in §5 "Database interactions per branch"). Step 13 confirms migrations are applied — that is sufficient, but the PR review checklist (§9 step 17) could explicitly call out that `user_profiles.plan` flipping to `'pro'` is a trigger-driven side effect, not a handler write, so reviewers do not look for an explicit `plan` UPDATE in the route.
- PRD §3.1 lists the supported plan tiers as Pro Monthly (49 PLN) and Pro Annual (399 PLN). The plan correctly maps these to `pro_monthly` / `pro_annual` via `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY` / `..._PRO_ANNUAL`. No issue, but the plan's §7 warning — "watch for `rawPriceId` warnings — they indicate a new plan was added in Paddle without updating env vars" — should ideally be tracked alongside any future PRD update introducing a new tier.

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- §5 ("Data Flow") narrative diagram lists step 7 as "upsert webhook_events ON CONFLICT DO NOTHING ... empty array → duplicate → 200 {duplicate:true}". Step 6 of the same diagram ("dispatch by event_type") runs before step 7. This is internally consistent with §7's "dispatch-before-marker" rationale, but is the source of the contradiction with api-plan.md flagged above. Reviewers should treat the implementation plan's ordering as the source of truth only after api-plan.md is reconciled.
- §7 error table lists "Empty inserted array → `NextResponse.json({ received: true, duplicate: true })`" as the duplicate-detection branch. §9 step 8.11 repeats this. Both are aligned. However, the table in §4 ("Response Details — orphan or unsupported event") implies orphan responses are `{ received: true }` (no `duplicate` flag). The implementation plan should clarify that the `duplicate` flag is set strictly by the marker-upsert outcome and never by orphan/unsupported branches — currently inferable but not stated.
- §9 step 9 says "Any missing → `console.warn(...)` and **return** without DB write. Marker still gets written upstream." — this is correct given the §7 dispatch-before-marker order, but the function contract is implicit. The plan should make explicit that `handleSubscriptionEvent` and `handleCustomerEvent` MUST NOT throw on missing/incomplete data (a thrown error would short-circuit the marker write, leading to permanent retries from Paddle for malformed events).
- §3 ("Used Types") mentions `Tables<'subscriptions'>` / `TablesInsert<'subscriptions'>` are referenced "when typing `upsertRow` (avoid passing extra fields beyond `Insert`)", but §9 (implementation steps) does not require explicit type-annotation of `row`. This is a minor doc-vs-code-review gap; consider adding an explicit type annotation to step 9.

## 4. Summary
The implementation plan is comprehensive, security-aware, and aligned with the PRD's US-045 upgrade flow. The single material concern is the ordering of marker insertion versus business dispatch: the plan's "dispatch-before-marker" approach is defensible and well-reasoned in §7, but it directly contradicts the order documented in `api-plan.md` §2.1. Before this plan is handed off to development, the project must reconcile the two documents — either update `api-plan.md` to match the dispatch-before-marker invariant (recommended, given the implementation plan's failure-mode analysis), or revise the implementation plan to follow api-plan.md's marker-first order. All other findings are stylistic or clarification-grade and do not block implementation.
