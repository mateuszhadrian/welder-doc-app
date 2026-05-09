# Verification Report: Get Document (GET /rest/v1/documents?id=eq.{id})

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
- The implementation plan introduces `BusinessError.DOCUMENT_NOT_FOUND` and instructs the team to extend the enum in `src/lib/supabase/errors.ts`, but the canonical `BusinessError` enum defined in `api-plan.md` §9.1 does not include this value. Adding a new business error code is a contract change that must be reflected in `api-plan.md` (and in `mapPostgrestError`); otherwise other endpoint plans referencing the same errors module will diverge. This needs to be coordinated explicitly with `api-plan.md` §9, not unilaterally introduced by this endpoint.

### Warnings
- The plan references `BusinessError.DOCUMENT_DATA_SHAPE_INVALID` for the `isCanvasDocument` guard fallthrough. `api-plan.md` §9.1 defines this enum value but maps it only via `mapPostgrestError` for `code: 23514` + message `jsonb_typeof(...)`. The plan correctly reuses the i18n key, but the dual production source (DB CHECK violation vs. client-side codec guard) should be noted in the errors module so both call sites converge on the same `MappedError` shape.
- `api-plan.md` §2.6 does not enumerate explicit error status codes for the GET — the implementation plan introduces 401/406/500/400 mappings on its own. These are accurate w.r.t. PostgREST behaviour, but note that the plan's `22P02` → `errors.invalid_document_id` toast is not present in the api-plan §9.1 mapping table. Either add the mapping there or remove the new i18n key.
- The plan suggests using `notFound()` from Next.js when `isUuid()` fails — this is a sound preflight, but it bypasses the `mapPostgrestError` path entirely. If the project decides later to route all errors through `MappedError`, this short-circuit will need a corresponding documentation note in `api-plan.md`.

## 2. Consistency with prd.md
### Issues Found
- No issues found.

### Warnings
- US-010 acceptance criterion "Po wczytaniu scena jest automatycznie wycentrowana na ekranie, a zoom jest dobrany tak, aby jak największa część zawartości projektu była widoczna" is a UI-side responsibility (canvas-viewport store action) that is not part of this endpoint, but the implementation plan does not call it out as a downstream consumer. Worth a one-liner in step 6 (`loadDocument` action) so the contract between fetch and viewport-fit is explicit and not lost in handoff.
- US-010 also requires "Wszystkie elementy, parametry, ukosowania, połączenia spawalnicze i ich warstwy są odtworzone bez utraty danych" — i.e. the codec migration path matters for fidelity. The plan correctly defers `documentCodec.migrate()` (codec not yet implemented per CLAUDE.md) but does not specify the failure mode if `schema_version > CURRENT_CODEC_VERSION` (codec too new — older client opens newer document). The error matrix in §7.1 mentions `errors.codec_too_new` but it is "poza scope service'u" — the PRD's "100% bez utraty danych" criterion implies this case must at minimum block the load with a clear toast; clarify ownership (page-level boundary vs. store action).

## 3. Internal Consistency
### Issues Found
- No issues found.

### Warnings
- §5.4 service stub returns `BusinessError.UNKNOWN` while simultaneously naming the i18n key `'errors.document_not_found'` and adding a comment `// extend enum: DOCUMENT_NOT_FOUND`. After the enum extension proposed in step 9.1, the literal `BusinessError.UNKNOWN` in this branch must be updated to `BusinessError.DOCUMENT_NOT_FOUND`. As written, the snippet is internally inconsistent with step 1 of §9 ("Implementation Steps") and will silently mismap if implemented verbatim.
- §6.1 says "W Server Component zawsze wywołać `auth.getUser()` przed `getDocument()`", and §7.1 maps "Brak sesji / wygasła" to a 401 with `BusinessError.UNAUTHORIZED`. However, with `auth.getUser()` already enforced at the Server Component layer (step 5 → `redirect('/[locale]/sign-in?next=...')`), the 401 branch from `getDocument()` is effectively dead code unless a Client Component is the caller. Consider clarifying whether the service-layer 401 mapping is reserved for client-side reload paths only.
- §6.3 ("Walidacja UUID") says invalid UUIDs from PostgREST come back as `22P02` and recommends client-side preflight via `isUuid()`. Step 9 step 4 implements this. But §7.1 also lists `22P02` → `BusinessError.UNKNOWN` with a `errors.invalid_document_id` toast — given preflight will short-circuit invalid UUIDs to `notFound()` (per step 5), the `22P02` row in the error matrix becomes near-unreachable. Either keep the mapping as defense-in-depth and document it as such, or remove the i18n key to avoid dead translations.
- §7.2 specifies that errors should be logged via `console.error` with payload `{ documentId, business, rawCode }`. The service layer in §5.4 does not perform this logging — it only returns the `MappedError`. Clarify whether logging is the responsibility of the Server Component caller (step 5) or should be moved into `getDocument()` itself, otherwise callers will diverge.
- The implementation steps mix concerns of different layers without explicit ordering between `BusinessError` enum extension (step 1) and the test that asserts the new enum branch (step 7). Step 7 will fail until step 1 lands; this is implicit but worth surfacing as a hard ordering note for parallel work.

## 4. Summary
The implementation plan is technically sound and aligns with the api-plan and PRD intent for US-010 (load existing project). The principal blocker is a contract-level inconsistency: introducing `BusinessError.DOCUMENT_NOT_FOUND` (and ancillary keys `errors.document_not_found`, `errors.invalid_document_id`) is a cross-cutting change to the `errors.ts` module and `api-plan.md` §9.1, and must be coordinated rather than bolted onto a single endpoint plan. Several internal-consistency warnings (the `BusinessError.UNKNOWN` placeholder in the snippet, dead 401/22P02 branches given Server Component preflight, and unowned logging) are minor but should be tightened before implementation. With the enum extension hoisted to `api-plan.md` and the placeholder code in §5.4 corrected, the plan is safe to hand off to the development team.
