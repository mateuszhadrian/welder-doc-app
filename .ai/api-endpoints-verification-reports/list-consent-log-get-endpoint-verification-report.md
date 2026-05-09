# Verification Report: GET /rest/v1/consent_log (List Consent Log)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
- **`BusinessError` value casing diverges from the canonical enum in §9.1.** The implementation plan (§7 error table and §4 response details) returns `business: 'unauthorized'` and `business: 'internal_error'`. `api-plan.md` §9.1 defines `BusinessError` as a TypeScript `enum` whose **member identifiers** are upper-snake (`UNAUTHORIZED`, `UNKNOWN`, `RATE_LIMITED`, `NETWORK_ERROR`) and whose **values** are lower-snake. There is, however, **no `BusinessError.INTERNAL_ERROR` member** in the enum at all — the closest existing member is `UNKNOWN = 'unknown'`. The plan therefore references a `BusinessError` variant that does not exist in the contract. Fix: either pick `BusinessError.UNKNOWN` for "DB unavailable / 5xx" (current spec) or extend §9.1 of `api-plan.md` to add `INTERNAL_ERROR = 'internal_error'` as part of this work, and reflect that addition in the implementation plan and `errors.ts`. Pick one and make the §9.1 enum and the §7 mapping table line up.
- **Service helper signature drops the `userId` parameter that the api-plan canonical SDK call uses.** `api-plan.md` §2.2 (Dziennik zgód, lines 944–956) shows the canonical query as:
  ```typescript
  await supabase.from('consent_log')
    .select('consent_type, version, accepted, accepted_at')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })
  ```
  The implementation plan §9 step 2 explicitly tells implementers **not** to call `.eq('user_id', userId)` (RLS handles it; "do not add … forcing a `userId` argument introduces a footgun"). The reasoning is sound (RLS already filters), but the implementation plan §2 still advertises `user_id=eq.{uid}` as the request URL with the rationale "kept for query-plan determinism (uses the `consent_log_user_id_type_accepted_at_idx` index)". This is internally inconsistent: §2 says the predicate is sent for index determinism, §9 step 2 says do not send it. Decide explicitly which form ships and align both sections — including whether the helper signature is `listConsentLog(supabase)` (current §9) or `listConsentLog(supabase, userId)` (matches §2 + api-plan canonical SDK form). Note: dropping `.eq('user_id', …)` does NOT cost the index; Postgres still uses `consent_log_user_id_type_accepted_at_idx` to satisfy `ORDER BY accepted_at DESC` filtered by the RLS predicate `user_id = auth.uid()`, so the §9 form is correct on the merits — just update §2 to match.

### Warnings
- **`PGRST116` interpretation in §7 row 2.** The plan describes RLS rejection as `error.code === 'PGRST116'` ("zero rows in single-row context — N/A here since we expect array"). PGRST116 is in fact emitted by `.single()` / `.maybeSingle()` only; on an array `.select()` an RLS rejection simply returns `data: []` with no error. Worth removing the `PGRST116` reference entirely from the array-fetch path to avoid confusing future implementers — replace with "RLS yields empty array, treat as success".
- **`PGRST301` is the AuthN-failure code, not a generic 401 marker.** The plan correctly maps `PGRST301` to `unauthorized`, but should clarify that other 401s (e.g. JWT expired with `PGRST302`) follow the same path. Either widen the rule to `error.status === 401` (already noted as the OR branch) or list all PGRST3xx auth codes.
- **`mapPostgrestError` is documented in §3 as a hard dependency yet the §9 step 1 says "if not, ship the service first".** This is a small contradiction with `CLAUDE.md`, which lists `src/lib/supabase/errors.ts` as a known TODO. Concretely: the helper file is meant to be the **first** consumer of typed errors; the plan should pick whether (a) `errors.ts` is a hard prerequisite (block this task on it) or (b) the helper ships with a temporary inline mapper that is later refactored. Currently §3 picks (a) and §9 step 1 hedges with (b).
- **§3 `ListConsentLogResult` is "recommended" but §9 step 2 makes it mandatory.** Tighten the wording — either commit to the discriminated union or downgrade the helper to throw on error and let callers handle it. Mixed wording confuses reviewers.
- **§7 says errors are "logged at the service layer via `console.error`".** Project conventions (per `CLAUDE.md`) prefer mapped errors at the boundary and Sentry once it lands; check whether unconditional `console.error` in `src/lib/supabase/` will trip ESLint `no-console` (the project may have it enabled in lint config — confirm before merge).
- **§2 promises "request body: none (GET)" but does not call out that the SDK will, in practice, also send `Accept: application/json` and `Prefer: count=exact` only when `.select(..., { count: ... })` is used.** Minor — but if a future test asserts on outgoing headers, the spec should declare which `Prefer` value is acceptable (none is required here).

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- **PRD does not enumerate a "consent history view" user story.** US-051 (the only consent-related story, lines 1071–1080) covers the cookie banner and the registration checkbox; the broader RODO art. 7 §1 audit trail this endpoint backs is implicit in §3.10 ("Checkbox zgody przy rejestracji z zapisem wersji zgody") and §3.10 art. 17 cascade delete. The implementation plan correctly identifies the two real consumers (privacy settings page + `GET /api/user/export`) — neither has a dedicated PRD user story, but both are required by §3.10 ("GDPR minimum") and by the RODO art. 20 export obligation. Worth adding a one-line cross-reference to PRD §3.10 in §1 of the implementation plan so reviewers see the regulatory basis explicitly.
- **Privacy settings page is described as "when implemented".** The PRD does not have a story for a consent history UI either; this is fine for MVP, but the implementation plan should note that the only blocking consumer for MVP launch is `/api/user/export` (RODO art. 20). The privacy settings page can ship later without blocking compliance.

