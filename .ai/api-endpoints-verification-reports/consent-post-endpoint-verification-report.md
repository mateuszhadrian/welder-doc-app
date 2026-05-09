# Verification Report: POST /api/consent

## Overall Status

PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found

No issues found.

### Warnings

- **Order of validation steps differs slightly from api-plan §2.1 Logika.** The API plan lists session verification (`createServerClient` + `getUser()`) as step 1, then `Idempotency-Key` validation as step 2, then payload validation as step 3. The implementation plan (§5 Data Flow + §9 Krok 2) reverses this — JSON parse → payload shape validation → `auth.getUser()` → `Idempotency-Key` validation — and §9 Krok 2 even justifies it as "cheaper before auth". Because `Idempotency-Key` cache is keyed on `${user.id}:${key}` (per the API plan §7), the user must be known before any cache lookup, so logically the lookup must follow `getUser()`; only the format-regex check could run earlier. This re-ordering is defensible but should be called out explicitly in the implementation plan as an intentional deviation, otherwise reviewers may flag it against §2.1.
- **Idempotency-Key format check error code.** The API plan §2.1 lists `invalid_idempotency_key` as a 400 code; the implementation plan and `ConsentApiErrorCode` type both include it. Consistent — but note that the implementation plan does not specify which error wins if both `invalid_idempotency_key` and `invalid_payload`/`missing_fields` could fire (e.g. malformed body + invalid header). Order of checks should be made explicit so two implementers do not produce divergent behavior.
- **Cache eviction policy.** The API plan §7 mandates 60-second TTL for `Idempotency-Key`. The implementation plan §6 / §8 adds an LRU cap of "~1000 entries per instance" and lazy cleanup, which is reasonable but goes beyond what the API plan documents. Worth a one-line cross-reference back to §7 so the limit does not silently drift.
- **`Pick` of `id`.** Per `api-plan.md` examples, the bundle response includes numeric `id` per item. `ConsentInsertedItemDto` (per `src/types/api.ts` lines 142-147) is `Pick<…>` — the implementation plan should confirm that `Pick` includes `id` (and not just the user-visible columns). Worth a one-line check during code review.

## 2. Consistency with prd.md

### Issues Found

No issues found.

### Warnings

- **US-001 acceptance "Wersja zgody jest zapisywana w bazie danych".** The plan correctly maps this to the bundle path that updates `user_profiles.current_consent_version` via the `record_consent_bundle()` RPC. However, the plan should explicitly note that for `accepted = true` the column is updated, while for `accepted = false` (revocation) it is not — implementation plan §5 mentions this in passing for the per-type path, but for bundle revocation (`types: [...]` + `accepted: false`) this edge case is not described in the response section. It is implicitly handled (the response reads the current DB value rather than echoing the payload), but a one-line note would prevent confusion.
- **US-051 cookie consent banner.** The plan supports the per-type withdrawal flow needed to satisfy US-051's "user may accept or reject cookies (not mandatory)". The implementation plan correctly states per-type does not bump `current_consent_version`. Verified.
- **PRD §3.10 "checkbox zgody przy rejestracji z zapisem wersji zgody".** Implementation plan satisfies this through the bundle path. No issue.

## 3. Internal Consistency

### Issues Found

No issues found.

### Warnings

- **§9 Krok 2 vs §5 Data Flow — Idempotency-Key check ordering.** §5 Data Flow shows `Idempotency-Key` validation in step [4], **after** `auth.getUser()` in step [3]. §9 Krok 2 says "Kolejność walidacji: **przed** `auth.getUser()` (cheaper)". These two sections contradict each other. Recommend: keep the format-regex (cheap, no DB) before `getUser()`, but the cache lookup (which needs `user.id`) must be after — as already shown in §9 Krok 4. The plan should be edited so §5 and §9 Krok 2 agree on this split.
- **§3 vs §9 Krok 1 — local helper definitions.** §3 says "Lokalnie w handlerze **nie** wprowadzać własnych typów `BundleBody` / `SingleBody`". §9 Krok 1 says to delete `BundleBody`, `SingleBody`, `CONSENT_TYPES`, `ConsentType`, `isConsentType` and re-add only `const CONSENT_TYPES: readonly ConsentType[] = [...]`. Consistent in spirit, but reviewers may notice that `isConsentType` is also a local helper that survives implicitly; §9 Krok 1 should clarify whether `isConsentType` stays (probably yes — it is a runtime guard derived from the runtime `CONSENT_TYPES` constant, not a duplicate type).
- **§7 logging guidance.** "Nigdy nie logować surowego `request.body`, `user_id`, ani anonimizowanego IP". Listing `user_id` alongside the others is correct policy, but worth noting that the only logged fields (`code`, `hint`, `path: err.code`) explicitly redact identifiers. The third bullet `path: err.code` is suspicious — `err.code` is the Postgres SQLSTATE, not a path; the property name `path` looks copy-pasted. Recommend clarifying or renaming (`pgCode: err.code`) to avoid implementer confusion.
- **§9 Krok 6 — `BusinessError` enum reference.** The example references `BusinessError.UnauthorizedConsentTarget` but `api-plan.md` §9 lists the enum member as `CONSENT_TARGET_UNAUTHORIZED` (SCREAMING_SNAKE_CASE). The future `errors.ts` file will define one canonical name; the implementation plan example uses the wrong casing. Once `errors.ts` is implemented, update the example to match.
- **§5 Data Flow — diagram step [5] vs §9 Krok 2/4 ordering.** Step [5] ("Anonimizacja IP") in the data flow runs after the idempotency lookup. If the cache hit returns the original response without ever inserting, that is fine — but the diagram should explicitly mark step [5]+ as "skipped on cache hit" to avoid the implementer running anonymization unconditionally.

## 4. Summary

The implementation plan is comprehensive, correctly aligned with `api-plan.md` §2.1 (HTTP method, URL, body XOR, response shapes, all status codes, security and IP-anonymization invariants) and fully addresses the PRD acceptance criteria for US-001 (registration consent bundle), US-051 (cookie banner per-type), and §3.10 GDPR minimum. The route handler already exists and matches the plan; the remaining work (idempotency cache, type imports from `@/types/api`, error mapping via `errors.ts`) is correctly scoped. The only blockers worth fixing before development pickup are the small internal contradiction between §5 (data flow ordering) and §9 Krok 2 (claim that idempotency check runs before `auth.getUser()`), and a few cosmetic clarifications (logged-field naming, `BusinessError` casing). None of these are blocking — the plan is safe to hand off after a short editing pass.
