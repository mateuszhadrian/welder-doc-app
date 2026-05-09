# Verification Report: PATCH /rest/v1/user_profiles?id=eq.{uid} (Update User Profile)

## Overall Status

PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found

- No issues found.

### Warnings

- The implementation plan exposes the response example with field set `{ id, plan, locale, current_consent_version, created_at, updated_at }` (mirroring `UserProfileDto`), but `Prefer: return=representation` combined with `.select()` (no projection argument) returns **all** columns of `user_profiles`, including `paddle_customer_id`. The plan correctly notes "`paddle_customer_id` nie jest wybierany przez DTO i nie powinien być eksponowany do UI", yet the wrapper as specified in step 2 calls `.select()` without an explicit column list. To match `UserProfileDto` exactly the wrapper should call `.select('id, plan, locale, current_consent_version, created_at, updated_at')` — otherwise the network response leaks `paddle_customer_id`. The api-plan example for GET (§Profil użytkownika) already uses an explicit column list; the PATCH wrapper diverges silently.
- Status code mapping in §4 lists `403` for "RLS odrzuca (np. `id != auth.uid()`)" but PostgREST + Supabase typically return `406 Not Acceptable` (or an empty result with 204/200) for `.single()` when `WITH CHECK` denies a row, not 403. The plan acknowledges "Supabase mapuje na 403/406", but the §7 error table (row 2) only enumerates "406/403" for detection without a deterministic mapping. This is a description fidelity gap vs. api-plan.md, which does not enumerate explicit HTTP codes for the PATCH but relies on PostgrestError code mapping in §9.
- The api-plan §9 stub for `mapPostgrestError` keys `PROFILE_LOCALE_INVALID` off `err.code === '23514' && err.message.includes('locale')`. The implementation plan §3 lists `PROFILE_LOCALE_INVALID` but does not restate the message-substring matcher; an implementer reading only this plan might map any `23514` to that error. Worth restating explicitly in the implementation plan to avoid drift.
- The implementation plan does not mention the `mapAuthError` mapping for `PGRST301` (JWT expired) — §7 row 1 references `error.code === 'PGRST301'`, but api-plan.md §9 routes `PGRST301` through PostgREST (not the auth mapper) and the plan should clarify which mapper is invoked. Minor.

## 2. Consistency with prd.md

### Issues Found

- No issues found.

### Warnings

- US-050 acceptance criterion "Wybór języka jest zapamiętywany między sesjami" is satisfied by persisting `user_profiles.locale` via this endpoint plus the `LocaleGuard` redirect documented in `architecture-base.md` §17. The implementation plan correctly defers the redirect logic to `LocaleGuard` (step 8), but does not explicitly state that *without* `LocaleGuard` shipping, US-050's cross-device persistence is incomplete. Worth flagging as a cross-task dependency in the plan rather than burying it in step 8.
- PRD does not mandate any field other than `locale` for MVP profile updates, which the plan correctly limits via `UpdateProfileCommand`. No PRD requirement is missed.

## 3. Internal Consistency

### Issues Found

- **Step 2 vs §3 type contract mismatch.** Step 2 says: "Zwróć typ z `Promise<PostgrestSingleResponse<Tables<'user_profiles'>>>` (zgodny z native SDK), żeby konsument mógł użyć `mapPostgrestError`." However §3 lists optional return type `UpdateProfileResult = { data: UserProfileDto | null; error: BusinessError | null }`. The plan needs to pick one return contract: raw `PostgrestSingleResponse<Tables<'user_profiles'>>` (matches the api-plan.md stub and §7 "Wrapper zwraca surowy `PostgrestError` w `error`") OR a pre-mapped `{ data, error: BusinessError }`. As written, the §3 "(opcjonalnie)" leaves the contract ambiguous; the rest of the document (§5 data flow, §7 error table, step 2 final line, step 3 client usage `mapPostgrestError(error)`) consistently assumes the **raw** PostgREST response. Recommend removing the optional `UpdateProfileResult` from §3 to eliminate ambiguity.
- **Step 5 Test C contradicts §7 row 4.** §7 row 4 says empty-patch shortcut returns `{ data: <currentProfile?>, error: null }` (no-op) — note the question mark suggesting "current profile maybe". Step 5 Test C asserts `{ data: null, error: null }`. Step 2 implementation also says `{ data: null, error: null }`. The §7 row should be tightened to match the implementation (i.e., `data: null` with no current-profile fetch) — otherwise §7 implies an extra GET round-trip that the plan's "Empty patch shortcut" performance claim (§8) explicitly rules out.

### Warnings

- `.select()` without explicit columns (step 2 final line) returns all columns including `paddle_customer_id`; see §1 warning. This is internally inconsistent with §4's "Mapowanie do `UserProfileDto`. `paddle_customer_id` nie jest wybierany przez DTO i nie powinien być eksponowany do UI." The wrapper should match by passing the explicit column list to `.select(...)`.
- Step 3 uses a regex `pathname.replace(/^\\/(pl|en)/, '')`. The escape `\\/` is template-literal escaping for the regex slash; in actual code this should be `/^\/(pl|en)/`. Minor typographic artifact of markdown but might confuse a copy-paster.
- §6 point 6 says the cookie should not be `httpOnly` because "middleware/`next-intl` musi czytać po stronie klienta i serwera". Server-side reads of `Cookie:` headers work fine with `httpOnly`; only `document.cookie` reads in the browser would fail. Since the plan also writes the cookie via `document.cookie` (step 3), `httpOnly` is correctly omitted, but the rationale is slightly misleading.
- Step 7 schedules a future ESLint rule `no-restricted-syntax` that would block direct `.from('user_profiles').update(...)`. The CLAUDE.md project state lists `errors.ts` and `profile.ts` as "Not yet implemented" — the lint rule cannot ship before the wrapper itself, so step 7 ordering is implicitly post-MVP, which the plan acknowledges. Worth a stronger note that the rule is gated on wrapper rollout.
- §7 row 2 asserts that for an RLS denial "Toast „Brak uprawnień" + log telemetryczny (potencjalna manipulacja)" — but elsewhere PRD/api-plan do not specify a telemetry channel for security events. Sentry is post-MVP. Recommend the plan be explicit that telemetry is `console.error` until Sentry lands, or drop the telemetry claim.
- The plan does not document Vitest test naming conventions or whether `profile.test.ts` should live alongside `profile.ts` (the project uses co-located tests per CLAUDE.md `ipAnonymize.ts` example). Minor.

## 4. Summary

The implementation plan is internally coherent and aligns with both api-plan.md §2.2 (wrapper-based PATCH on `user_profiles`) and PRD US-050 (locale switching). The architectural invariants (`SafeUpdate` type, runtime filter, RLS as primary AuthZ guard, defense-in-depth trigger, `NEXT_LOCALE` cookie + `router.replace` to avoid `LocaleGuard` round-trip) match the broader design. Two correctable issues block clean handoff: (1) step 2 instructs `.select()` without an explicit column projection, which leaks `paddle_customer_id` over the wire and contradicts the DTO contract restated in §4; (2) §3 leaves the wrapper return type ambiguous between raw `PostgrestSingleResponse` and pre-mapped `UpdateProfileResult`, while every other section assumes raw. After tightening these (and aligning §7 row 4 with the empty-patch shortcut behaviour asserted in step 2 / Test C), the plan is safe to hand off; until then it should be returned for a one-pass cleanup.
