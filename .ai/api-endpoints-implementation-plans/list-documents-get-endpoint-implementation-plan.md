# API Endpoint Implementation Plan: GET /rest/v1/documents (List Documents)

> Source spec: `.ai/api-endpoints-data/list-documents-get-endpoint-data.md`
> Cross-references: `.ai/api-plan.md` §2.2 (SDK operations), §3 (Auth), §9 (Error Mapping); `.ai/architecture-base.md` §15 (DB schema), §17 (locale guard); `CLAUDE.md` (Zustand conventions, Supabase client variants).

## 1. Endpoint Overview

Returns a paginated, sorted list of the authenticated user's documents (canvas projects) — used by the dashboard / project list UI (US-008, US-010). The `data` JSONB blob is intentionally excluded from this response: it can reach 5 MB per row and is fetched separately by `GET /rest/v1/documents?id=eq.{id}` for the canvas editor.

This endpoint is **not** a custom Route Handler. It is invoked **directly via the Supabase JS SDK** against PostgREST. There is no file under `src/app/api/` to create. Integration is implemented as a typed data-access helper plus a thin client/server consumer (Server Component for SSR-rendered list, Client Component if the list needs runtime mutation/re-fetch). Authorization is enforced by Postgres Row-Level Security (RLS), not by application code.

Key invariants:
- RLS already filters by `auth.uid()` AND `email_confirmed_at IS NOT NULL` — unconfirmed users see an empty array, never a 401 from PostgREST.
- The hot-path index `documents_owner_id_updated_at_idx (owner_id, updated_at DESC)` covers the default sort.
- `data` MUST never appear in `select` for this list view.

## 2. Request Details

- **HTTP Method:** `GET`
- **URL Structure (PostgREST):**
  ```
  GET /rest/v1/documents
    ?select=id,name,created_at,updated_at
    &owner_id=eq.{uid}
    &order=updated_at.desc
    &limit=50
    &offset=0
  ```
- **SDK call (canonical form, used in code):**
  ```typescript
  const { data, error, count } = await supabase
    .from('documents')
    .select('id, name, created_at, updated_at', { count: 'exact' })
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)
  ```
- **Required headers (set by the SDK automatically):**
  - `Authorization: Bearer <access_token>` — from cookies (`@supabase/ssr` server client) or in-memory session (browser client).
  - `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`.
  - `Prefer: count=exact` — added by the SDK when `{ count: 'exact' }` is passed; produces `Content-Range` response header.

### Parameters

- **Required (caller-side, not URL):**
  - An authenticated Supabase session (cookies for SSR; in-memory for the browser client). Without it, RLS yields zero rows.
- **Optional (caller-controlled):**
  - `userId: string` — `auth.uid()` value, passed to `.eq('owner_id', userId)`. Redundant with RLS but kept for query-plan clarity and easier debugging.
  - `limit: number` (default `50`, recommended bounds `1..100`).
  - `offset: number` (default `0`, must be `>= 0`).
  - `sort: 'updated_at_desc' | 'name_asc' | 'created_at_desc'` (default `'updated_at_desc'`). Mapped to `.order(column, { ascending })` inside the helper — no raw `order` string from the UI to avoid PostgREST injection of unsupported columns.

- **Request Body:** none (GET).

## 3. Used Types

All types already exist in `src/types/api.ts`. **No new DTOs needed.**

- `DocumentListItemDto` — row shape returned to the UI:
  ```typescript
  Pick<Tables<'documents'>, 'id' | 'name' | 'created_at' | 'updated_at'>
  ```
- `MappedError` / `BusinessError` from `src/lib/supabase/errors.ts` (TODO — to be added by the global errors task; this endpoint only needs `mapPostgrestError`).

New helper-internal types (introduced inside the data-access helper, not exported as DTOs):

```typescript
export type ListDocumentsSort = 'updated_at_desc' | 'name_asc' | 'created_at_desc';

export interface ListDocumentsParams {
  userId: string;
  limit?: number;       // default 50, clamped to [1, 100]
  offset?: number;      // default 0, clamped to [0, +inf]
  sort?: ListDocumentsSort; // default 'updated_at_desc'
}

export interface ListDocumentsResult {
  items: DocumentListItemDto[];
  total: number;        // from `count` (exact)
  limit: number;
  offset: number;
}
```

