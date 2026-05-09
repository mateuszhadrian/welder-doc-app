# API Endpoint Implementation Plan: PATCH /rest/v1/documents?id=eq.{id} (Update Document)

> Direct PostgREST endpoint exposed by Supabase. There is **no custom Next.js Route Handler** — the client invokes Supabase JS SDK and the request travels through the Supabase REST gateway. RLS on `public.documents` and DB-level CHECK constraints/triggers carry all server-side authorization and validation. The "implementation" therefore means: the SDK call sites, the typed command DTOs, the `DocumentSlice` autosave wiring, and the error-mapping plumbing — not a route file.

## 1. Endpoint Overview

PATCH on `public.documents` partially updates an existing document row. It backs three product use cases:

- **US-009** — autosave of canvas scene (`{ data: CanvasDocument }`, debounced 1–2 s).
- **US-013** — rename project (`{ name: string }`).
- **US-014** — resize canvas dimensions, which live inside the JSONB `data` blob (read-modify-write in three SDK steps).

Authorization is enforced by RLS (`owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`); validation is enforced by table-level CHECK constraints and triggers (`set_updated_at`, `documents_before_iu_sync_schema_version`, `documents_before_iu_check_free_limit`). Every other concern (debounce, optimistic UI, fallback to localStorage, error toasts) is client-side and lives in `DocumentSlice` plus consuming components.

## 2. Request Details

- **HTTP Method:** `PATCH`
- **URL Structure:** `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/documents?id=eq.{id}` (issued by `@supabase/supabase-js`; no app-controlled URL).
- **Headers (set by SDK):**
  - `Content-Type: application/json`
  - `Prefer: return=representation` (set automatically when `.select()` is appended after `.update()`)
  - `Authorization: Bearer <user JWT>` (cookie-based session via `@supabase/ssr` in Server Components / `@supabase/supabase-js` in client)
  - `apikey: <anon key>`
- **Parameters:**
  - **Required (URL filter):** `id=eq.<uuid>` — supplied via `.eq('id', documentId)` in the SDK.
  - **Optional (body — partial update):** any combination of `name`, `data`, `owner_id` (transfer). At least one must be present.
- **Forbidden in body:** `id`, `created_at`, `updated_at`, `schema_version`. Code paths must never include them in the partial update payload — they are either immutable or maintained by triggers.
- **Request body (partial PATCH):**

  | Field      | Type            | Constraint (DB)                                                                                                                                                                                | Use case                  |
  |------------|-----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|
  | `name`     | `string`        | `CHECK (length(trim(name)) > 0 AND length(name) <= 100)`                                                                                                                                       | Rename (US-013)           |
  | `data`     | `JSONB` (object)| `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')` and `octet_length(data::text) < 5 MB` | Autosave (US-009), resize (US-014) |
  | `owner_id` | `uuid`          | Trigger `documents_before_iu_check_free_limit` enforces Free-plan project cap                                                                                                                  | Transfer (post-MVP)       |

## 3. Used Types

All from `src/types/api.ts` (already defined — no new types required):

- **`DocumentDto`** — full document with typed canvas payload; returned from `.update().select().single()`.
- **`DocumentListItemDto`** — lightweight projection for autosave responses where `data` is omitted (`Pick<Tables<'documents'>, 'id'|'name'|'created_at'|'updated_at'>`).
- **`CanvasDocument`** — typed shape of the JSONB `data` column (carries `schemaVersion`, `canvasWidth`, `canvasHeight`, `shapes`, `weldUnits`).
- **`SaveDocumentDataCommand`** — `{ data: CanvasDocument }` (US-009 autosave).
- **`RenameDocumentCommand`** — `{ name: string }` (US-013 rename).
- **`ResizeCanvasCommand`** — `{ canvasWidth: number; canvasHeight: number }` (US-014 — caller merges into the existing blob before PATCHing).
- **`MappedError` / `BusinessError`** — from `src/lib/supabase/errors.ts` (TODO; stub in `api-plan.md` §9). Used to translate PostgREST/Postgres error codes into i18n-keyed business errors.