## 3. Internal Consistency
### Issues Found
- **§2 vs §9 step 2 contradict each other on whether to send `.eq('user_id', userId)`.** Already called out in §1. Pick one and update both sections.
- **§3 says the helper signature is `listConsentLog(supabase, userId?)` (the §5 data-flow box also shows `listConsentLog(supabase, userId?)`), but §9 step 2 declares the signature as `listConsentLog(supabase: SupabaseClient<Database>)` with no `userId` parameter and the explicit instruction "Do not add `.eq('user_id', userId)`".** The two forms are mutually exclusive. Reconcile in one place.

### Warnings
- **§4 maps "PostgREST returns 401 … surfaced as `error.code === 'PGRST301'` or `status === 401`" while §7 row 1 only shows the `PGRST301` value.** Make the table reflect both branches or merge into one condition (`status === 401`).
- **§7 mentions `Sentry.captureException` "(when Sentry lands)" while CLAUDE.md §"What is intentionally deferred" lists Sentry as deferred.** Fine as a future hook, but flag this as a `// TODO(sentry)` comment in the helper rather than a prose-only note so it surfaces in lint/grep when Sentry lands.
- **§9 step 4 unit test list mocks `vi.mock('@supabase/supabase-js')` and stubs the fluent chain.** This is a heavy mock; the project already uses jsdom + `vitest-canvas-mock` and prefers a thin builder fake (see how `consent` POST handler is tested). Recommend referencing the existing fluent-chain stub helper if one exists, otherwise budget a small shared test util.
- **§9 step 7 (Hand-off checklist) lists "no direct `supabase.from('consent_log').select(...)` calls remain outside the helper (grep before merge)".** The existing `POST /api/consent` route handler under `src/app/api/consent/route.ts` does NOT read `consent_log` (it only inserts via RPC), so this grep should pass today. Worth confirming once the helper lands — and adding the grep to `pnpm verify:routes` (or a lightweight `scripts/check-consent-log-isolation.ts`) so the rule survives future PRs.
- **§9 step 4 case 5 ("projection sanity") asserts the exact string `'consent_type, version, accepted, accepted_at'`.** Lock the order in the test — `Pick<>` does not preserve declaration order in TypeScript reflection, so order changes silently break the assertion. Fine, just document why the order is fixed (matches the api-plan canonical SDK call in §2.2).
- **`ConsentLogItemDto` is already exported from `src/types/api.ts`** (verified at lines 115–119). The implementation plan correctly states this — no action needed, but worth tightening §3's wording from "already present" to "verified at `src/types/api.ts:116`" so a reviewer can grep instantly.

## 4. Summary
The implementation plan is broadly aligned with `api-plan.md` and `prd.md` and is technically sound — the security model (RLS-only, no service_role), projection-based PII minimization, and append-only invariant all match the contract. There are however three concrete blockers worth fixing before hand-off: (1) the `BusinessError.INTERNAL_ERROR` value referenced in §4 / §7 does not exist in the canonical enum in `api-plan.md` §9.1 and must either be added there or replaced with `UNKNOWN`; (2) the helper signature contradicts itself between §2/§5 (which take `userId`) and §9 step 2 (which forbids it) — pick one form and propagate it everywhere; (3) the §7 PGRST116 branch is dead code on an array fetch and should be removed. Once those three points are reconciled, the plan is safe to hand off — the warnings are polish, not blockers.
