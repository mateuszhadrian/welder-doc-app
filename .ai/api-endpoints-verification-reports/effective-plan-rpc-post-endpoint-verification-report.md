# Verification Report: POST /rest/v1/rpc/effective_plan

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md

### Issues Found
- **`BusinessError` enum members named in §7 do not exist in `api-plan.md` §9.1.** The implementation plan references `BusinessError.Unauthorized`, `BusinessError.InvalidPayload`, `BusinessError.NetworkError`, and `BusinessError.UnexpectedResponse` (PascalCase). The canonical enum in `api-plan.md` §9.1 uses SCREAMING_SNAKE_CASE keys (`UNAUTHORIZED`, `RATE_LIMITED`, `NETWORK_ERROR`, `UNKNOWN`) and does **not** define `InvalidPayload` or `UnexpectedResponse` at all. Either: (a) align the wrapper to use `BusinessError.UNAUTHORIZED` / `BusinessError.NETWORK_ERROR` / `BusinessError.UNKNOWN` (folding `UnexpectedResponse` and `InvalidPayload` into `UNKNOWN`), or (b) extend `api-plan.md` §9.1 to add `INVALID_PAYLOAD` and `UNEXPECTED_RESPONSE` and update the casing convention. Without one of those, this plan cannot be implemented as written without diverging from §9.1.
- **§7 maps PostgREST `PGRST301` to "no session / expired JWT".** `api-plan.md` §9.1's `mapPostgrestError` does not handle `PGRST301` — the wrapper would currently get `BusinessError.UNKNOWN` from the shared mapper. Either the shared mapper must be extended (cross-cutting change to `errors.ts` blueprint) or this RPC wrapper must add a local pre-check before delegating. Worth calling out as a prerequisite/cross-cutting follow-up.

### Warnings
- HTTP method, URL structure, body shape (`{ uid: UUID }`), 200 scalar response body (`"pro"` | `"free"`), and the 401/500 error codes all match §2.2 (and the data file).
- The PostgreSQL function definition mirrored in §5/§9.1 of the implementation plan is byte-identical with `api-plan.md` §4 ("Efektywny plan użytkownika") and the migration `20260507000000_complete_schema.sql` referenced in CLAUDE.md.
- §6.1 of the plan states `GRANT EXECUTE ON FUNCTION public.effective_plan(uuid) TO authenticated` "must be confirmed; if missing, add a follow-up migration." `api-plan.md` does not explicitly enumerate the GRANT, but it is implied by the SDK call from an `authenticated` session. Worth a one-line addition to `api-plan.md` §4 ("Efektywny plan...") for completeness.
- §8.4 introduces a "soft client-side throttle (≥ 1500 ms per session)" inside the wrapper. `api-plan.md` §6.2 lists "brak" rate limit for RPC paths and treats throttling as a TODO via Upstash. A hard-coded throttle in shared `lib/` code is acceptable hygiene but should be flagged in `api-plan.md` for consistency, otherwise future developers may strip it as undocumented.
- §9.5 wires the RPC into `src/app/[locale]/(billing)/checkout-return/page.tsx`. The page does not yet exist (CLAUDE.md "Currently implemented" inventory does not list it). The implementation plan correctly notes "to be created in the Paddle Checkout US" — make sure the call-site is treated as belonging to that ticket, not this one.

## 2. Consistency with prd.md

### Issues Found
No issues found.

### Warnings
- US-045 ("Upgrade do planu Pro") states "Po udanej płatności plan użytkownika jest zaktualizowany do Pro" but does not prescribe the mechanism. The implementation plan's choice — read-after-checkout via `effective_plan` RPC with 200 ms / 600 ms / 1800 ms backoff retries and graceful fallback to the `user_profiles.plan` cache — is a sound interpretation that matches the user-perceivable behaviour required by US-045 (post-checkout the badge must show Pro within seconds even if the webhook hasn't fired yet).
- PRD §3.10 (RODO) and CLAUDE.md note Frankfurt EU pinning. The implementation plan's "~50–80 ms typical" latency budget assumes Vercel `fra1` ↔ Supabase EU-Frankfurt colocation — consistent with project guardrails.
- The "binary Pro/Free leak" risk acceptance in §6.2 (any authenticated user can pass any UUID) is consistent with the PRD's threat model — no PII or business secret is exposed. The decision to defer the `auth.uid()` guard to post-MVP is reasonable but should be tracked. Recommend adding it to the existing post-MVP backlog explicitly.

