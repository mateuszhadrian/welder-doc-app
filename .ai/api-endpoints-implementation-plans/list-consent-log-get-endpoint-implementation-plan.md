# API Endpoint Implementation Plan: GET /rest/v1/consent_log (List Consent Log)

## 1. Endpoint Overview

Read-only endpoint exposing the authenticated user's RODO consent history (TOS, Privacy Policy, cookies) as an append-only audit trail. The endpoint is **not** a custom Next.js Route Handler — it is a direct PostgREST query issued from client/server code through `@supabase/supabase-js`. RLS scopes results to `auth.uid()`, so no application-level authorization layer is required.

Primary consumers:

- Privacy settings page (`src/app/[locale]/settings/privacy/...`) — renders consent history and reconstructs the latest decision per consent type.
- `GET /api/user/export` (RODO art. 20) — embeds the same payload in `UserExportDto.consent_log`.
- RODO art. 7 §1 audit cross-check: every value of `user_profiles.current_consent_version` corresponds to a bundle of rows in `consent_log`.

Because the table is structurally append-only (no UPDATE/DELETE policies, INSERT is funneled exclusively through `POST /api/consent`), the read path is the only consumer interface — no business validation is required on input.

## 2. Request Details

- **HTTP Method:** `GET` (issued by `supabase-js` against PostgREST under the hood; the application code uses the SDK fluent API, not a hand-rolled `fetch`).
- **URL Structure (PostgREST):**
  ```
  GET /rest/v1/consent_log
    ?user_id=eq.{uid}
    &select=consent_type,version,accepted,accepted_at
    &order=accepted_at.desc
  ```
- **SDK call (canonical form):**
  ```typescript
  const { data, error } = await supabase
    .from('consent_log')
    .select('consent_type, version, accepted, accepted_at')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })
  ```
- **Parameters:**
  - **Required (logical):** active Supabase session — provides `auth.uid()` evaluated by RLS.
  - **Optional (technical, supplied by SDK):**
    - `user_id=eq.{uid}` — redundant given RLS but kept for query-plan determinism (uses the `consent_log_user_id_type_accepted_at_idx` index).
    - `select=consent_type,version,accepted,accepted_at` — explicit projection (excludes `id`, `user_id`, `ip_address`, `user_agent` from the wire payload; minimizes data exposure and bytes).
    - `order=accepted_at.desc` — newest first; matches the index.
- **Request Body:** none (GET).
- **Headers:** standard Supabase headers attached automatically by the SDK (`apikey`, `Authorization: Bearer <jwt>`).

## 3. Used Types

Defined in `src/types/api.ts` (already present; no new types required):

```typescript
// Single consent_log row returned to the client (ip_address intentionally omitted).
export type ConsentLogItemDto = Pick<
  Tables<'consent_log'>,
  'consent_type' | 'version' | 'accepted' | 'accepted_at'
>
```

Supporting literal type (already exported):

```typescript
export type ConsentType = 'terms_of_service' | 'privacy_policy' | 'cookies'
```

Notes:

- The endpoint specification mentions an `ip_address` wrapper (`Omit<Tables<'consent_log'>, 'ip_address'> & { ip_address: string | null }`) for callers that select the column. This wrapper is **not used here** — the projection (`select(...)`) explicitly excludes `ip_address`. Keeping the projection narrow avoids the `unknown` typing problem entirely.
- No new Command Models are needed — this is a query, not a mutation. Mutations live in the consent POST endpoint.

Helper return shape (recommended for callers, defined in service layer):

```typescript
export type ListConsentLogResult =
  | { ok: true; data: ConsentLogItemDto[] }
  | { ok: false; error: { business: BusinessError; message: string } }
```

