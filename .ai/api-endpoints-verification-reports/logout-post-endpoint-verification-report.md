# Verification Report: POST /auth/v1/logout (Wylogowanie — US-003)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
- No issues found.

### Warnings
- The implementation plan correctly states that auth (logout) is delegated to Supabase Auth SDK and that no custom Route Handler should be created. `api-plan.md` §2.2 ("Operacje przez Supabase SDK") and §2.2 → "Wylogowanie (US-003)" snippet (`const { error } = await supabase.auth.signOut()`) confirm this — the plan is consistent.
- The plan claims (Section 7) that "Brak tabeli `error_log` w tej domenie ... potwierdzone w `api-plan.md` §9 — nie ma rekordu dla logout". `api-plan.md` §9 in fact does not list any `error_log` table at all (it defines `BusinessError` enum + mappers); the wording is technically true but slightly misleading. Worth rewording to "logout nie ma własnego kodu w `BusinessError` enum".
- The plan refers to `ConsentApiErrorCode` / `DeleteAccountApiErrorCode` (Section 3) as existing types in `src/types/api.ts`. They are mentioned as types that we do NOT extend, so no real issue — just confirm in code review that those identifiers exist in `src/types/api.ts` before the doc references go stale.

## 2. Consistency with prd.md
### Issues Found
- No issues found.

### Warnings
- US-003 acceptance criterion 2 says "...użytkownik jest przekierowywany na stronę logowania **lub stronę główną**". The plan picks `/${locale}` (homepage). This satisfies the criterion. A minor improvement would be to explicitly state in Section 5.1 / Step 2 that this is the deliberate product choice (vs `/${locale}/login`), so QA does not flag it as a deviation.
- US-003 acceptance criterion 3 ("Po wylogowaniu chronione trasy są niedostępne bez ponownego zalogowania") is implicitly covered by the fact that `src/proxy.ts` runs Supabase `updateSession()` before any locale routing, but the implementation plan does not call this out explicitly. The E2E test in Step 8 does verify it (navigate to `/dashboard` → middleware redirect to login), so this is a documentation-only gap.

## 3. Internal Consistency
### Issues Found
- No issues found.

### Warnings
- Step 1 defines `signOutClient()` returning `Promise<void>`, but Section 3 ("Used Types") declares `SignOutResult { ok: true }` for an optional helper wrapper. The two snippets use different return contracts. Pick one (the `Promise<void>` in Step 1 is sufficient for the described idempotent behavior) to avoid confusion in implementation.
- Section 7 row "Network error (offline / 5xx GoTrue)" prescribes both showing a toast (`auth.errors.signOutFailed`) AND forcing redirect + store reset. Section 4 states "niezależnie od statusu, lokalne efekty (czyszczenie store'a, redirect) zawsze następują". These align, but Step 2's `handleClick()` example does not branch on the SDK error to display the toast — it just calls `signOutClient()` and proceeds. The Step 1 helper also only `console.warn`s on errors. Consider either:
  - Returning the error from `signOutClient()` so the caller can show the toast, OR
  - Centralizing toast-on-error inside `signOutClient()` itself.
  Otherwise the documented "show toast on 5xx" behavior is not actually wired up by the example code.
- Section 5.3 notes that `welderdoc_autosave` and `welderdoc_migrated_at` must persist after logout, and Step 4 says `resetUserScoped()` "NIE czyści ShapesSlice/HistorySlice/UISlice.canvas". This is consistent. Only watch-out: Step 5 (`onAuthStateChange`) also calls `resetUserSlices()` — confirm that this single action does not also clear localStorage as a side effect (autosave middleware in Zustand can hook on slice changes; if the autosave key gets rewritten with empty state on user-scoped reset, the regression-guard E2E in Step 8 will fail).
- Step 6 uses `await createClient(); await supabase.auth.signOut()` inside a Route Handler that has just performed `auth.admin.deleteUser(user_id)` via a service-role client. The cross-referenced delete-user-account plan (line 256) explicitly notes that `signOut()` after `deleteUser` may throw because the user no longer exists — this should be silenced/ignored in the logout helper or in the calling code. Section 7 of the logout plan does not mention this specific edge case (it only covers `AuthSessionMissingError`); add an explicit note that "user-not-found after admin delete" is also a tolerated, idempotent outcome.

## 4. Summary
The implementation plan for `POST /auth/v1/logout` is internally coherent and faithfully reflects both `api-plan.md` §2.2 (auth via SDK, no custom Route Handler) and PRD US-003. There are no blocking discrepancies — the plan is safe to hand off, with minor polish recommended before merge: align the `signOutClient()` return type with Section 3's `SignOutResult`, wire the documented "toast on 5xx" path into Step 2's example handler, and mention the post-`deleteUser` `signOut()` edge case (already flagged in the cross-referenced delete-account plan) inside Step 6.
