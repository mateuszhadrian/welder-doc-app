# Verification Report: Password Reset Request (POST /auth/v1/recover, US-004)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- The implementation plan resolves `[locale]` literally (`${locale}`) inside the `redirectTo` URL — this is the correct runtime resolution of the placeholder shown in `api-plan.md` §3 (line 558). Consider noting explicitly that the placeholder in the plan is illustrative, so future readers do not copy `/[locale]/auth/callback` verbatim into env config or whitelists.
- `api-plan.md` §9 defines `mapAuthError()` and a `BusinessError` enum that the project mandates as the only error-handling path (CLAUDE.md invariant). The plan correctly defers usage to "TODO M3" but the deferral period should be tracked — leaving raw `error.status === 429` checks in production code would violate the architectural invariant.
- Whitelist enforcement of `redirectTo` (Supabase Dashboard) is added by the implementation plan but is not surfaced in `api-plan.md`. Worth back-porting a one-line note to `api-plan.md` §6 to keep the security checklist in one place.

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- All US-004 acceptance criteria are covered (form accepts email; email with link is sent; link validity ≥ 1 h via GoTrue default `otp_expiry`; new password can be set on callback; new password works for sign-in via the separate `update-password` flow + signOut/redirect in step 6).
- The PRD does not explicitly require anti-enumeration; the plan adds it correctly as defense-in-depth, but be aware this is a UX choice not directly traceable to PRD acceptance criteria — flag it during product review.
- PRD says "Link jest ważny przez określony czas (min. 1 godzina)" — implementation plan relies on Supabase default `otp_expiry = 1h`. Consider explicitly pinning this in `supabase/config.toml` so a future config drift cannot drop the value below the PRD floor.

## 3. Internal Consistency
### Issues Found
- **Conflicting behavior on rate-limit (429).** §4.2 and §7 specify a toast `auth.password_reset_rate_limited`, but the code in step 4 sets `setSubmitted(true)` when `error.status === 429`, after which the component early-returns the generic success message and never renders the `errorKey` toast. The user therefore sees the "link sent" message and the rate-limit toast is silently discarded. Either remove the `setSubmitted(true)` branch (and surface the toast) or remove the toast contract from §4.2/§7 — but the two cannot coexist as written. Step 8 Test 2 already flags the ambiguity ("zależnie od decyzji UX"), confirming it is unresolved.
- **Misleading fallback error mapping.** Step 4 contains `else setErrorKey('password_reset_invalid_email')` for any error that is not 429 and not 422. Per §7, unexpected GoTrue errors (`status >= 500`, network/timeout, validation_failed for redirect whitelist) should map to `errors.unexpected` / `errors.network_error` / `errors.email_provider_unavailable`, not to "invalid email." Mapping a 5xx to "invalid email format" misleads the user and contradicts §7. Replace the fallback with the documented mappings.

### Warnings
- §8 (Performance/UX) prescribes a 60 s disable on the submit button matching the GoTrue cooldown, but step 4's code only disables on `isPending`. Either add the 60 s timer (e.g., `useEffect` with `setTimeout` resetting a `cooldownUntil` state) to step 4, or remove the requirement from §8.
- §3 lists `AuthError | null` as the SDK return type. `resetPasswordForEmail` returns `AuthError | AuthApiError | null`; `error.code` access (used in §7 for `over_email_send_rate_limit`, `validation_failed`, `email_address_invalid`) requires `AuthApiError` — worth a note that the narrowing happens via `if ('code' in error)` or `instanceof AuthApiError`.
- §7 references `error.code === 'email_address_invalid'` for 422 but step 4 code branches only on `error.status === 422`. The mapping is fine for now, but if multiple 422 sub-codes appear (e.g., format vs length), a `switch (error.code)` would be more robust.
- Step 5 mentions validating `searchParams.next` to start with `/` to prevent open redirects — good. Make sure the same guard is reused if the OAuth callback ships in the same file post-MVP, otherwise it could regress.

## 4. Summary
The implementation plan is structurally sound and aligns with both `api-plan.md` §3 and PRD US-004; the SDK-only approach (no Route Handler) is correct and matches the project convention. There are two real internal inconsistencies in §4.2/§7 vs the step 4 code sample (rate-limit branch silently swallows the toast; the catch-all `else` mismaps unknown errors to "invalid email") that should be fixed before the form is implemented, but neither blocks the architecture or contracts. Address those two points and tighten the fallback / 60 s cooldown UX, and the plan is safe to hand off.