## 4. Response Details

### 200 OK — body
```json
[
  {
    "id": "0a3d...-uuid",
    "name": "Złącze T 1",
    "created_at": "2026-05-01T10:00:00Z",
    "updated_at": "2026-05-08T09:30:00Z"
  }
]
```

### 200 OK — relevant headers
- `Content-Range: 0-49/3` — `<offset>-<offset+returned-1>/<total>`. Present because the SDK call uses `{ count: 'exact' }`. The helper exposes `total` derived from `count` instead of forcing the consumer to parse this header.

### Empty result
- `[]` with HTTP 200 and `Content-Range: */0` — applies when the user has zero documents OR the user is not email-confirmed (RLS hides everything).

### Error responses (PostgREST default shape)
PostgREST returns:
```json
{ "code": "PGRSTxxx", "message": "...", "details": null, "hint": null }
```
The SDK delivers this as `{ data: null, error: PostgrestError }`. The helper converts it to `MappedError` and re-throws or returns `{ error }` per the consumer pattern.

Status code mapping handed to the caller / route consumer:
- `200` — success (including empty list).
- `400` — malformed input that escapes client-side validation (e.g. negative `offset`, non-integer `limit`). Caught by helper guard, never reaches PostgREST.
- `401` — only if no session is present and the consumer is a Route Handler that explicitly checks `auth.getUser()`. PostgREST itself responds `200` + `[]` because of RLS.
- `500` — unexpected DB / network failure (`error.code` outside the handled set in §9.1 of api-plan).

## 5. Data Flow

```
[UI: Server Component on /[locale]/dashboard]
        │
        ▼
[helper: src/lib/supabase/documents.ts → listDocuments()]
        │  validates+clamps params
        ▼
[supabase.from('documents').select(..., { count: 'exact' }).eq.order.range]
        │  HTTP GET to <SUPABASE_URL>/rest/v1/documents
        ▼
[PostgREST]
        │  applies RLS policy `documents_owner_all`
        │  uses index documents_owner_id_updated_at_idx for sort+filter
        ▼
[Postgres]
        │  returns rows + COUNT(*) (because Prefer: count=exact)
        ▼
[helper] returns ListDocumentsResult { items, total, limit, offset }
        │
        ▼
[UI] renders list — one row per item; pagination controls use `total`
```

Storage / external interactions:
- **Database:** `public.documents` only. No RPC. No write. No additional table joins.
- **Auth context:** session JWT cookies handled by `@supabase/ssr` middleware (`src/lib/supabase/middleware.ts`) which already runs on every non-`/api/*` request via `src/proxy.ts`.
- **Cache:** none. `.ai/api-plan.md` §10 explicitly defers Vercel Runtime Cache for this endpoint until >1000 active users.

Server vs Client variant:
- **Recommended:** Server Component (`src/app/[locale]/(app)/dashboard/page.tsx` or similar) calls `listDocuments()` with the cookie-based Supabase client (`createClient()` from `src/lib/supabase/server.ts`). First paint includes the list — best LCP.
- **Optional:** A Client Component (e.g. for "load more" / infinite scroll) re-invokes the same helper with the browser client (`createClient()` from `src/lib/supabase/client.ts`).

## 6. Security Considerations

- **Authentication:** Supabase JWT in cookies (server-side) or in-memory session (client-side). Refresh handled by `updateSession()` in `src/lib/supabase/middleware.ts` (already implemented).
- **Authorization:** **RLS is the only enforcement layer.** Policy `documents_owner_all` requires `owner_id = auth.uid() AND auth.users.email_confirmed_at IS NOT NULL`. Application code must NOT add a parallel ownership check — it would mask RLS regressions in code review.
- **Defense-in-depth:**
  - Use `createClient()` from `src/lib/supabase/server.ts` (NOT `createAdminClient()`). The admin client bypasses RLS and would expose every user's documents.
  - Never inline a raw `order` string from `searchParams` into `.order()` — restrict to the `ListDocumentsSort` union to prevent PostgREST from sorting on a column that may leak ordering signals (e.g. `share_token`).
  - Never add `data` to `select` — defends against accidental large-payload exfiltration via list endpoints and protects bandwidth.
