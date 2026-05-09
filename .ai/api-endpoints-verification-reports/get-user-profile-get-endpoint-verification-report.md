# Verification Report: GET User Profile (`GET /rest/v1/user_profiles?id=eq.{uid}`)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found
- No issues found.

### Warnings
- The implementation plan adds a new branch to `mapPostgrestError` for `error.code === 'PGRST301'` (and `'42501'`) → `BusinessError.UNAUTHORIZED`. `api-plan.md` §9.1 defines the canonical `mapPostgrestError` skeleton, but it does **not** include this branch (PGRST301 / 42501 are not currently listed). This is an additive change that is consistent with the spirit of the plan (the `BusinessError.UNAUTHORIZED` enum value already exists in §9.1), but the api-plan should be updated in lock-step or this implementation plan should call out that it is extending the mapper. Since §9.4 explicitly states "Zmiana brzmienia `RAISE EXCEPTION` … wymaga synchronicznej aktualizacji `mapPostgrestError`", an analogous note for added branches is recommended.
- The implementation plan in §4.2 claims PostgREST returns `406` for `single()` on 0/>1 rows. PostgREST actually returns HTTP `406 Not Acceptable` only for unacceptable `Accept` headers; the `.single()` 0/>1 rows error in `supabase-js` is reported as `PGRST116` (with HTTP `406` historically, but the SDK surfaces `error.code = 'PGRST116'`). The data file (`get-user-profile-get-endpoint-data.md`) repeats the same `406` claim, so this is consistent across docs — but downstream the mapper should switch on `error.code === 'PGRST116'`, not on HTTP status. Worth a one-line clarification when implementing `mapPostgrestError`.
- §2 Headers list `Accept: application/vnd.pgrst.object+json` as added by `.single()`. This is correct, but worth noting that `supabase-js` actually sends `Accept: application/vnd.pgrst.object+json` only for `.single()` — `.maybeSingle()` would send a different header. Not a defect, just an implementation note for whoever wires the test mocks.
- The PostgREST URL in §2 includes the `select` query string with spaces removed (`id,plan,locale,...`), but the SDK call in §5 uses `'id, plan, locale, current_consent_version, created_at, updated_at'` (with spaces). Both work — `supabase-js` strips whitespace before the network call — but the two snippets should be visually consistent to avoid confusion when a reader greps the codebase.

## 2. Consistency with prd.md

### Issues Found
- No issues found.

### Warnings
- The implementation plan correctly enables three PRD-driven flows: locale guard (US-050), consent re-check (US-001 / US-051), and plan gating (post-MVP US-044/045 awareness). All AC items in those stories are addressed.
- Step 5 (`src/app/[locale]/layout.tsx` example) compares `profile.current_consent_version < CURRENT_CONSENT_VERSION` with a string-less-than operator. PRD does not mandate semver comparison, but in practice version strings like `'1.10'` < `'1.2'` lexicographically. The implementation should clarify the comparison helper (e.g., `compareVersions`) before merging — this is a latent bug for the consent-re-check flow that derives from PRD AC ("Wersja zgody jest zapisywana w bazie danych" + the consent re-check requirement in CLAUDE.md PR checklist for US-002).

## 3. Internal Consistency

### Issues Found
- No issues found.

### Warnings
- §3 says the `MappedError` interface has fields `business`, `message`, `rawCode?`, `rawMessage?`. §7 example code calls `mapped.message` and references `mapped.business` — internally consistent. Good.
- §6 point 2 references "`supabase.auth.getClaims()`" as an alternative to `supabase.auth.getUser()` for obtaining the user id server-side. `getClaims()` is a newer (2025) helper; the rest of `api-plan.md` (e.g., §2.1, §6 §10.2) and CLAUDE.md uniformly recommend `auth.getUser()` for server JWT validation. Either harmonise on one helper or note that both are acceptable. Defaulting to `auth.getUser()` matches the existing project conventions and the api-plan's "konsekwencje pominięcia `auth.getUser()`" warnings.
- §9 Step 1 instructs the engineer to implement `errors.ts` with branches for `PGRST301` and `42501`. The example code in §7 uses `BusinessError.UNAUTHORIZED` and `mapPostgrestError(error)`. Step 6 unit-test list ("401 returns `BusinessError.UNAUTHORIZED`") aligns. Internally consistent.
- §9 Step 5 has a minor inconsistency: the imports show `import { setRequestLocale } from 'next-intl/server'` but the example does not call `setRequestLocale(locale)` again after the `useUser` redirect — it does call it before the auth check, which is correct. Worth double-checking when wiring the actual layout that `setRequestLocale` is called **before** the first `next-intl` hook (per CLAUDE.md i18n notes).
- Step 5 uses a placeholder `pathnameWithoutLocale(...)` helper without specifying where it lives. This is a known utility need for locale redirect — implementation should add it to `src/lib/i18n/` or similar. Not a contradiction within the plan, but a missing reference.
- §9 Step 4 says "Use option 1 unless something blocks it — the slice is already needed for plan gating", but `src/store/userSlice.ts` is not yet created (CLAUDE.md does not list it in the implemented store slices). The plan should call out that the `userSlice` file must be created as part of this work, or that it can be deferred and a plain `useEffect` hook used in the meantime.
- Pre-condition note ("Skip the parts already present") is good, but `errors.ts` and `profile.ts` are still entirely missing per CLAUDE.md memory file `project_backend_todo.md`. The implementation plan correctly takes responsibility for creating both — internally consistent.

## 4. Summary

The implementation plan is well-aligned with `api-plan.md` §2.2 (Profile section) and `prd.md` US-002 / US-050 / US-051. It correctly identifies that this is a SDK-direct PostgREST read (not a custom Route Handler), wires the project-mandated `mapPostgrestError` discipline, and respects the column allowlist (excluding `paddle_customer_id`). Two minor items deserve attention before development: (1) confirm/update `mapPostgrestError` in `errors.ts` for the new `PGRST301` / `42501` branches and document that `.single()` reports `PGRST116`, not bare HTTP `406`, in `error.code`; (2) replace the lexicographic `current_consent_version < CURRENT_CONSENT_VERSION` comparison with a proper version-comparison helper. Neither blocks implementation. The plan is safe to hand off to the development team as long as these warnings are addressed during the PR review.