> Naming note: the spec's literal "command" maps to these existing DTO names. Do not introduce `UpdateDocumentCommand` — splitting per use case (`SaveDocumentDataCommand`, `RenameDocumentCommand`, `ResizeCanvasCommand`) keeps the call sites narrow and the DTO closed against accidental writes to protected columns.

## 4. Response Details

### 4.1 Success — 200 OK

Returned when at least one row matches the RLS filter and update succeeds.

- **Rename / full update** (`.select().single()`):
  ```json
  {
    "id": "uuid",
    "name": "Nowa nazwa",
    "data": { "schemaVersion": 1, "canvasWidth": 4000, "canvasHeight": 3000, "shapes": [], "weldUnits": [] },
    "schema_version": 1,
    "created_at": "2026-05-08T11:55:00Z",
    "updated_at": "2026-05-08T12:00:00Z"
  }
  ```
- **Autosave** (`.select('id, name, updated_at').single()`): drops `data` from the wire to keep the autosave round-trip cheap. Body is `Pick<DocumentDto, 'id' | 'name' | 'updated_at'>` shape. The store merges only `updated_at` to drive the "saved at HH:MM" indicator.

### 4.2 Errors

| HTTP | DB code  | Trigger                                            | BusinessError mapping                            |
|------|----------|----------------------------------------------------|--------------------------------------------------|
| 400  | `23514`  | `octet_length(data::text)` exceeds 5 MB             | `DOCUMENT_PAYLOAD_TOO_LARGE`                     |
| 400  | `23514`  | `length(trim(name)) = 0` or `length(name) > 100`   | `DOCUMENT_NAME_INVALID`                          |
| 400  | `23514`  | `jsonb_typeof` / required keys missing              | `DOCUMENT_DATA_SHAPE_INVALID`                    |
| 401  | —        | No session / missing cookie                         | `UNAUTHORIZED`                                   |
| 403/404 (PostgREST returns "0 rows" → `PGRST116`) | — | RLS rejects: not owner / email not confirmed | `UNAUTHORIZED` (do **not** disclose existence)   |
| 500  | `P0001`  | Trigger `check_free_project_limit` (only when `owner_id` changes) | `PROJECT_LIMIT_EXCEEDED` |

> Supabase JS returns `null` data + `error: PostgrestError` — no thrown exception. Always pass `error` through `mapPostgrestError()` and never inspect `error.message` directly.

## 5. Data Flow

```
Component (React Client)
  └── useDocumentSlice() — selector exposing renameDocument(), saveDocumentData(), resizeCanvas()
        └── DocumentSlice action (Zustand)
              ├── client preflight (length, JSON size)
              ├── createClient() from src/lib/supabase/client.ts (browser) — cookie-based session
              │   OR createClient() from src/lib/supabase/server.ts (Server Action) — async, awaits cookies()
              └── supabase.from('documents').update(payload).eq('id', id).select(...).single()
                    └── Supabase REST gateway → Postgres
                          ├── RLS USING + WITH CHECK  ← rejects → PostgrestError
                          ├── BEFORE UPDATE OF data  → documents_before_iu_sync_schema_version()
                          ├── BEFORE UPDATE OF owner_id → documents_before_iu_check_free_limit() (P0001)
                          ├── BEFORE UPDATE → set_updated_at()
                          └── CHECK constraints → 23514 on violation
              ← row representation OR error
        ← MappedError via mapPostgrestError(error)
  ← UI: optimistic patch reconciled, toast on mapped error
```

### 5.1 Use case: Autosave (US-009)

1. Canvas store changes.
2. `DocumentSlice` debounces (recommended 1–2 s) via a `useEffect`/setTimeout owned by the slice (not the component).
3. Client preflight: `JSON.stringify(data).length < 5 * 1024 * 1024`. On overflow → mark as `DOCUMENT_PAYLOAD_TOO_LARGE` locally (no network call), surface toast.
4. `supabase.from('documents').update({ data }).eq('id', id).select('id, name, updated_at').single()`.
5. On success → store `lastSavedAt = response.updated_at`; clear `dirty` flag.
6. On `PGRST116` (no rows) → user lost ownership/email confirmation → redirect to `/login`.
7. On any other error → keep `dirty` flag, write fallback to `localStorage` under `welderdoc_autosave` (CLAUDE.md keys), schedule retry with exponential backoff. On `QuotaExceededError` from localStorage: trim history to 50 entries and retry; on second failure show "save in cloud" toast.