- **PII / GDPR:** rows contain `id`, `name`, `created_at`, `updated_at` only — no PII. `owner_id` is filtered by RLS and is the caller's own UID anyway. `share_token` and `share_token_expires_at` columns are deliberately omitted from `select`.
- **Rate limiting:** none at endpoint level (api-plan §6 — Supabase free-tier global limits suffice; workload is low: free user = 1 doc, pro user ~50).
- **Locale guard:** orthogonal — applies at layout level, not here (`architecture-base.md` §17).

## 7. Error Handling

| Scenario | Source | Status | Helper return | UI behavior |
|---|---|---|---|---|
| No session (cookies missing) | `@supabase/ssr` middleware refresh failed | `200` + `[]` (RLS) | `{ items: [], total: 0, ... }` | Layout-level redirect to `/[locale]/login` (handled by `LocaleGuard`, not this helper). |
| Email not confirmed | RLS predicate `email_confirmed_at IS NOT NULL` | `200` + `[]` | `{ items: [], total: 0, ... }` | Show "verify email" banner (separate flow); list remains empty. |
| `limit` not in `[1, 100]` or `offset < 0` | Helper input guard | n/a — guard throws before HTTP | Throws `RangeError` (developer error — only triggered by buggy callers). | Caller fix; should never reach end users. |
| Network error / Supabase down | Fetch reject | `5xx` or transport error | `{ error: { business: NETWORK_ERROR, message: 'errors.network_error' } }` | Toast `t('errors.network_error')`; offer retry. |
| Unknown PostgREST error (`error.code` not in `errors.ts` switch) | PostgREST | `4xx`/`5xx` | `{ error: { business: UNKNOWN, message: 'errors.unknown', rawCode, rawMessage } }` | Toast `t('errors.unknown')`. Log `rawCode` + `rawMessage` to monitoring (Sentry — deferred). |

**No log-to-DB writes for this read-only endpoint.** Errors that bubble up are logged via `console.error` in dev and forwarded to Sentry post-MVP. Per api-plan §9, all string matching on `error.message` is forbidden — use `mapPostgrestError(error)` only.

**Status-code policy reminder** (per the global rules of this plan-template):
- `200` — successful read (including empty list).
- `400` — invalid caller input (only reachable via developer error here).
- `401` — only emitted by the consuming Route Handler / page guard, not by PostgREST (RLS swallows).
- `500` — wrap unknown DB errors when surfacing through a Route Handler; SDK consumers receive the mapped error directly.

## 8. Performance Considerations

- **Index:** `documents_owner_id_updated_at_idx (owner_id, updated_at DESC)` covers the default sort and filter — index-only scan possible for the projection `(id, name, created_at, updated_at)` if the row width is small. Verify with `EXPLAIN (ANALYZE, BUFFERS)` after first deploy. Sorting by `name` falls back to a heap scan + sort; acceptable since users with `name_asc` are rare and lists are bounded by plan limits (free=1, pro≈50).
- **`count: 'exact'` cost:** triggers `SELECT COUNT(*)` over the filtered set on every call. For ≤50 docs/user this is sub-millisecond. If list sizes ever grow to >1000 per user, switch to `count: 'estimated'` or `count: 'planned'` and accept the imprecise total.
- **Payload size:** by excluding `data`, each row is ~120 B; 50 rows ≈ 6 KB — single TLS frame. Including `data` would push this to potentially 250 MB on a max-pro account. Treat the absence of `data` in `select` as a non-negotiable invariant.
- **Caching:** none (api-plan §10 — deferred). Server Component RSC payload is naturally edge-cacheable per-request via Next.js `revalidate`/`fetch` cache, but Supabase fetches default to `cache: 'no-store'` — leave it that way; user data must be fresh.
- **N+1 risk:** none — one query, no joins.
- **Cold start:** Supabase EU-Frankfurt is colocated with Vercel `fra1` (`vercel.json`). Median round-trip ≈ 5-15 ms.

## 9. Implementation Steps

1. **(Prereq) Land the `errors.ts` module.** This endpoint depends on `mapPostgrestError` and the `BusinessError` enum (api-plan §9). If `src/lib/supabase/errors.ts` does not yet exist, scaffold it with the full enum from api-plan §9.1 — it is shared with every other endpoint plan in this batch. Add unit tests covering at least `P0001`, `23514` octet_length, and the unknown-fallback paths.

