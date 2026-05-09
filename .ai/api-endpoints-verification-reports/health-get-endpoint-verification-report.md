# Verification Report: GET /api/health

## Overall Status
PASSED WITH WARNINGS

## 1. Consistency with api-plan.md
### Issues Found
No issues found.

### Warnings
- **Timestamp format precision.** `api-plan.md` §`GET /api/health` shows the example timestamp without milliseconds (`"2026-05-08T12:00:00Z"`), while the implementation plan uses `new Date().toISOString()` which always includes milliseconds (`"2026-05-08T12:00:00.000Z"`). Both are valid ISO 8601 UTC strings, but if any monitor or contract test does an exact-string match against the api-plan example it will fail. Worth a one-line note in the contract test (krok 7.3) that the timestamp regex must accept the millisecond variant.
- **Rate limiting target stated but deferred.** `api-plan.md` §6.2 lists `GET /api/health` with target `60 / min / IP (DDoS guard)`. The implementation plan correctly mirrors this in §6.3 / §9.2 step 9 as a follow-up TODO. Not a discrepancy, but the plan's "Definition of Done" §9.3 leaves it unchecked — confirm with PM whether MVP can ship without it (api-plan.md classifies it as TODO before production, so the gap is acknowledged).

## 2. Consistency with prd.md
### Issues Found
No issues found.

### Warnings
- The PRD does not mention `/api/health`, monitoring, liveness/readiness probes, or Vercel Deploy Checks at all. This is expected because `/api/health` is infrastructure plumbing, not a user-facing feature, and the api-plan.md §6.1 access matrix explicitly classifies it as `Publiczny` (no auth, no business rules). No PRD acceptance criteria need to be reflected here. Worth confirming with the team that "infra-only endpoint, no PRD coverage required" is acceptable for the PR review checklist.

## 3. Internal Consistency
### Issues Found
No issues found.

### Warnings
- **§7 error table mentions an HTML 500 path.** Row 1 of the error table says misconfigured Supabase env vars cause `createClient()` to throw and bubble to Next.js as a default 500 HTML page. This contradicts the contract goal stated in §4.3 ("Wewnętrzne błędy są mapowane na `503 degraded`, by ujednolicić kontrakt monitorowania"). If a monitor sees an HTML 500 it cannot parse the JSON body and the whole "uniform monitoring contract" breaks. Recommendation: wrap the probe in `try/catch` and map any thrown error to the same `503 degraded` JSON envelope, or document this 500 case as an accepted deploy-time failure mode that callers must tolerate.
- **§9.2 step 7 (Vitest) vs §9.3 Definition of Done.** Step 7 spells out four unit tests, but the DoD checklist in §9.3 does not include a "unit tests written" item beyond the unchecked "Pokrycie testami (Vitest unit) — krok 7" line. Minor: tighten the DoD so the four cases (happy path, DB error → 503, ISO timestamp shape, no `error.message` leak) are individually checkable.
- **§9 numbering.** Section 9.2 starts at step 7 and ends at step 11, but the heading reads "Pozostałe kroki" with no explicit count. Cosmetic only; the steps themselves are coherent.
- **Region claim in §8.2.** The latency table assumes Vercel `fra1` ↔ Supabase EU-Frankfurt collocation. This is correct per `vercel.json` and CLAUDE.md ("Vercel region is pinned to `fra1`"), so the claim holds — but the implementation plan does not point at `vercel.json` or the `tech-stack.md` clause that pins it. A one-line cross-reference would harden the spec.
- **§5.1 "documents probe" rationale is sound but couples health to RLS.** If a future migration ever changes the `documents` RLS policy (e.g. adds a JOIN that errors for anon clients), the health probe will start returning 503 even though the DB itself is fine. The plan correctly notes RLS-without-session returns 0 rows without error today; consider adding a regression assertion (a Vitest test that hits the actual local Supabase, not just a mock) as a follow-up to detect that drift early.

## 4. Summary
The implementation plan is internally coherent and faithfully matches the `api-plan.md` contract for `GET /api/health` (HTTP method, URL, public access, both 200 and 503 response shapes, the `HealthCheckResponseDto` interface, and the rate-limiting target). The endpoint has no PRD coverage by design — it is infrastructure, not a user story. The only substantive concern is the §7 fallback to a default Next.js 500 HTML page on `createClient()` throw, which silently violates the "uniform JSON envelope" contract that the rest of the plan is built around; wrapping the probe in `try/catch` would close the gap. The remaining warnings (timestamp millisecond precision, deferred rate limiting, DoD checklist tightening, region cross-reference, RLS-coupling regression test) are non-blocking. The plan is safe to hand to development for the implemented portion (steps 1-6, already merged in `406aae7`) and for the follow-up tickets (steps 7-11), provided the §7 throw-path is hardened before production.
