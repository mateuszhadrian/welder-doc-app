# Verification Report: Resend Verification Email (POST /auth/v1/resend)

## Overall Status

PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found

- No issues found.

### Warnings

- **i18n key returned from `mapAuthError` vs i18n keys listed in §4 error table.** Step 2 of the implementation plan adds a single mapping that always returns `message: 'errors.rate_limited'`, but §4 (Response Details — Errors) lists three distinct keys: `errors.resend_cooldown`, `errors.email_rate_limited`, `errors.unknown`. Either narrow §4 to a single key, or differentiate the cooldown vs hourly-limit branches inside `mapAuthError` (e.g., return `'errors.email_rate_limited'` for `Email rate limit exceeded` and `'errors.rate_limited'` for the 60s cooldown). As written, the UI cannot tell the two apart through the i18n key.
- **`mapAuthError` style coherence with api-plan.md §9.1.** The shipping `mapAuthError` (per §9.1) is a `switch (err.message)` with a `default` branch. The plan inserts an `if (err.message.includes(...))` block before `default`. Functional but stylistically inconsistent with the existing scaffold; consider adding two extra `case` arms (or factoring rate-limit detection into a helper) so the file stays internally uniform.
- **Helper return-shape uses string literal instead of `BusinessError.UNKNOWN` enum (Step 3).** The fallback `{ business: 'unknown' as const, message: 'errors.unknown' } as MappedError` bypasses the enum that api-plan.md §9 mandates. Since `mapAuthError(error)` never returns `null` for a non-null input per §9.1, the `??` fallback is dead code anyway and should be removed. Use `BusinessError.UNKNOWN` if a guard is retained.
- **`type` union wider than MVP scope.** §3 declares `ResendVerificationEmailType = 'signup' | 'email_change' | 'recovery'` while §1 explicitly states the MVP only uses `'signup'` on this UI path (recovery is handled via `resetPasswordForEmail`). Either narrow the union to `'signup'` for the MVP helper signature, or document explicitly that the helper is forward-compatible and the UI hard-codes `'signup'`.

## 2. Consistency with prd.md

### Issues Found

- No issues found.

### Warnings

- **PRD US-001 has no explicit acceptance criterion for resend.** The implementation plan invokes "US-001 follow-up, kamień m5", which is sourced from the api-plan.md changelog rather than the PRD itself. PRD US-001 ("Po pomyślnej rejestracji użytkownik jest zalogowany i trafia do listy projektów") even implies no email confirmation step exists. The resend flow is justifiable infrastructure for the Supabase default email-confirmation behavior, but the gap between PRD US-001 and the Supabase default flow should be reconciled in the PRD (or the implementation plan should state explicitly that email confirmation is being intentionally enabled despite US-001 wording).
- **No PRD acceptance criterion for the 60s countdown UX.** The plan adds a non-trivial UI element (cooldown timer, optional `sessionStorage` persistence) that has no PRD-side acceptance criterion to anchor against. This is reasonable engineering judgement, but worth surfacing — design copy and exact countdown duration should be confirmed with product before merge.

## 3. Internal Consistency

### Issues Found

- No issues found.

### Warnings

- **Duplicate / unused i18n keys (Step 5).** `auth.resend.rateLimited` and `auth.resend.cooldown` are defined in the messages JSON, but the helper-level error mapping returns `errors.rate_limited`. The `auth.resend.*` keys are never consumed unless the component performs additional branching beyond `feedback.key = res.mapped.message`. Either remove the unused keys or wire the component to translate based on `mapped.business` rather than `mapped.message`.
- **§7 "logiczny status 500" is undocumented in client UX.** The error-handling table assigns logical statuses (400, 429, 500) for various failure modes, but Supabase Auth always returns HTTP 200 with `error` populated. The "logical status" column has no consumer in the implementation (no telemetry, no logging) — either drop the column to avoid confusion, or describe how it is used.
- **`type` union claim vs implementation (§3).** §3 states "Zawężone do 'signup' bo MVP US-001..." in the comment but the union includes all three values. Comment and code disagree.
- **Step 7 unit-test naming convention.** Plan instructs colocating `resendVerificationEmail.test.ts` next to `resendVerificationEmail.ts` per CLAUDE.md, which is consistent. However, the `ResendVerificationButton.test.tsx` colocation with the component places UI tests inside `src/components/**`, but CLAUDE.md notes that UI components are excluded from coverage thresholds (covered by Playwright). This is fine, but the plan should clarify that `src/lib/auth/**` coverage counts toward the 80% threshold while the component test does not.
- **Optional `sessionStorage` key.** `welderdoc_resend_countdown_until` does not collide with the existing `welderdoc_autosave` / `welderdoc_migrated_at` keys in `localStorage`, but living in `sessionStorage` it is per-tab — refresh in a new tab will reset countdown. Plan should state this trade-off explicitly so reviewers understand "persists countdown across refresh" is tab-scoped.

## 4. Summary

The implementation plan is structurally sound and aligns with api-plan.md §2.2 (Auth via SDK) and §6.1 (rate-limit configuration). The decision to skip a custom Route Handler and rely entirely on `supabase.auth.resend` from a `'use client'` helper is correct and matches the project's anti-enumeration security posture. The plan is safe to hand off to the development team after addressing two non-blocking items: (1) decide whether `mapAuthError` returns a single `errors.rate_limited` key or distinguishes cooldown vs. hourly-limit (and align §4 / Step 5 / Step 2 accordingly), and (2) replace the `'unknown' as const`-cast fallback in Step 3 with the `BusinessError.UNKNOWN` enum value (or remove the unreachable branch). The remaining warnings are documentation-level polish and do not block implementation.
