# Verification Report: DELETE /rest/v1/documents (Delete Document)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- The implementation plan refers to the RLS column as `email_confirmed`, while api-plan §3 (line 1118) writes the predicate as `email_confirmed_at IS NOT NULL`. CLAUDE.md confirms the migration uses `email_confirmed` (a generated/derived column), so the two are functionally equivalent — but the discrepancy in naming should be documented in a one-line comment in the plan or in `errors.ts` to prevent future confusion.
- Section 3 ("Used Types") references `DocumentListItemDto` and `DocumentDto` from `src/types/api.ts`. Per CLAUDE.md these DTOs are not yet implemented; the plan should explicitly mark this as a forward dependency (or note that the create/list endpoint plans introduce them).

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- US-011 acceptance criterion "Operacja jest nieodwracalna po potwierdzeniu" is implicitly satisfied by hard delete + RODO art. 17 alignment (§6.8). A one-line cross-reference to RODO art. 17 in §1 (Endpoint Overview) already exists; consistent with PRD's "permanent deletion" wording.

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- **Status code presentation in §4 (Response Details).** The error table shows `403 Forbidden (manifested as 204 with zero rows by RLS, or 42501 insufficient_privilege)`. Mixing HTTP 403 with PostgreSQL `42501` in a single row is potentially confusing for an implementer. Recommend splitting into two rows: one for the typical 204+0-rows case (silent), one for the rare 42501 case (mapped to `BusinessError.EMAIL_NOT_CONFIRMED`/`UNAUTHORIZED`).
- **Email-not-confirmed UX gap.** Because the plan deliberately omits `.select()` (no row count returned) and RLS typically filters silently to 204+0-rows, an authenticated-but-unconfirmed user clicking "Usuń" will see the success toast "Projekt usunięty" while the row remains in DB. §6 point 7 frames this as anti-information-leakage (correct for cross-user IDOR), but for the same-user-unconfirmed case it produces a misleading UX. Recommend either (a) preflighting `user_profiles.email_confirmed` client-side before issuing the DELETE, or (b) explicitly accepting this as MVP-tolerable and documenting it in §7.
- **`mapPostgrestError` and DELETE.** §9.1 of api-plan.md does not list any DELETE-specific `BusinessError` codes; the plan correctly notes that any non-null error falls through to `BusinessError.UNKNOWN`. However, step 8 unit-test guidance asserts `mapPostgrestError(PGRST301)` returns `UNKNOWN` "or whatever the mapper returns" — this is a forward dependency on a mapper that does not yet handle `PGRST301` explicitly (it is mapped to `UNKNOWN` per the current §9.1 stub, with no `UNAUTHORIZED` branch). If the mapper later adds an explicit `PGRST301 → UNAUTHORIZED` branch, this test will need updating. Consider asserting the mapped value indirectly (via the mapper), as the plan already suggests.
- **`errors.ts` is a hard prerequisite, not a soft TODO.** Step 2 says "implement errors.ts if not yet done" — but every other step (3, 5, 7, 8) imports `mapPostgrestError` and `BusinessError`. CLAUDE.md confirms `errors.ts` is not yet implemented. Recommend reordering step 2 above step 1, or marking it as a blocking gate before any DELETE endpoint code is merged.
- **Step 9 (Playwright E2E) negative case.** "Attempt to delete a non-existent UUID via direct hook invocation (debug surface)" reads more like a unit test than an E2E. Step 8 already covers this scenario via mocked Supabase. Suggest dropping the "negative via debug surface" item from step 9 to avoid creating a hidden debug surface in production code.
- **Confirmation modal copy in §5 (UI integration).** Defaults are PL-only ("Czy na pewno usunąć projekt «{name}»?") — this is fine because PL is the default locale, but the plan should note that `pl` and `en` keys are both required (CLAUDE.md "Zero hardcoded UI strings" rule). Step 7 covers this, but step 5 should cross-reference it.

## 4. Summary
The implementation plan is consistent with api-plan.md (§2.2 SDK invocation, §3 RLS, §9 Error Mapping) and fulfills all four PRD US-011 acceptance criteria. The chosen approach (PostgREST DELETE, RLS-only authorization, no custom Route Handler, no `.select()` chain) correctly aligns with the architecture and avoids info leakage. The plan can be handed off to development with two minor corrections recommended before merge: (1) clarify the email-not-confirmed UX path (silent 204 vs. preflight check vs. accept as MVP gap), and (2) reorder step 2 so `src/lib/supabase/errors.ts` is treated as a blocking prerequisite rather than an optional TODO. The 403/42501 mixing in §4 is presentation-only and does not block implementation.
