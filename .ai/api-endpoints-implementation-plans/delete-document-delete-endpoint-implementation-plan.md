# API Endpoint Implementation Plan: DELETE /rest/v1/documents (Delete Document)

## 1. Endpoint Overview

Hard-delete a single document owned by the authenticated user (US-011). The endpoint is **not** a custom Next.js Route Handler — it is a direct PostgREST call performed through the Supabase JS SDK (`supabase.from('documents').delete().eq('id', id)`). Authorization is enforced at the database layer via Row Level Security (`owner_id = auth.uid() AND email_confirmed`). The operation is idempotent: deleting a non-existing or already-deleted ID returns `204 No Content` without an error (standard PostgREST behavior). RODO art. 17 requires a hard delete — there is no soft-delete column in MVP. Because there are no FKs pointing **into** `documents` from other tables, no cascade is needed; the row is the leaf.

The client-side caller (a hook in the documents list view) is responsible for: (1) showing the confirmation modal, (2) invoking the SDK call, (3) on success, removing the document from the Zustand store and the UI list. After deletion, a Free user who hit the per-user limit (1 active document, enforced by trigger `check_free_project_limit`) regains the ability to create a new document on the next INSERT.

## 2. Request Details

- **HTTP Method:** `DELETE`
- **URL Structure:** `DELETE /rest/v1/documents?id=eq.{id}` (PostgREST endpoint exposed by Supabase)
- **Invocation:** Supabase JS SDK from a Client Component (browser session client) — never a custom `route.ts`.
- **Headers (set by SDK automatically):**
  - `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`
  - `Authorization: Bearer <user JWT>` (cookie-derived session token)
  - `Content-Type: application/json`
- **Parameters:**
  - **Required:**
    - `id` (string, UUID) — passed via the `.eq('id', documentId)` chain; PostgREST receives it as a query string filter `id=eq.<uuid>`.
  - **Optional:** none.
- **Request Body:** none. PostgREST DELETE expects an empty body.
- **Prefer header:** not required. The SDK does not send `Prefer: return=representation` for `.delete()` calls unless `.select()` is appended; we deliberately do **not** chain `.select()` to keep the response empty (`204 No Content`) and avoid exposing the deleted row.

## 3. Used Types

This endpoint does not introduce new DTOs — DELETE has no response body and no command payload. The relevant types already live in `src/types/`:

- **Identifier:** `Tables<'documents'>['id']` (string UUID) — derived from `src/types/database.ts`.
- **Existing list/detail DTOs that the caller mutates locally after a successful DELETE:**
  - `DocumentListItemDto` (for the projects list view) — `src/types/api.ts`.
  - `DocumentDto` (when the user deletes the currently open document and the editor must close) — `src/types/api.ts`.
- **Error mapping:** `MappedError` and the `BusinessError` enum from `src/lib/supabase/errors.ts` (TODO — full stub in `api-plan.md` §9). The client uses `mapPostgrestError(err)` to translate any non-RLS DB error into a typed business error before showing a toast.

No new entries in `src/types/api.ts` are required for this endpoint.

## 4. Response Details

### Success
- **`204 No Content`** — empty body. The SDK returns `{ data: null, error: null }`.
- The same `204` is returned when the `id` does not exist or has already been deleted (idempotent — the row count filter simply matches 0 rows; PostgREST does not raise an error). The UI must treat this as success and proceed to remove the entry locally.

### Errors (returned as `PostgrestError` via the SDK)
- **`401 Unauthorized`** — no valid session / JWT expired and refresh failed.
- **`403 Forbidden` (manifested as `204` with zero rows by RLS, or `42501` insufficient_privilege depending on policy mode)** — RLS rejects (`owner_id ≠ auth.uid()` or `email_confirmed_at IS NULL`). With Supabase's default policy semantics on `FOR ALL`, a user trying to delete somebody else's row will simply see the row filtered out (no error, `204` with 0 rows affected). Treat this case identically to "already deleted".
- **`500 Internal Server Error`** — unexpected DB / network failure.

Status codes the client code branches on:

| Code | Meaning | Client behavior |
|---|---|---|
| 204 | Deleted (or no-op idempotent) | Remove from list / Zustand store; toast "Projekt usunięty" |
| 401 | Session expired | Redirect to `/[locale]/login` |
| 5xx / network | Transient | Toast "errors.network_error"; keep entry in list |