### 5.2 Use case: Rename (US-013)

1. UI form trims input client-side (whitespace must not pass).
2. Client preflight: `name.trim().length` ∈ [1, 100].
3. `supabase.from('documents').update({ name }).eq('id', id).select().single()`.
4. On `DOCUMENT_NAME_INVALID` (server-side rejection bypassing client preflight) → re-validate UI form, attach inline error.
5. On success → patch the list cache and the document title.

### 5.3 Use case: Resize canvas (US-014, M1)

PostgREST cannot atomically merge JSONB. Three-step sequence runs **inside one slice action** to keep state machine local and testable:

```typescript
// In DocumentSlice (pseudocode)
async function resizeCanvas(id: string, w: number, h: number) {
  const supabase = createClient()

  const { data: current, error: readError } = await supabase
    .from('documents').select('data').eq('id', id).single()
  if (readError) return mapPostgrestError(readError)

  const merged = { ...(current.data as CanvasDocument), canvasWidth: w, canvasHeight: h }
  if (JSON.stringify(merged).length >= 5 * 1024 * 1024) {
    return { business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE, message: 'errors.document_payload_too_large' }
  }

  const { error: writeError } = await supabase
    .from('documents').update({ data: merged }).eq('id', id)
  return mapPostgrestError(writeError)
}
```

Race window between step 1 and step 3 is accepted in MVP (single-tab dominant). Post-MVP optimistic concurrency: extend the WHERE clause with `.eq('updated_at', expectedUpdatedAt)` and treat 0 rows updated as a conflict — track in backlog only, do not implement now.

## 6. Security Considerations

- **AuthN — session-based JWT.** Browser clients use `createBrowserClient` (`src/lib/supabase/client.ts`); Server Components / Server Actions use the async `createServerClient` (`src/lib/supabase/server.ts`, must `await cookies()`). Never use `createAdminClient()` for user-scoped writes — it bypasses RLS.
- **AuthZ — RLS only.** The active policy is `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` for both `USING` and `WITH CHECK`. This means:
  - users without confirmed email cannot mutate any row;
  - users cannot reassign `owner_id` to themselves to grab a foreign document (WITH CHECK still requires the *new* `owner_id` equals `auth.uid()`).
- **Protected columns — never include in payload.** `id`, `created_at`, `updated_at`, `schema_version` must be omitted. `schema_version` and `updated_at` are maintained by triggers; `id` is immutable; `created_at` is set on INSERT only. Including any of them either is silently overwritten by the trigger (`updated_at`/`schema_version`) or is a logic bug (`id`/`created_at`). Add a TS-level guard in `DocumentSlice` that constructs the partial update from the closed DTO union (`SaveDocumentDataCommand | RenameDocumentCommand | ...`) — do **not** spread arbitrary form state.
- **Protected canvas keys inside `data`.** Although `schemaVersion` lives in `data`, the trigger `documents_before_iu_sync_schema_version` overrides it to whatever `schemaVersion` the JSONB carries on the server side (sync-by-extraction). Do not bump `schemaVersion` from the client in patches that aren't a real schema migration — the canvas codec (future `documentCodec.ts`) is the only place that should change it.
- **Information disclosure on RLS reject.** PostgREST returns `PGRST116` ("Row not found") for both "row missing" and "RLS denied" — that is desired; do not surface "not your document" wording in the UI.
- **Payload size enforcement is dual.** Client preflight (`JSON.stringify(data).length < 5 MB`) prevents the network round trip; the DB CHECK (`octet_length`) is the authoritative guard. Do not rely on the preflight alone — different JSON encoders produce different byte counts than `octet_length(data::text)`.
- **No rate limiting at API layer.** Mitigated by client-side debounce (1–2 s) for autosave. Document this expectation in `DocumentSlice`'s docstring; missing the debounce will not corrupt data but will cost Supabase egress.
- **Cross-tab race (US-014).** Accepted per spec for MVP. If the codebase later adopts BroadcastChannel-based tab coordination, add tab-leader election before resizing — out of scope here.

