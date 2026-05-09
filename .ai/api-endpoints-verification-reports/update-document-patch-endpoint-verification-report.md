# Verification Report: PATCH /rest/v1/documents?id=eq.{id} (Update Document)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- The implementation plan maps `PGRST116` to `BusinessError.UNAUTHORIZED` in both §4.2 (response table) and §7 (error handling), but the canonical `mapPostgrestError` stub in `api-plan.md` §9.1 does not yet contain a `PGRST116` branch — its current code falls through to `BusinessError.UNKNOWN`. The implementation plan should explicitly note that it extends the stub with a new branch (`if (err.code === 'PGRST116') return { business: UNAUTHORIZED, message: 'errors.unauthorized' }`) and add the corresponding unit test in step §9.1's test list. Otherwise the runtime behaviour will not match the documented mapping.
- The implementation plan lists `owner_id` as an allowed PATCH body field for "transfer (post-MVP)". `api-plan.md` §687-734 only illustrates `name` and `data` for the PATCH; it never discusses `owner_id` as a permitted update target on this endpoint. RLS WITH CHECK still blocks foreign-owner moves, so it is not a security gap — but mentioning a post-MVP capability inside an MVP implementation plan blurs scope. Consider deferring the `owner_id` row to the post-MVP backlog.
- §5.3 example computes the size of the merged blob with `JSON.stringify(merged).length`. §6 already warns that JS string length and Postgres `octet_length(data::text)` can diverge, but the example does not echo that caveat. Consider replacing `.length` with a `Blob([JSON.stringify(merged)]).size` or explicitly comment that the DB CHECK is the authoritative guard.

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- US-013 acceptance criteria require the rename to be saved on Enter or blur. The implementation plan correctly exposes `renameDocument()`, but does not yet say which UI affordance triggers it. This is a UI concern that may legitimately live outside this plan; mentioning it in §9 step 9 (E2E "rename a document") would close the loop.
- US-009 AC says "W przypadku błędu zapisu wyświetlany jest toast z informacją o problemie." The plan's §5.1 step 7 routes "any other error" to a localStorage fallback + retry, but does not explicitly say a user-visible toast is shown on the *first* failure. It only mentions a toast on `QuotaExceededError` second failure. Recommend explicitly surfacing a toast on the first persistent network failure to match the AC literally.

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- §6 states "the trigger `documents_before_iu_sync_schema_version` overrides it to whatever `schemaVersion` the JSONB carries on the server side (sync-by-extraction)". This phrasing implies the column is overridden by the JSONB. That matches the trigger name's intent (sync direction: JSONB → column), but a reader could misread it as the trigger overwriting the JSONB. A one-line clarification ("column is set from `data->>'schemaVersion'`; the JSONB value is the source of truth") would prevent confusion.
- §5.3 wraps the read-modify-write in a single slice action and §8 (Performance) instructs the autosave action to early-return while `resizing` is true. Step §3 lists `resizing: boolean` in slice state but does not mention the early-return guard inside `saveDocumentData`. Add a note to step §3 (or §5.1) that `saveDocumentData` must check `resizing` before issuing the SDK call so the queueing rule is implemented, not just declared.
- Step §1 promises Vitest coverage for `errors.ts` covering "every code path listed in §7", but §7 includes `PGRST116 → UNAUTHORIZED` (a branch not yet in the api-plan.md stub) and `BusinessError.UNKNOWN` fallthrough. Confirm the test list explicitly enumerates a PGRST116 case so it is not missed when the stub is extended.

## 4. Summary
The implementation plan is structurally sound and faithfully covers US-009, US-013, and US-014. It correctly reflects the api-plan.md flow (read-modify-write for resize, narrow `select()` for autosave, `mapPostgrestError` for all error paths) and the database guarantees from `db-plan.md` (RLS, CHECKs, triggers). The most material follow-up is reconciling the `PGRST116 → UNAUTHORIZED` mapping with the `mapPostgrestError` stub in `api-plan.md` §9.1 — without that branch, the documented response semantics will not match runtime. Minor scope and phrasing clean-ups aside, the plan is safe to hand off to development once the PGRST116 mapping extension is explicitly called out.