## 5. Data Flow

```
[UI: ProjectListItem] → onClick "Usuń" → <ConfirmDeleteModal>
                                              │
                                              ▼  user confirms
                            [hook: useDeleteDocument]
                                              │
                                              ▼
                       supabase.from('documents').delete().eq('id', id)
                                              │
                                              ▼  HTTPS DELETE /rest/v1/documents?id=eq.<uuid>
                                       [PostgREST]
                                              │
                                              ▼
                         RLS policy `documents_owner_all`:
                            USING (owner_id = auth.uid() AND email_confirmed)
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
                   row matches                              row filtered out
                          │                                       │
                  hard DELETE row                            no rows affected
                          │                                       │
                          └───────────────────┬───────────────────┘
                                              ▼
                                        204 No Content
                                              │
                                              ▼
              [hook] → mapPostgrestError(error) (no-op on success)
                                              │
                                              ▼
                  Zustand: remove from documentsList; close editor if open
                                              │
                                              ▼
                                  toast "Projekt usunięty"
```

**External resources touched:**
- Supabase Postgres table `public.documents` (single row DELETE).
- No cron, no webhook, no Storage, no Auth Admin API.
- RLS policy `documents_owner_all` is the only authorization gate; no application-level check is duplicated client-side (defense-in-depth: the policy is the source of truth).

**Trigger interactions:**
- No `BEFORE DELETE` trigger exists on `documents`. Only `check_free_project_limit` runs `BEFORE INSERT` — it is **re-armed** automatically after a Free user's single document is deleted (next INSERT will succeed). This is implicit, no action required.

**Client-side effects after success:**
- `useDocumentsSlice.removeFromList(id)` — pure local mutation, no extra request.
- If `id === currentDocumentId` (the editor is open on the deleted doc), `useDocumentSlice.closeDocument()` and navigate back to `/[locale]/projects`.
- localStorage autosave key `'welderdoc_autosave'` is cleared if it referenced the deleted doc (per `architecture-base.md` §13).

## 6. Security Considerations

1. **Authentication:** mandatory active Supabase session. The browser SDK reads the JWT from cookies (set by `@supabase/ssr` middleware in `src/proxy.ts`). No anonymous access.
2. **Authorization:** enforced **only** by the RLS policy `documents_owner_all` — `USING (owner_id = auth.uid() AND email_confirmed) WITH CHECK (...)`. Two layers:
   - Ownership (`owner_id = auth.uid()`) — prevents IDOR; a malicious client cannot pass another user's UUID.
   - Email confirmation (`email_confirmed`) — defense-in-depth; an unverified account cannot mutate data even if a session somehow exists.