2. **Create the data-access helper** `src/lib/supabase/documents.ts` (new file).
   - Export the local types `ListDocumentsSort`, `ListDocumentsParams`, `ListDocumentsResult`.
   - Implement `listDocuments(supabase: SupabaseClient<Database>, params: ListDocumentsParams): Promise<ListDocumentsResult>`. Inject the client (server or browser) via parameter — do NOT instantiate it inside.
   - Inside the helper:
     - Clamp `limit` to `[1, 100]`, default `50`. Throw `RangeError` if NaN/negative — this is a developer error.
     - Clamp `offset` to `>= 0`, default `0`. Same `RangeError` guard.
     - Map `sort` → `(column, ascending)` via a `const SORT_MAP: Record<ListDocumentsSort, { column: 'updated_at' | 'created_at' | 'name'; ascending: boolean }>`.
     - Run the `select` chain shown in §2. Use `select('id, name, created_at, updated_at', { count: 'exact' })`.
     - On `error`, call `mapPostgrestError(error)` and throw a typed error wrapper — let consumers translate into UI state.
     - Return `{ items: data ?? [], total: count ?? 0, limit, offset }`.

3. **Add unit tests** `src/lib/supabase/documents.test.ts` (co-located).
   - Use `vitest` + a hand-rolled `SupabaseClient` mock (chainable `.from().select().eq().order().range()` returning `{ data, error, count }`).
   - Cases:
     - default params → maps to `order=updated_at desc`, `range(0, 49)`, returns `total` from `count`.
     - `sort='name_asc'` → maps correctly.
     - empty result → `items=[]`, `total=0`.
     - error path → `mapPostgrestError` invoked; helper throws.
     - `limit=0` / `limit=-1` / `offset=-1` → throws `RangeError` before any SDK call.
   - Coverage thresholds (`vitest.config.ts`): `src/lib/**` requires lines/functions 80, branches 70, statements 80 — design tests accordingly.

4. **Wire the Server Component consumer** in `src/app/[locale]/(app)/dashboard/page.tsx` (or whichever route hosts the project list — confirm against the routing plan).
   - Mark `async function Page({ params: { locale } })`. Call `setRequestLocale(locale)` first.
   - `const supabase = await createClient()` from `src/lib/supabase/server.ts`.
   - Call `auth.getUser()` to obtain `userId` (and to trigger session refresh on first hit). Redirect to `/[locale]/login` if no user.
   - Call `listDocuments(supabase, { userId, limit, offset, sort })`. `limit`/`offset`/`sort` come from `searchParams`, parsed and validated against the union.
   - Render the list. Localise all UI strings via `useTranslations` / `getTranslations` — zero hardcoded copy (CLAUDE.md rule).

5. **(If needed) Wire the Client Component consumer** for runtime re-fetch (e.g. after rename/delete or "load more").
   - Use `createClient()` from `src/lib/supabase/client.ts`.
   - Call `listDocuments(supabase, params)` inside an effect or on user action.
   - Store result in a Zustand slice (e.g. `useDocumentsSlice`) following the conventions in `CLAUDE.md` (custom hook per slice, `useShallow` for object selectors, `devtools` only in dev).

6. **Add a Playwright E2E** in `e2e/dashboard-list.spec.ts` (`chromium-desktop`).
   - Seed two confirmed users with N documents each (via Supabase admin client in test setup).
   - Sign in as user A, visit `/dashboard`, assert exactly user A's documents are visible — proves RLS isolation end-to-end.
   - Assert `data` field is NOT present in the network response payload (intercept the PostgREST call).
   - Visual regression snapshot (commit baseline to repo).

7. **Verification checklist before merging to `main`:**
   - `pnpm lint` clean.
   - `pnpm typecheck` clean — `DocumentListItemDto` matches the actual `select` projection (TS will catch drift if `select` changes but the type doesn't).
   - `pnpm test:run src/lib/supabase/documents.test.ts` green.
   - `pnpm test:coverage` meets thresholds for `src/lib/**`.
   - `pnpm test:e2e -- --project=chromium-desktop` green.
   - No new file outside `src/canvas-kit/impl-*` or `src/components/canvas/` imports `konva`/`react-konva` (irrelevant here, but the canvas-kit rule is on the global PR checklist).
   - Manual smoke: confirm `Content-Range` header arrives on a real call (`Network` tab) and `count` is read correctly.