## 7. Error Handling

All errors flow through `mapPostgrestError(err)` from `src/lib/supabase/errors.ts` (currently a TODO — must be created as part of this work). The function returns `MappedError | null` with a `BusinessError` enum value and an i18n key.

| Origin                  | Detection                                                                  | UI behavior                                                                                                |
|-------------------------|----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| `DOCUMENT_PAYLOAD_TOO_LARGE` | DB code `23514` + message contains `octet_length` (or client preflight)   | Toast `errors.document_payload_too_large`. Mark document as "save failed"; offer "remove unused shapes" CTA. |
| `DOCUMENT_NAME_INVALID` | DB code `23514` + message contains `length(trim(name))` or `length(name)` | Inline form error on rename input.                                                                          |
| `DOCUMENT_DATA_SHAPE_INVALID` | DB code `23514` + message contains `jsonb_typeof`                        | This is a programmer error (broken codec). Log to console + Sentry (when wired); generic toast.            |
| `PROJECT_LIMIT_EXCEEDED`| DB code `P0001` + message contains `project_limit_exceeded` (only on `owner_id` transfer) | Toast `errors.project_limit_exceeded` + upgrade-to-Pro CTA.                                                |
| `UNAUTHORIZED` (`PGRST116`) | `error.code === 'PGRST116'` after PATCH                                | Treat as session expired or document deleted. Redirect to documents list.                                  |
| Network / 5xx           | `error` thrown or `error.code` startswith `PGRST5`                        | Keep `dirty` state, retry with backoff, persist to `localStorage` (autosave fallback).                    |
| `BusinessError.UNKNOWN` | Anything not matched                                                       | Generic toast `errors.unknown`; log raw `error.code` + `error.message`.                                    |

> There is no `error_log` table in `db-plan.md`. "Logging errors in the error table" is therefore a no-op for this endpoint. Use `console.error` with a structured prefix (e.g. `[DocumentSlice:autosave]`) so future Sentry wiring can pick it up.

## 8. Performance Considerations

- **Autosave debounce 1–2 s.** Owned by the slice (not the component) so it survives unmount/remount of the canvas. Use `setTimeout` cleared on subsequent edits and on slice destruction. Do not import lodash for this — `setTimeout` + a `ref` is sufficient.
- **Narrow the `select()` on autosave.** Use `.select('id, name, updated_at')` to avoid round-tripping the 5 MB blob back. Round-trip latency on EU-Frankfurt is the dominant cost of every autosave.
- **Reuse one Supabase client per call site.** `createClient()` in the browser is cheap, but constructing it inside a tight loop is wasteful — instantiate once per slice action.
- **Resize is a sequential 2 RTT operation.** Do not parallelize with other writes during resize; queue or block the autosave for the duration. Cheapest implementation: set a `resizing` boolean in the slice and have the autosave action early-return when it is true.
- **JSONB CHECK runs on every UPDATE.** Cost is `O(n)` over the size of `data`. With the 5 MB cap this is bounded (~tens of ms). No server-side action required, but be mindful when adding more CHECKs.
- **localStorage is synchronous and IO-bound.** Writes to `welderdoc_autosave` happen only on network failure; never write on every keystroke.
- **Optimistic UI.** Render the new name/dimensions immediately after the slice action returns its preflight result. Roll back to the previous value only on mapped error — most autosaves never need a UI flicker.

## 9. Implementation Steps

> All work lives in client/ slice/ lib code. There is no Route Handler to create.

