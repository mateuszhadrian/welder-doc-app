# Verification Report: POST /auth/v1/signup (Registration)

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found
No issues found.

- HTTP method matches (`POST` to `/auth/v1/signup`, invoked via `supabase.auth.signUp(...)` SDK call).
- URL structure matches (`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, SDK-only — no custom Route Handler), consistent with §2.2 framing of Supabase Auth as SDK-driven, not a `src/app/api/*` handler.
- Required body fields (`email`, `password`) match §2.2 verbatim.
- Success response shape (`{ user: { id, email, email_confirmed_at: null }, session: null }`) matches the example in §2.2.
- The plan correctly identifies the three-step registration flow defined in §2.2: (1) `signUp()`, (2) `POST /api/consent` bundle, (3) email confirmation link. The split-step decision in §6.2 of the implementation plan (always defer step 2 to post-confirmation) is internally consistent with §2.1's `consent` handler requiring an active session.
- `BusinessError` enum subset used (`EMAIL_ALREADY_REGISTERED`, `PASSWORD_TOO_WEAK`, `INVALID_CREDENTIALS`, `EMAIL_NOT_CONFIRMED`, `RATE_LIMITED`, `NETWORK_ERROR`, `UNKNOWN`) matches §9.1.
- `mapAuthError` skeleton matches §9.1 — same `switch` arms (`Invalid login credentials`, `Email not confirmed`, `User already registered`) and same heuristic fallback for password-length errors. The plan extends it with a `status === 429 || message.includes('rate limit')` branch for `RATE_LIMITED`, which is a strict superset (§9.1 only stops at `password... characters` heuristic + UNKNOWN fallback) — the addition is consistent with §6.1 `sign_in_sign_ups` rate limit and §9.1's `BusinessError.RATE_LIMITED`.
- Rate limits cited (`email_sent = 4 / hour / IP`, `sign_in_sign_ups = 30 / 5min / IP`) match §6.1.
- The plan correctly notes that `current_consent_version` cannot be set client-side (`block_protected_columns_update` trigger) and that `record_consent_bundle()` RPC is the sole writer — matches §2.2 / §2.1 / `db-plan.md` §1.2.
- The plan correctly identifies that `i18n key 'errors.consent_failed'` is needed for the deferred-consent failure path; this is additive to §9.3 and consistent with the principle "missing key = fallback to errors.unknown" (§9.3 makes this an extensibility statement, not a closed list).

### Warnings
- §4.3 Status-codes table maps "Email format niepoprawny (422 GoTrue)" to `BusinessError.UNKNOWN` rather than introducing a dedicated `EMAIL_INVALID` business error. This is consistent with §9.1 (which has no such enum value), and the plan correctly notes preflight client-side validation should catch this case before the request hits GoTrue. However, if GoTrue ever returns this with a stable string, consider extending the enum — flag it for post-MVP, not a blocker.
- §4.2 / §4.3 cite the GoTrue raw error response shape (`{ code: 422, error_code: "email_address_invalid", msg: "..." }`) but the implementation in §7.1 still relies on `err.message` string-match (`'User already registered'`, `'Password should be at least 8 characters'`). This is faithful to the §9.1 reference implementation, but `error_code` (when present on `AuthApiError`) is a more stable contract than `message` and could be added as a primary key in the `mapAuthError` switch as a follow-up.
- The plan does not explicitly cite §9.4 ("Konsekwencje zmian DB" — synchronizing `mapPostgrestError` with DB error string changes). The analogous principle for `mapAuthError` (synchronizing with GoTrue version upgrades that may change error wording) is implicit but not called out — worth noting for the PR checklist when bumping `@supabase/supabase-js`.
- §3.4 declares `RegisterUserResult` type with `step: 'signup' | 'consent'`, but in §3.2 (always-defer flow) only `step: 'signup'` is reachable from `registerUser` itself; the `'consent'` step is now exclusively the responsibility of `flushPendingConsent()`, which has its own `{ ok, reason }` shape. The discriminator is technically valid (forward-compatible if dev mode ever inlines consent), but unused — minor cleanup.

## 2. Consistency with prd.md

### Issues Found
No issues found.

- US-001 acceptance criterion "Formularz rejestracji zawiera pola: e-mail, hasło, potwierdzenie hasła" — covered by §9 Step 4.1 (`email`, `password`, plus consent checkboxes). The "potwierdzenie hasła" (password confirmation) field is **not explicitly listed** as a separate input in §9 Step 4.1, but standard sign-up UX implies it; flagged as a warning below.
- US-001 "Wymagany jest checkbox zgody na Regulamin i Politykę Prywatności" — covered by §9 Step 4.1 ("checkboxy zgód (`terms_of_service`, `privacy_policy`, `cookies` — wszystkie wymagane)").
- US-001 "System waliduje format e-mail i minimalną długość hasła (min. 8 znaków)" — covered by §6.3 validation matrix (client preflight + GoTrue authoritative) and §9 Step 7 (`isValidEmail`, `isValidPassword`).
- US-001 "Po pomyślnej rejestracji użytkownik jest zalogowany i trafia do listy projektów" — partially covered with a documented deviation: the plan correctly notes (§5 step 5, §6.2) that in **production** `enable_confirmations = ON` means `session = null` after `signUp()`, so the user is **not** logged in immediately — they are redirected to `/[locale]/auth/check-email` and only become logged-in after clicking the verification link. This deviates from the literal PRD wording but is a deliberate, justified decision rooted in the RLS policy on `documents` (`email_confirmed_at IS NOT NULL`, defense-in-depth — also called out in §6.4). PRD §3 ("Wymagania funkcjonalne") implicitly accepts standard email-confirmation flow via "Rejestracja e-mail + hasło" — no explicit prohibition of email confirmation. Acceptable trade-off; should be raised with product before launch.
- US-001 "Wersja zgody jest zapisywana w bazie danych" — covered by §5 step 4 + §9 Step 6.2 (deferred `flushPendingConsent()` after `/auth/callback` writes `consent_log` + `current_consent_version` via `record_consent_bundle()` RPC).
- §3.10 GDPR (Frankfurt EU, RODO) — inherited via `vercel.json fra1` pinning + Supabase EU-Frankfurt; not mentioned in this plan but transitively satisfied via the `/api/consent` step (which already enforces `ipAnonymize.ts` per `CLAUDE.md`).

### Warnings
- US-001 lists "potwierdzenie hasła" (password confirmation field) as part of the form. §9 Step 4.1 lists only `email`, `password`, and consent checkboxes — no second password field. This is a minor UX gap relative to the explicit acceptance criterion. Either the form needs a second `password_confirm` input with client-side equality check, or the PR should note that "min. 8 znaków + UI strength meter" was deemed sufficient by product. Easy to add.
- US-001 "użytkownik jest zalogowany i trafia do listy projektów" is **not** met in production (email confirmation gates the session). The plan handles this gracefully (`/auth/check-email` interstitial + post-confirmation `/auth/callback` → `/[locale]/`), but the divergence from the literal PRD wording should be documented as an accepted product decision in the PR description, not silently shipped. Consider amending the PRD acceptance criterion to "po potwierdzeniu adresu e-mail użytkownik jest zalogowany i trafia do listy projektów" once approved.
- PRD §3 mentions OAuth as optional ("oraz opcjonalnie OAuth przez Supabase Auth"). The plan does not address OAuth at all (correctly — out-of-scope for this endpoint), but no OAuth-related TODO is left in the implementation plan. Confirm OAuth is tracked elsewhere (it should be in a separate plan) so it is not lost.
- The plan does not call out PRD §3.11's data-export and account-deletion implications for newly-registered users. This is correctly out-of-scope (handled by `/api/user/export` and `DELETE /api/user/account`), but the registration page should link to the privacy policy that names these rights — minor UX/legal note for the form copy review.

## 3. Internal Consistency

### Issues Found
No issues found.

- §1 (overview), §2 (request), §4 (response), §5 (data-flow diagram), and §6 (security) all agree on the three-step flow and the production decision to defer step 2 (`/api/consent`) until after email confirmation. The data-flow diagram in §5 explicitly cross-references §6.2 / §9 for the split-step rationale.
- §6.2's two options ("flag-based dev/prod branching" vs. "always defer to post-confirmation") are presented honestly, and §9 Step 3.2 commits to option B (always defer) — eliminating dev/prod branching is consistent with the §6.2 recommendation ("Rekomendowana dla MVP").
- §3.4's `RegisterUserResult` discriminator and §3.2's `mapAuthError` consumer agree on the typed `{ business, message }` contract.
- §7.2 error-scenario table maps every row from §4.3 status-codes table to a UI reaction, with no gaps.
- §9 Implementation Steps are in correct dependency order: errors helper (Step 1) → Auth config (Step 2) → registration service (Step 3) → UI (Steps 4–6) → preflight validation (Step 7) → E2E tests (Step 8) → PR audit (Step 9) → docs update (Step 10). No forward references that would require backtracking.

### Warnings
- §3.2 declares the function `registerUser` as part of `'use client'` module (`src/lib/auth/registration.ts`). Putting `'use client'` at the top of a `lib/` file conflicts with `CLAUDE.md`'s convention that infrastructure under `src/lib/**` is shared between Server and Client Components (e.g., `src/lib/supabase/{client,server,middleware}.ts` keeps these separate explicitly because Server Components cannot import a `'use client'`-marked module without RSC payload bloat). Recommend dropping the directive and relying on the **caller** (`SignUpForm.tsx`) to be `'use client'`. The function uses `sessionStorage`, which already self-gates with `typeof window !== 'undefined'`, so no SSR risk.
- §9 Step 1.4 adds the i18n key `errors.consent_failed`, but §7.2 also references `errors.email_invalid` (used in the preflight branch). §9 Step 1.4's i18n stub does include `email_invalid` — internally consistent — but does **not** include `errors.invalid_credentials` and `errors.email_not_confirmed` from `BusinessError` (sign-in path). Since this plan explicitly covers only sign-up, that is acceptable; just confirm the sign-in plan picks them up.
- §9 Step 3.2's reference implementation uses `data.user!` (non-null assertion) on the success branch. Per `CLAUDE.md` "TypeScript runs with `strict` + `noUncheckedIndexedAccess`", this is technically allowed but should be replaced with `if (!data.user) return { ok: false, step: 'signup', error: { business: BusinessError.UNKNOWN, message: 'errors.unknown' } }` for symmetry with the rest of the error-handling discipline. Otherwise an unexpected GoTrue response shape would crash with a runtime null-deref instead of producing a typed business error.
- §9 Step 6 ("Strona `/[locale]/auth/callback`") is marked "Częściowo out-of-scope — szczegóły zostaną w planie endpointa logowania." This means a non-trivial part of the registration UX (PKCE code exchange, session creation, `flushPendingConsent` invocation) is deferred to the sign-in plan. Acceptable, but the PR for sign-up will be **incomplete** until the callback page exists — this dependency should be made explicit in the PR description ("blocked-by: sign-in plan callback page").
- §6.4's "Trigger handle_new_user() w SECURITY DEFINER" mitigation correctly defers verification to `db-supabase-migrations.md`. That file is not referenced anywhere else in the plan and is not in the working tree by name (the four migrations cited in `CLAUDE.md` are filename-based, not a doc). Confirm the migration audit is performed by a different artifact or fold a one-line check into Step 9 PR audit.
- §9 Step 9 PR checklist does not include "verify `getUser()` is called in the `[locale]/layout.tsx` for locale redirect" (per `CLAUDE.md` "PR checklist for auth implementation (US-002 sign-in)"). That checklist applies to sign-in, not sign-up — but the registration plan should at minimum reference that the locale-guard pattern will be honored once the user actually signs in via the callback page. Minor cross-reference gap.

## 4. Summary
The implementation plan is consistent with `api-plan.md` §2.2 (Supabase Auth SDK flow), §9.1 (`mapAuthError` shape), and §6.1 (rate limits), and addresses all five US-001 acceptance criteria with one documented deviation (production email confirmation defers automatic login until after the verification link is clicked). The deviation is technically justified by the `documents` RLS policy and is internally consistent across §1, §5, §6.2, and §9. Warnings are advisory: (a) the missing "potwierdzenie hasła" form field, (b) the `'use client'` directive in a `lib/` module, (c) the `data.user!` non-null assertion, and (d) the dependency on the not-yet-written `/auth/callback` page from the sign-in plan. None block merge; all should be folded into the PR checklist or addressed before the registration form ships to production. The plan is safe to hand off to development with these warnings noted.