3. **No `service_role` key on the client.** Browser code uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` only; RLS is non-bypassable.
4. **No custom Route Handler ⇒ no IP logging here.** Account-level audit (delete/login/etc.) is not in scope for document operations.
5. **CSRF:** Supabase JS uses the JWT in `Authorization` header (not cookie-only), so CSRF-from-cookie attacks do not apply to PostgREST itself. Cookie-based session refresh in `@supabase/ssr` uses `SameSite=Lax`.
6. **Confirmation requirement:** the destructive UX (modal with "Usuń" / "Anuluj") is mandatory at the component level. Not a security control — a UX guard against accidental clicks. Tested in Playwright (US-011 scenario).
7. **No information leakage on RLS rejection.** Because RLS uses `USING` (not a `CHECK`-only policy), a user attempting to delete somebody else's document will receive the same `204` as for an already-deleted row — they cannot probe for existence of other users' UUIDs by status code.
8. **Hard delete (RODO art. 17 alignment).** No soft-delete column. The row is immediately and permanently removed; there is no recovery. The `documents` table has no PII directly (just `name` + `data` JSONB which contains the canvas scene), so no separate erasure of related PII is required for this endpoint. Account-level erasure (`auth.users`) is handled by `DELETE /api/user/account` and cascades to documents via `auth.users → documents.owner_id ON DELETE CASCADE`.
9. **Rate limiting:** none. Operation is low-frequency (UI confirmation gate, single-user-context). If abuse is detected post-MVP, add Vercel WAF rate limiting on the PostgREST origin.

## 7. Error Handling

### Error matrix

| Scenario | Source | SDK surface | Status | Client action |
|---|---|---|---|---|
| Happy path: row deleted | PostgREST | `error: null` | 204 | Remove from list, close editor if open, toast success |
| Idempotent: id does not exist | PostgREST | `error: null` | 204 | Same as success — silent |
| RLS filters out (other user's id) | RLS USING clause | `error: null` (0 rows) | 204 | Same as idempotent — silent (no info leak) |
| Session expired / JWT invalid | Auth | `PostgrestError` code `PGRST301` or 401 | 401 | `mapPostgrestError`, redirect to login |
| Email not confirmed | RLS WITH CHECK | usually 0 rows → 204; rarely `42501` | 403 | If 403, toast `errors.email_not_confirmed` and redirect to `/[locale]/email-not-confirmed` |
| Network failure | Fetch | `error: { message: 'Failed to fetch' }` | n/a | `mapPostgrestError` → `NETWORK_ERROR`, toast retry |
| DB unavailable | PostgREST | `PostgrestError` 5xx | 500 | Toast `errors.unknown`; allow retry |
| Unexpected (constraint, trigger raises) | PostgREST | `PostgrestError` w/ code | 400/409 | `mapPostgrestError(err).business` → matched i18n key; fallback `errors.unknown` |

### Error logging

- **No application-level error log table** for this endpoint — the operation is non-financial and idempotent. Server-side errors are captured by Vercel's standard request logs and Supabase's `pg_log` only.
- **Client-side observability:** report unmapped errors (`BusinessError.UNKNOWN`) via `console.error` in dev and (post-MVP) Sentry. Do **not** swallow `error.code` — always pass the raw code into `MappedError.rawCode` so debugging is possible.

### Mapper integration

```ts
// inside the hook
const { error } = await supabase.from('documents').delete().eq('id', documentId)
const mapped = mapPostgrestError(error)
if (mapped) {
  // toast(t(mapped.message))
  // optional: track mapped.business for analytics
  return { ok: false, business: mapped.business }
}
return { ok: true }
```

`mapPostgrestError` is implemented in `src/lib/supabase/errors.ts` (TODO — `api-plan.md` §9). For DELETE on `documents` no `BusinessError` code is currently registered as expected — the function will return `BusinessError.UNKNOWN` for any non-null error, which is correct (no shape-specific business errors to surface here).

## 8. Performance Considerations

- **Single row DELETE on a UUID PK** — `O(1)` index lookup on `documents_pkey`. Sub-millisecond at the DB level.
- **Round-trip:** one HTTPS request from browser to Supabase Edge proxy → Postgres. No additional reads, no joins, no triggers fired. Expected `< 150ms` end-to-end from `fra1` Vercel region (Supabase EU-Frankfurt).
- **No N+1 risk** — the call deletes by PK with a single filter.
- **Optimistic UI option (post-MVP):** the list can immediately remove the entry on click and roll back on error. For MVP, perform the call first, then remove on success — simpler error story, acceptable latency.
- **Bundle impact:** no new dependencies. The hook reuses `supabase` from `src/lib/supabase/client.ts`.
- **localStorage autosave cleanup:** clearing the key `'welderdoc_autosave'` is synchronous and trivial; no perf concern.
- **Concurrent deletes:** if the user opens two tabs and clicks delete in both, the second tab's call is a no-op (idempotent 204). No locking needed.

## 9. Implementation Steps

1. **Verify infrastructure preconditions (no code change).**
   - Confirm migration `20260507000000_complete_schema.sql` has the `documents_owner_all` policy with `USING (owner_id = auth.uid() AND email_confirmed)` covering `FOR ALL` (DELETE inherits the policy).
   - Confirm `src/lib/supabase/client.ts` exports the browser `createClient()` helper. Already implemented per CLAUDE.md "Currently implemented in `src/lib/`".

2. **Implement `src/lib/supabase/errors.ts` (if not yet done — TODO from CLAUDE.md).**
   - Stub the `BusinessError` enum and `mapPostgrestError` per `api-plan.md` §9. This is a cross-cutting prerequisite; this endpoint depends on it for typed error toasts. If the file already exists, no change is required for DELETE specifically.

3. **Add a hook `useDeleteDocument` in `src/hooks/useDeleteDocument.ts` (new file).**
   - Signature: `function useDeleteDocument(): { deleteDocument: (id: string) => Promise<{ ok: boolean; business?: BusinessError }> }`.
   - Body:
     ```ts
     'use client'
     import { createClient } from '@/lib/supabase/client'
     import { mapPostgrestError, BusinessError } from '@/lib/supabase/errors'

     export function useDeleteDocument() {
       const supabase = createClient()
       return {
         deleteDocument: async (id: string) => {
           const { error } = await supabase.from('documents').delete().eq('id', id)
           const mapped = mapPostgrestError(error)
           if (mapped) return { ok: false, business: mapped.business }
           return { ok: true }
         },
       }
     }
     ```
   - Do **not** chain `.select()` — keeps the response `204` and avoids leaking the deleted row.

4. **Wire the hook into the Zustand documents slice (`src/store/slices/documentsSlice.ts`).**
   - Add an action `removeDocumentLocal(id: string)` that strips the entry from `documentsList` and, if `currentDocumentId === id`, calls `closeDocument()`.
   - The hook from step 3 is invoked from the UI; on `ok: true` the slice action is dispatched. The slice itself never calls Supabase — keeps the slice pure for unit testing.

5. **UI integration in `src/app/[locale]/(dashboard)/projects/...` (the projects list page).**
   - Project list item: add a "Usuń" menu entry → opens `<ConfirmDeleteModal name={doc.name} />`.
   - Modal copy: i18n keys `projects.delete.title`, `projects.delete.confirm`, `projects.delete.cancel`. Default copy in PL: "Czy na pewno usunąć projekt «{name}»? Tej operacji nie można cofnąć."
   - On confirm → call `deleteDocument(id)` → dispatch `removeDocumentLocal(id)` → toast `projects.delete.success` ("Projekt usunięty").
   - On `business !== undefined`: toast the mapped i18n message.

6. **Clear localStorage autosave if it references the deleted document.**
   - In the same handler, after a successful delete, read `'welderdoc_autosave'`, parse, and if `scene.documentId === id` → `localStorage.removeItem('welderdoc_autosave')`. This avoids restoring a ghost document on next reload.

7. **i18n keys: add to `src/messages/{pl,en}.json`.**
   - `projects.delete.title`, `projects.delete.confirm`, `projects.delete.cancel`, `projects.delete.success`, plus any error keys not yet present (`errors.network_error`, `errors.unknown`).

8. **Unit tests (`src/hooks/useDeleteDocument.test.ts`).**
   - Mock `supabase.from('documents').delete().eq(...)` chain. Cover:
     - `error: null` → `{ ok: true }`.
     - `error: PostgrestError(code: 'PGRST301')` → `{ ok: false, business: BusinessError.UNKNOWN }` (or whatever `mapPostgrestError` returns; assert via the mapper, not the literal).
     - Verify no `.select()` is chained.
   - Coverage thresholds for `src/lib/**` and `src/store/**` apply (80/80/70/80) — keep the hook small and fully covered.

9. **Playwright E2E (`e2e/projects-delete.spec.ts`).**
   - Sign in as a seeded user with two documents.
   - Click "Usuń" on project 1 → confirm modal → assert the row disappears, toast appears.
   - Reload page → assert the document is gone server-side too.
   - Negative: attempt to delete a non-existent UUID via direct hook invocation (debug surface) → assert no toast error and list state unchanged.

10. **Manual verification.**
    - Free user with 1 active document → delete → create a new document → assert no `project_limit_exceeded` (trigger correctly re-armed).
    - Pro user with 5 documents → delete one → assert remaining 4 visible.
    - Open a document, delete it from the list in another tab, return to the editor tab → next save attempt should surface a `PGRST116` (or similar) "document not found" — handled by the existing save error mapper, not this endpoint.

11. **PR checklist (CLAUDE.md compliance).**
    - No `error.message.includes(...)` outside `mapPostgrestError`.
    - No direct `supabase.from('user_profiles').update(...)` introduced (irrelevant here, but checklist item).
    - Conventional commit: `feat(documents): implement US-011 delete document with RLS-only authorization`.
    - Lint, typecheck, Vitest, Playwright `chromium-desktop` green before merge to `main`.