(`BusinessError` and the `mapPostgrestError` helper come from `src/lib/supabase/errors.ts` — currently a TODO per `CLAUDE.md`. The service stub below assumes it has been implemented per `api-plan.md` §9; if it hasn't, ship the service first and wire the typed mapper as part of that follow-up.)

## 4. Response Details

- **200 OK**
  - Body: `ConsentLogItemDto[]`, sorted by `accepted_at` DESC.
  - Empty result is a successful empty array `[]` (not 404). This is correct because the user exists (RLS evaluated `auth.uid()` successfully) but has no consent rows yet — possible only in pathological migration states; the registration flow guarantees at least three rows.
- **401 Unauthorized** — no session.
  - PostgREST returns this for missing/invalid JWT. Surfaced by `supabase-js` as `error.code === 'PGRST301'` or `status === 401`. Application maps to `BusinessError.unauthorized`.
- **500 Internal Server Error** — DB-level failure (connection drop, RLS evaluation panic, etc.).
  - Mapped via `mapPostgrestError` to `BusinessError.internal_error`.

Example body (200):

```json
[
  {
    "consent_type": "terms_of_service",
    "version": "1.0",
    "accepted": true,
    "accepted_at": "2026-01-01T00:00:00Z"
  },
  {
    "consent_type": "cookies",
    "version": "1.0",
    "accepted": false,
    "accepted_at": "2026-03-01T00:00:00Z"
  }
]
```

State reconstruction (client-side):

```typescript
const latestCookies = consentLog.find((c) => c.consent_type === 'cookies')?.accepted
```

## 5. Data Flow

```
[React component / Server Component / /api/user/export]
            │
            │ calls
            ▼
[src/lib/supabase/consentLog.ts → listConsentLog(supabase, userId?)]
            │
            │ supabase-js fluent call
            ▼
[Supabase PostgREST]
            │
            │ executes:
            │ SELECT consent_type, version, accepted, accepted_at
            │ FROM public.consent_log
            │ WHERE user_id = auth.uid()
            │ ORDER BY accepted_at DESC
            │ -- index used: consent_log_user_id_type_accepted_at_idx
            ▼
[Postgres → RLS policy `consent_log_select_authenticated`]
            │
            │ rows filtered by user_id = auth.uid()
            ▼
[PostgREST] → JSON array
            │
            ▼
[supabase-js] → { data, error }
            │
            ▼
[Service]   → maps error via mapPostgrestError, returns ListConsentLogResult
            │
            ▼
[Caller]    → renders / embeds in export
```

Key DB facts (from `db-plan.md` and the spec):

- Table: `public.consent_log` (BIGSERIAL `id`, `user_id` UUID FK to `auth.users` with `ON DELETE CASCADE`, `consent_type` CHECK in (`terms_of_service`, `privacy_policy`, `cookies`), `version` TEXT, `accepted` BOOLEAN, `accepted_at` TIMESTAMPTZ default now(), `ip_address` INET nullable, `user_agent` TEXT nullable).
- Index: `consent_log_user_id_type_accepted_at_idx (user_id, consent_type, accepted_at DESC)` — supports both the full list-DESC and any "latest per type" filtering done client-side.
- RLS: SELECT/INSERT only, both scoped to `user_id = auth.uid()`. No UPDATE, no DELETE — append-only is enforced by absence of policies, not by a trigger.

Caller patterns:

1. **Server Component (privacy settings page):**
   ```typescript
   const supabase = await createClient() // src/lib/supabase/server.ts
   const result = await listConsentLog(supabase)
   ```
2. **Client Component (interactive privacy page):**
   ```typescript
   const supabase = createClient() // src/lib/supabase/client.ts
   const result = await listConsentLog(supabase)
   ```
3. **`GET /api/user/export` Route Handler:** uses the server client (already authenticated by cookie); embeds `result.data` in `UserExportDto.consent_log`.

## 6. Security Considerations

- **Authentication:** required. `supabase-js` attaches the JWT from cookies (server) or local storage (browser). Without a session, PostgREST returns 401 before RLS even runs.
- **Authorization (RLS):** `consent_log_select_authenticated` filters every SELECT to `user_id = auth.uid()`. This is the only authorization barrier — even if a malicious caller passes someone else's `user_id` in `.eq('user_id', ...)`, RLS intersects with `auth.uid()` and returns an empty set.
- **Service role MUST NOT be used here.** This endpoint is user-scoped; using `createAdminClient()` would bypass RLS and is a security regression. The service helper signature should accept the typed `SupabaseClient<Database>` of either client/server flavor — never an admin client.
- **Column projection:** the explicit `.select('consent_type, version, accepted, accepted_at')` excludes `ip_address` (a privacy-sensitive INET) and `user_agent`. These are stored only for audit traceability and are not part of the user-visible payload. Even though RLS allows reading them (because RLS is row-level, not column-level), the application enforces column-level minimization at the SDK layer. `GET /api/user/export` follows the same projection per `api-plan.md` §6.
- **Append-only invariant:** there is no UPDATE/DELETE on `consent_log`, so this read endpoint cannot be combined with a mutation to leak data. The only risk surface is INSERT via `POST /api/consent`, which is out of scope here.
- **CASCADE on user delete (RODO art. 17):** when `auth.users` is hard-deleted via `DELETE /api/user/account`, `ON DELETE CASCADE` removes the user's `consent_log` rows. After deletion this endpoint will return 401 for the deleted user (no session) — no orphan data.
- **No PII echoed in errors:** the `mapPostgrestError` helper must produce i18n-key error messages, not raw Postgres error strings, to avoid leaking schema information.
- **Rate limiting:** none. Read-only, low-cost (small index range scan); no additional throttling beyond Supabase's defaults. The expensive sibling `GET /api/user/export` has its own quota (1/min/user, 5/day/user per `api-plan.md` §11).

## 7. Error Handling

| Scenario | Detection | HTTP / SDK signal | App-level outcome |
|---|---|---|---|
| No session (cookie missing/expired) | `error.code === 'PGRST301'` or `error.status === 401` | 401 | Return `{ ok: false, error: { business: 'unauthorized', message: 'errors.unauthorized' } }`; caller redirects to `/[locale]/login`. |
| RLS rejected (impossible by construction; defensive) | `error.code === 'PGRST116'` (zero rows in single-row context — N/A here since we expect array) or empty result | 200 with `[]` | Return `{ ok: true, data: [] }`; UI shows "no consent history" copy. |
| DB unavailable / network drop | `error.message` matches transport class; no `error.code` from PostgREST | 5xx | Return `{ ok: false, error: { business: 'internal_error', message: 'errors.db_unavailable' } }`; caller renders fallback + `Sentry.captureException` (when Sentry lands). |
| Schema drift (column missing) | `error.code === '42703'` | 500 | Same as DB unavailable; treat as `internal_error` and log loudly — indicates types are stale (`pnpm supabase:types`). |
| User deleted between session refresh and query | RLS yields `[]` | 200 with `[]` | Same as no-session in practice; layout-level guard catches this on next request. |

Logging:

- Errors must be logged at the service layer via `console.error` (development) and the future Sentry hook (production). Do not log `data` on success — the payload contains user consent history.
- No dedicated `error_log` table is involved (the `webhook_events` audit table is unrelated; consent reads do not produce audit rows).

Status code mapping (when the result is bridged to a Route Handler such as `/api/user/export`):

- success → 200 OK with array body
- `unauthorized` → 401
- `internal_error` → 500

## 8. Performance Considerations

- **Index utilization:** `consent_log_user_id_type_accepted_at_idx (user_id, consent_type, accepted_at DESC)` covers the WHERE + ORDER BY. Postgres performs an index range scan. For typical users (3–10 rows total), this is sub-millisecond.
- **Result size:** bounded — three consent types × small number of changes per user. No pagination needed in MVP. If a user spam-toggles cookies, growth is still linear and capped by UI flow.
- **Network payload:** minimized by explicit `.select(...)` projection (4 columns × ~80 bytes/row).
- **Caching:** none on the server. Client-side, the privacy settings page is a Server Component that re-fetches on each navigation; the export endpoint embeds fresh data per request. Adding a SWR/React Query layer is out of scope until the page is implemented.
- **N+1 risk:** none — single round-trip per call.
- **Cold-start cost on Vercel Fluid Compute:** negligible; the only thing the function imports is the Supabase client (already cached by other routes in the same warm instance).
- **Coverage budget:** the `src/lib/supabase/` directory has the project's strictest thresholds (lines 80, branches 70 — `vitest.config.ts`). The service helper should ship with unit tests covering the success, error, and projection-shape paths (use `vi.mock('@supabase/supabase-js')` and stub the fluent chain).

## 9. Implementation Steps

1. **Confirm prerequisites.**
   - `src/types/database.ts` already contains `consent_log` typings (regenerate via `pnpm supabase:types` if anything looks stale).
   - `src/types/api.ts` already exports `ConsentLogItemDto` and `ConsentType` — no changes needed.
   - Verify that `src/lib/supabase/errors.ts` (`BusinessError` + `mapPostgrestError`) is implemented; if not, implement it per `api-plan.md` §9 first. This is a known TODO in `CLAUDE.md` and is a hard dependency for typed error handling here.

2. **Create the service helper `src/lib/supabase/consentLog.ts`.**
   - Export a single function `listConsentLog`:
     ```typescript
     import type { SupabaseClient } from '@supabase/supabase-js'
     import type { Database } from '@/types/database'
     import type { ConsentLogItemDto } from '@/types/api'
     import { mapPostgrestError, type BusinessError } from '@/lib/supabase/errors'

     export type ListConsentLogResult =
       | { ok: true; data: ConsentLogItemDto[] }
       | { ok: false; error: { business: BusinessError; message: string } }

     export async function listConsentLog(
       supabase: SupabaseClient<Database>,
     ): Promise<ListConsentLogResult> {
       const { data, error } = await supabase
         .from('consent_log')
         .select('consent_type, version, accepted, accepted_at')
         .order('accepted_at', { ascending: false })

       if (error) {
         return { ok: false, error: mapPostgrestError(error) }
       }
       // PostgREST + .select() always yields ConsentLogItemDto[] thanks to the projection.
       return { ok: true, data: data ?? [] }
     }
     ```
   - Do **not** add `.eq('user_id', userId)` — RLS handles it, and forcing a `userId` argument introduces a footgun (callers might pass the wrong id). If a future caller really needs a specific user (impossible here under RLS, but the pattern matters for future admin tools), extend the signature with an explicit `adminClient` overload — never sneak it in by parameter.
   - Type the function signature against `SupabaseClient<Database>` (works for both `client.ts` and `server.ts` flavors).

3. **Wire the helper into call sites.**
   - **Privacy settings page** (when implemented): import `listConsentLog` and `createClient` from `@/lib/supabase/server`, render history grouped by `consent_type` with the latest entry per group highlighted. All UI strings live in `src/messages/{pl,en}.json` (no hardcoded text).
   - **`GET /api/user/export` Route Handler:** import the same helper, embed `result.data` into `UserExportDto.consent_log`. The export endpoint already exists per `CLAUDE.md`; refactor it to consume the helper instead of inline querying so behavior stays in sync.

4. **Unit tests `src/lib/supabase/consentLog.test.ts` (Vitest).**
   - Mock `SupabaseClient` with a fluent stub that returns `{ data, error }` from `.order()`.
   - Cases:
     1. success path with two rows → assert `ok: true` and identical array.
     2. empty path → assert `ok: true, data: []` (and not `null`).
     3. PostgREST 401 error (`{ status: 401, code: 'PGRST301' }`) → assert `ok: false` and `business === 'unauthorized'`.
     4. Generic 500 (`{ status: 500, code: '08006' }` connection failure) → assert `business === 'internal_error'`.
     5. Projection sanity: assert the call site invoked `.select('consent_type, version, accepted, accepted_at')` exactly (no `ip_address`).
   - Aim for the 80/70/80/80 coverage thresholds enforced for `src/lib/**`.

5. **Documentation cross-checks.**
   - No update to `vercel.json` or `pnpm verify:routes` — this endpoint is not a Route Handler, so the verify script does not need to know about it.
   - No new migrations — schema is already in place (`20260507000000_complete_schema.sql` defines the table, RLS, and the index).
   - No new env vars beyond `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already provisioned).

6. **Defense-in-depth review (optional, low priority).**
   - Per `api-plan.md` §10, consider tightening the SELECT policy to `AND email_confirmed_at IS NOT NULL` if magic-link unconfirmed accounts ever become a concern. Not required for MVP — the registration flow wires consent only after email confirmation.
   - Confirm the projection is the only column set used by both privacy UI and `/api/user/export`; if either consumer needs `ip_address` later, add a separate admin-scoped helper rather than widening this one.

7. **Hand-off checklist (PR review).**
   - Helper file added under `src/lib/supabase/consentLog.ts` with strict typing (`SupabaseClient<Database>`).
   - Unit tests pass with coverage above threshold.
   - No direct `supabase.from('consent_log').select(...)` calls remain outside the helper (grep before merge).
   - `pnpm typecheck`, `pnpm lint`, `pnpm test:run` clean.
   - Commit message follows Conventional Commits (`feat(api): add listConsentLog helper`).
