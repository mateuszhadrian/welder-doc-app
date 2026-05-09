# Verification Report: GET /rest/v1/documents (List Documents)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found
No issues found.

### Warnings
- The implementation plan §7 lists a 401 error path "only emitted by the consuming Route Handler / page guard, not by PostgREST (RLS swallows)". This is consistent with api-plan §3 (RLS) but the source data spec (`list-documents-get-endpoint-data.md` "Error Codes") explicitly mentions "401 — brak sesji". The two are reconcilable (page-level guard → 401, PostgREST itself → 200 + `[]`), but the plan should make the source of the 401 unambiguous to avoid implementers checking for HTTP 401 from PostgREST.
- The plan adds a `sort` parameter union (`'updated_at_desc' | 'name_asc' | 'created_at_desc'`) that is not explicitly enumerated in api-plan §2.2, although api-plan only shows `updated_at.desc`. The data spec mentions all three orderings. This is an additive UX-friendly mapping, not a contradiction, but worth a note that the option is plan-introduced.
- Implementation plan §3 references `MappedError` / `BusinessError` from `src/lib/supabase/errors.ts` and notes "TODO — to be added by the global errors task". Per CLAUDE.md, `errors.ts` is currently NOT implemented. The plan correctly flags this as a prerequisite in Step 1, but the dependency must be tracked at the task level so this endpoint isn't merged before `errors.ts` lands.
- Performance section mentions "switch to `count: 'estimated'` or `count: 'planned'`" if list sizes ever grow >1000 per user. api-plan §10 already defers Vercel Runtime Cache and the workload assumption is "free user = 1 doc, pro user ~50", so this is a forward-looking note — fine, but the plan could explicitly state that for MVP `count: 'exact'` is the chosen mode.

## 2. Consistency with prd.md

### Issues Found
No issues found.

### Warnings
- US-010 acceptance criterion mentions "Lista projektów wyświetla nazwę i datę ostatniej modyfikacji". The plan returns `id, name, created_at, updated_at` which covers it. Implicit but worth confirming in the Server Component step (§9 step 4) that the rendered list explicitly shows `updated_at` (not `created_at`) as the displayed timestamp — otherwise US-010 would technically not be satisfied.
- US-008 mentions a Free-plan limit of 1 project enforced via the `check_free_project_limit` trigger; that limit is enforced on INSERT, not in the list endpoint. The implementation plan correctly does not handle this here, but the dashboard consumer (Step 4) should be aware that a project counter (using `total` from this endpoint) is the natural place to surface the limit indicator in the UI. Not a contradiction — just an integration nuance.
- PRD does not require a sort selector beyond "data ostatniej modyfikacji". The plan exposes three sort options. This is a permissible UX enhancement not mandated by PRD; reviewer should confirm with product before exposing all three in MVP.

## 3. Internal Consistency

### Issues Found
No issues found.

### Warnings
- §4 "Error responses" describes PostgREST returning JSON like `{ "code": "PGRSTxxx", ... }`, while §9 (api-plan) `mapPostgrestError` matches on Postgres SQLSTATE codes (`P0001`, `23514`, `23502`). For this read-only list endpoint neither family of codes will typically fire (no triggers, no CHECK constraints invoked on SELECT), so the helper will almost always fall through to `BusinessError.UNKNOWN`. The plan should explicitly state that this endpoint primarily produces transport/network errors and `UNKNOWN` is the expected business mapping for SELECT-time failures — to avoid implementers writing speculative tests for `P0001` here.
- §7 "Error Handling" table lists `RangeError` thrown from the helper guard for invalid `limit`/`offset`, while the section header maps the same case to HTTP 400. Since the helper is a plain TS function (not a Route Handler), there is no HTTP layer that can return 400 — the consumer must catch the `RangeError`. The plan reconciles this in the prose ("Caught by helper guard, never reaches PostgREST") but the table column "Status" is potentially misleading for SDK-only consumers — clarify that the 400 column applies only when wrapped by an upstream Route Handler.
- §9 Step 2 says: "Throw `RangeError` if NaN/negative — this is a developer error", but Step 7 also says "`pnpm test:coverage` meets thresholds for `src/lib/**`" (lines 80, branches 70). The branch test cases listed in Step 3 do exercise the throw paths, so the coverage target is reachable — no internal contradiction, just confirm the test file genuinely hits all branches in `SORT_MAP` (3 entries → 3 sort branches).
- §6 says "Use `createClient()` from `src/lib/supabase/server.ts` (NOT `createAdminClient()`)" but `src/lib/supabase/server.ts` per CLAUDE.md does not currently expose a `createAdminClient` — that function lives elsewhere (or is not implemented). Naming is fine as a guard rule, but the plan should reference the actual admin client location so reviewers can spot a misuse.
- §9 Step 4 references the route `src/app/[locale]/(app)/dashboard/page.tsx` "or whichever route hosts the project list — confirm against the routing plan". The exact path is not yet decided in the architecture docs. This is acknowledged but should be resolved before implementation begins.

## 4. Summary
The implementation plan is fundamentally consistent with both api-plan.md (§2.2 SDK operations, §3 RLS, §9 error mapping) and the PRD user stories US-008/US-010, and internal sections (data flow, security, error handling, steps) reinforce each other. The plan correctly identifies the RLS-only authorization model, prohibits selecting `data`, and structures the helper as a pure TS function injectable into both server and client contexts. No blocking discrepancies were found, but several clarifications are recommended before development: (1) explicitly state that `errors.ts` is a hard prerequisite and confirm its delivery sequencing; (2) reconcile the 401/400 status-code language with the fact that this is an SDK-only call (no HTTP layer the helper can return from); (3) confirm the dashboard route path with the routing plan; (4) note that for SELECT-only operations `mapPostgrestError` will almost always return `UNKNOWN`, so test scope should reflect that. Safe to hand off to development with these warnings noted.
