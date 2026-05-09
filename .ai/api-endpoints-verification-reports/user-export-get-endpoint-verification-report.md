# Verification Report: GET /api/user/export

## Overall Status

PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found

No issues found.

### Warnings

- The plan adds `schema_version` to the `documents` SELECT (§9.B.3, Appendix), while the response body example in api-plan.md §2.1 (and mirrored in §4 of the implementation plan) does **not** show this field. This is justified — `DocumentDto` in `src/types/api.ts` already includes `schema_version` — but the api-plan.md sample body should be updated for full alignment, or the discrepancy should be acknowledged in the plan's §4 example to avoid review confusion.
- The error response code set is correctly limited to `'unauthorized' | 'internal_error'` (matching `UserExportApiErrorCode`). The plan correctly notes that adding `'rate_limited'` will require widening this enum in `src/types/api.ts` when post-MVP rate limiting lands (§9.D).
- `Content-Disposition` filename pattern `welderdoc-export-${YYYY-MM-DD}.json` matches api-plan.md verbatim. The plan correctly clarifies the date is server-derived (defense against client-controlled filenames). No issue.
- Performance soft-target (<30 s) and rate-limit targets (1/min/user, 5/day/user) match api-plan.md §2.1 (m8) and §6.2 exactly.
- The plan correctly references the §1.1 / §6.2 requirement that `auth.getUser()` is the first action because `src/proxy.ts` excludes `/api/*` from middleware-driven JWT refresh.

## 2. Consistency with prd.md

### Issues Found

No issues found.

### Warnings

- PRD §3.10 ("Zgodność prawna — GDPR minimum przed launch") enumerates: Privacy Policy, Terms of Service, cookie consent banner, registration consent checkbox, EU-Frankfurt region, and RODO **art. 17** (account deletion). It does **not** explicitly mention **RODO art. 20** (data portability), which is the legal basis cited throughout the implementation plan. There is no corresponding user story in PRD §5 either (US-041–US-049 cover image export of welds, not personal-data export).
- This is a PRD-side gap, not an implementation-plan defect. The endpoint is a sound interpretation of "GDPR minimum" but the PRD should be updated either to add RODO art. 20 to §3.10 or to add an explicit user story (e.g., "As a user, I want to download all my data in a structured JSON format"), so the obligation is traceable to a written requirement.
- All other PRD touchpoints align: EU-Frankfurt region (PRD §3.10) matches Vercel `fra1` colocation noted in §8; consent log presence (PRD §3.10 / US-051) is consumed correctly; Free plan limit of 1 project / Pro unlimited (PRD §3.1) is compatible with the `documents.order('created_at', asc)` pagination plan.

## 3. Internal Consistency

### Issues Found

No issues found.

### Warnings

- §3 lists `DocumentDto` (which includes `schema_version`) as the canonical type for documents, while §9.A.4 verification step states the SELECT list is `'id, name, created_at, updated_at, data'` and only at §9.B.3 does the plan resolve to "Option A — add `schema_version` to SELECT". A reviewer reading §9.A linearly may flag this as a contradiction before reaching §9.B.3. Recommend updating §9.A.4 to show the final chosen column list (matching the Appendix), with a forward reference to §9.B.3 for the rationale.
- §4 example body shows `email` as a non-empty string and the Appendix uses `user.email ?? ''` defensively. Supabase `auth.users.email` is mandatory for password sign-up, so `''` should never occur in practice — but the contract type `UserExportDto.email` is currently `string` (not `string | null`). The `?? ''` fallback is reasonable defensive code; document the rationale (or use a non-null assertion with a comment) to avoid ambiguity over whether the empty-string case is contractually valid.
- §9.B.4 prescribes `data as unknown as CanvasDocument`. This is correct given PostgREST returns `Json` and we have no runtime schema validator (and per UE art. 20, structured JSON suffices). No defect; just confirming the trade-off is explicit.
- §9.D (rate-limit task) and §6 (security) consistently defer the rate limiter to post-MVP. The plan correctly notes that adding `'rate_limited'` to `UserExportApiErrorCode` in `src/types/api.ts` is part of that future task — keeping current MVP shape stable. Internally consistent.
- §7 logging guidance ("Zero PII — nie logować user.email") and §6 confidentiality match. The Appendix logging calls use only `user_id` (UUID) — consistent.
- The plan acknowledges current implementation status (`src/app/api/user/export/route.ts` already implemented per CLAUDE.md) and `mapPostgrestError` not yet existing — this matches the CLAUDE.md "Currently implemented" / "Not yet implemented" state, so the migration path (§9.C) is realistic.

## 4. Summary

The implementation plan is well-aligned with `api-plan.md` (HTTP contract, payload shape, headers, error codes, performance targets, and rate-limit deferral). The only PRD-level gap is that RODO art. 20 (data portability) is not explicitly enumerated in PRD §3.10 nor backed by a user story — the endpoint is implemented on the strength of broader "GDPR minimum" framing and should be retroactively documented in the PRD for traceability. Internal consistency is strong; minor wording cleanups (column-list convergence between §9.A.4 and §9.B.3 / Appendix, `email` fallback rationale, and example body update for `schema_version`) are recommended before final hand-off but are non-blocking. The plan is safe to hand to the development team, with the PRD sync flagged as a separate documentation task.