1. **Create `src/lib/supabase/errors.ts`** (currently TODO per CLAUDE.md). Implement `BusinessError` enum, `MappedError` interface, `mapPostgrestError`, and `mapAuthError` per `api-plan.md` §9.1. Add Vitest unit tests (`errors.test.ts`) covering every code path listed in §7 above — at minimum: `23514`/`octet_length`, `23514`/`length(trim(name))`, `23514`/`jsonb_typeof`, `P0001`/`project_limit_exceeded`, `PGRST116`, and the `null`/`UNKNOWN` fallthroughs.

2. **Confirm DTOs in `src/types/api.ts`.** `DocumentDto`, `DocumentListItemDto`, `CanvasDocument`, `SaveDocumentDataCommand`, `RenameDocumentCommand`, `ResizeCanvasCommand` are already defined — no changes needed. Do not invent an `UpdateDocumentCommand` superset.

3. **Implement `DocumentSlice`** (currently a placeholder in `src/store/`). Required actions:
   - `renameDocument(id: string, name: string): Promise<MappedError | null>`
   - `saveDocumentData(id: string, data: CanvasDocument): Promise<MappedError | null>` (debounced internally)
   - `resizeCanvas(id: string, canvasWidth: number, canvasHeight: number): Promise<MappedError | null>` (3-step read-modify-write, blocks autosave during execution)
   - State fields: `lastSavedAt: string | null`, `saving: boolean`, `dirty: boolean`, `resizing: boolean`.
   - Use `useShallow` in any consumer that subscribes to more than one of these fields (CLAUDE.md: Zustand store conventions).
   - Wrap with `devtools()` in dev only (CLAUDE.md).

4. **Wire localStorage fallback.** On network error during `saveDocumentData`, write the autosave bundle to `welderdoc_autosave` per CLAUDE.md spec. Handle `QuotaExceededError` by trimming `history` to 50 entries and retrying once.

5. **Client preflights.**
   - Rename: `name.trim().length` ∈ [1, 100] before SDK call. If invalid, return synthetic `MappedError` with `BusinessError.DOCUMENT_NAME_INVALID`.
   - Autosave / resize: `JSON.stringify(data).length < 5 * 1024 * 1024` before SDK call. If invalid, return synthetic `MappedError` with `BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE`.

6. **Use the correct Supabase client per context** (tech-stack §7). Slice actions invoked from Client Components: `createClient()` from `src/lib/supabase/client.ts`. Slice actions invoked from Server Actions: `createClient()` from `src/lib/supabase/server.ts` (async, `await cookies()`). Never `createAdminClient()` — RLS must apply.

7. **i18n keys.** Add `errors.document_payload_too_large`, `errors.document_name_invalid`, `errors.document_data_shape_invalid`, `errors.project_limit_exceeded`, `errors.unknown` to `src/messages/{pl,en}.json` if not present. Zero hardcoded strings (CLAUDE.md).

8. **Vitest unit tests for `DocumentSlice`** (`src/store/documentSlice.test.ts`):
   - Rename rejects on whitespace-only / >100 chars without hitting Supabase (mock to assert no network call).
   - Autosave debounces (advance fake timers; assert single SDK call).
   - Autosave preflight rejects 5 MB payloads.
   - Resize: 3-step sequence; verify merge preserves `shapes`/`weldUnits`.
   - Network failure: localStorage write occurs; on `QuotaExceededError` history is trimmed to 50.
   - Server error: `mapPostgrestError` is called and result is returned to caller.

9. **Playwright E2E (`chromium-desktop`)** — happy paths only:
   - US-013: rename a document, refresh, verify persistence.
   - US-009: edit canvas, wait for autosave indicator, refresh, verify scene.
   - US-014: resize canvas, refresh, verify dimensions.
   - Visual regression: include the autosave indicator state.

10. **Update CLAUDE.md** "Currently implemented in `src/lib/`" to remove `errors.ts` from the TODO list once §1 lands. Same for any other now-implemented stub mentioned in CLAUDE.md (e.g. when `documentCodec.ts` arrives).

11. **Run guardrails** before commit: `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm test:coverage` (slice + lib must clear the 80/70/80 thresholds), `pnpm test:e2e -- --project=chromium-desktop`.