## 3. Internal Consistency

### Issues Found
- **§4 vs §7 mismatch on null result.** §4 says "`data === null` (on error)" — implying a null only occurs when `error` is set. §7's last row says "`data === null` despite no error → `BusinessError.UnexpectedResponse` → fall back to cached `user_profiles.plan`". These two statements are reconcilable but the README-style §4 description should explicitly call out the "should never happen but handled defensively" case to avoid implementation drift. Currently §4 reads as if null-and-no-error cannot happen; §7 then handles it.
- **§3 wrapper return type vs §9.3 step description.** §3 declares `fetchEffectivePlan(...): Promise<UserPlan>` (throws on any non-happy path). §9.3 then says: "throw a typed error or return a discriminated result type — match the convention used by `updateProfile()` once that lands; until then return `Promise<UserPlan>` and throw an `Error` with `cause` containing the `BusinessError`." This is two competing futures presented in one plan. Pick one explicitly, or commit to "throws now; refactor when `errors.ts` and `updateProfile` land" as a single sentence so the developer doesn't choose at random.
- **§9.3 says "validate `userId` is a non-empty UUID-shaped string (regex match — fail fast before round-trip)" but §6.4 just says "non-empty string."** Step §9.3 silently strengthens §6.4 from non-empty to UUID-regex. Tighten §6.4 to match §9.3, or relax §9.3.

### Warnings
- §9.4's `assertIsUserPlan` placement is ambiguous ("in `plan.ts` or in `src/types/api.ts`"). Pick one. Since `UserPlan` already lives in `src/types/api.ts:14`, co-locating the type guard there is the natural choice and matches CLAUDE.md's "Shape Registry / single source of truth" ethos.
- §8.4 says "do not memoise across component remounts — every call must hit the DB. Acceptable to memoise for the lifetime of one component instance to prevent double-fire in StrictMode." This contradicts §8.3's "single call in `checkout-return/page.tsx` (Server Component)" — Server Components don't have StrictMode component-instance memoisation semantics. Either drop the StrictMode caveat or move the call-site discussion to client-side fallbacks (e.g. a "refresh plan" button in account settings). The two paragraphs target different runtimes and the plan should split them.
- §9.6 (Vitest integration test) and §9.7 (Playwright smoke test) belong to two different scopes (this PR vs the Paddle Checkout PR). Step §9.7 should be marked "deferred to US-045 PR" so a reviewer doesn't block the merge of this wrapper waiting for an e2e harness that depends on Paddle being wired.
- §9.1 says "if missing, add a new migration `2026XXXXXXXXXX_grant_effective_plan_authenticated.sql`" — confirm before merge by inspecting the migration file rather than only running `select pg_get_functiondef(...)`, since `pg_get_functiondef` does not include `GRANT` statements. Add an explicit `\dp public.effective_plan` (or a `pg_proc.proacl` query) to the verification checklist in §9.10.

## 4. Summary

The plan is technically sound and faithful to the data model, the RPC's purpose (cache-bypass on post-checkout return), and the established Supabase / `fra1` infrastructure. Status is **PASSED WITH WARNINGS**: there are no architectural defects, but the wrapper cannot be merged as written without resolving the `BusinessError` naming/enum mismatch with `api-plan.md` §9.1 — that is a real blocker for the developer assigned to this ticket because it forces them to silently invent enum members that don't exist in the canonical mapper. Once the enum naming is reconciled (and the minor `null`-handling and `userId`-validation contradictions in §4/§6/§7/§9.3 are tightened into a single statement), the plan is safe to hand off.
