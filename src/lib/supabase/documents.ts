import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type {
  CanvasDocument,
  CreateDocumentCommand,
  DocumentDto,
  DocumentListItemDto,
  RenameDocumentCommand,
  ResizeCanvasCommand,
  SaveDocumentDataCommand
} from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

const MAX_NAME_LENGTH = 100;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const SELECT_COLUMNS = 'id, name, schema_version, data, created_at, updated_at' as const;
const LIST_SELECT_COLUMNS = 'id, name, created_at, updated_at' as const;
const AUTOSAVE_SELECT_COLUMNS = 'id, name, updated_at' as const;

const DEFAULT_LIST_LIMIT = 50;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 100;

export type CreateDocumentResult =
  | { data: DocumentDto; error: null }
  | { data: null; error: MappedError };

/**
 * Insert a new document for the authenticated user (US-008, US-007 migration,
 * US-012 duplicate). Client-agnostic — accepts a `SupabaseClient<Database>` so
 * browser, server, and admin variants can share the same code path.
 *
 * Authorisation lives in the database, not here:
 *   - RLS WITH CHECK enforces `owner_id = auth.uid()` AND email confirmed.
 *   - BEFORE INSERT trigger `check_free_project_limit` enforces the Free=1 cap.
 * The client-side preflight below mirrors the DB CHECK constraints purely for
 * UX (no round-trip on obviously bad payloads). The DB is the source of truth.
 *
 * Errors are normalised through `mapPostgrestError()`; callers branch on
 * `MappedError.business`, never on raw Postgres error text.
 *
 * The returned `DocumentDto` deliberately omits `owner_id` and `share_token*`
 * — those columns have no UI consumer (api-plan.md §3.2).
 */
export async function createDocument(
  supabase: SupabaseClient<Database>,
  command: CreateDocumentCommand
): Promise<CreateDocumentResult> {
  const trimmedName = command.name.trim();
  if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid'
      }
    };
  }

  const candidate = command.data as Partial<CanvasDocument> | null | undefined;
  if (
    !candidate ||
    typeof candidate.schemaVersion !== 'number' ||
    !Array.isArray(candidate.shapes) ||
    !Array.isArray(candidate.weldUnits)
  ) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  // Stringification is synchronous; for typical scenes this is sub-ms. The DB
  // CHECK on octet_length(data::text) is the authoritative cap — this preflight
  // just spares the round-trip when the payload is obviously oversized.
  const serialized = JSON.stringify(command.data);
  if (serialized.length >= MAX_PAYLOAD_BYTES) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large'
      }
    };
  }

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      data: null,
      error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }
    };
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      owner_id: user.id,
      name: trimmedName,
      data: command.data as unknown as Json
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      data: data.data as unknown as CanvasDocument,
      created_at: data.created_at,
      updated_at: data.updated_at
    },
    error: null
  };
}

export type GetDocumentResult =
  | { data: DocumentDto; error: null }
  | { data: null; error: MappedError };

/**
 * Fetch a single document by id (US-009 canvas editor load).
 *
 * Authorisation lives in the database, not here:
 *   - RLS USING enforces `owner_id = auth.uid()` AND `email_confirmed_at IS NOT NULL`
 *     via the `public.user_email_confirmed()` SECURITY DEFINER helper
 *     (migration 20260511000000_fix_documents_rls_email_confirmed.sql).
 *
 * IDOR is impossible from the client: cross-tenant rows and non-existent UUIDs
 * both surface identically as PostgREST `PGRST116` (.single() got 0 rows) →
 * `DOCUMENT_NOT_FOUND`. Existence of other users' documents is not leaked.
 *
 * The PGRST116 → DOCUMENT_NOT_FOUND mapping lives here (not in the generic
 * `mapPostgrestError`) because PGRST116 is a generic "0 or >1 rows" condition;
 * its meaning is endpoint-specific.
 *
 * The returned `DocumentDto` deliberately omits `owner_id` and `share_token*`
 * — those columns have no UI consumer (api-plan.md §3.2).
 */
export async function getDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<GetDocumentResult> {
  const { data, error } = await supabase
    .from('documents')
    .select(SELECT_COLUMNS)
    .eq('id', documentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: error.code
        }
      };
    }
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  // Defence-in-depth: even though `data` JSONB has a CHECK constraint enforcing
  // jsonb_typeof = 'object', a corrupted or pre-codec migration row could still
  // surface here. Surface a typed error rather than crashing the canvas.
  if (!isCanvasDocument(data.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      data: data.data,
      created_at: data.created_at,
      updated_at: data.updated_at
    },
    error: null
  };
}

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.canvasWidth === 'number' &&
    typeof v.canvasHeight === 'number' &&
    Array.isArray(v.shapes) &&
    Array.isArray(v.weldUnits)
  );
}

// ============================================================
// listDocuments — US-008 / US-010 dashboard project list
// ============================================================

export type ListDocumentsSort = 'updated_at_desc' | 'name_asc' | 'created_at_desc';

interface SortConfig {
  column: 'updated_at' | 'created_at' | 'name';
  ascending: boolean;
}

// Whitelist (not a free-form `order` string from the URL) — prevents PostgREST
// from sorting on a column the UI never asked for, e.g. `share_token`, which
// would leak ordering signals about row state to the client.
const SORT_MAP: Record<ListDocumentsSort, SortConfig> = {
  updated_at_desc: { column: 'updated_at', ascending: false },
  name_asc: { column: 'name', ascending: true },
  created_at_desc: { column: 'created_at', ascending: false }
};

export interface ListDocumentsParams {
  /**
   * `auth.uid()` of the caller — redundant with RLS but kept for query-plan
   * clarity and easier debugging. RLS is the only authorisation layer.
   */
  userId: string;
  /** Default 50; clamped down to 100; <1 throws RangeError. */
  limit?: number;
  /** Default 0; <0 throws RangeError. */
  offset?: number;
  /** Default 'updated_at_desc' (covered by `documents_owner_id_updated_at_idx`). */
  sort?: ListDocumentsSort;
}

export interface ListDocumentsResultData {
  items: DocumentListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export type ListDocumentsResult =
  | { data: ListDocumentsResultData; error: null }
  | { data: null; error: MappedError };

/**
 * List documents owned by the authenticated user (US-008/US-010 dashboard).
 *
 * Authorisation lives in the database, not here:
 *   - RLS filters by `owner_id = auth.uid()` AND `email_confirmed_at IS NOT NULL`
 *     via the `public.user_email_confirmed()` SECURITY DEFINER helper. Unconfirmed
 *     users get `[]`, never a 401. Application code MUST NOT add a parallel
 *     ownership check — it would mask RLS regressions in code review.
 *
 * The `data` JSONB column is intentionally excluded from the projection: it
 * can reach 5 MB per row (250 MB on a max-pro account of 50 docs). Treat the
 * absence of `data` here as a non-negotiable invariant.
 *
 * Throws `RangeError` when `limit` / `offset` fail input validation — that's a
 * developer error, never end-user input. Runtime DB errors come back through
 * the discriminated `{ data, error }` return like the rest of this module.
 */
export async function listDocuments(
  supabase: SupabaseClient<Database>,
  params: ListDocumentsParams
): Promise<ListDocumentsResult> {
  const limit = clampListLimit(params.limit);
  const offset = clampListOffset(params.offset);
  const sort = params.sort ?? 'updated_at_desc';
  const { column, ascending } = SORT_MAP[sort];

  const { data, error, count } = await supabase
    .from('documents')
    .select(LIST_SELECT_COLUMNS, { count: 'exact' })
    .eq('owner_id', params.userId)
    .order(column, { ascending })
    .range(offset, offset + limit - 1);

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  return {
    data: {
      items: (data ?? []) as DocumentListItemDto[],
      total: count ?? 0,
      limit,
      offset
    },
    error: null
  };
}

function clampListLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(raw) || raw < MIN_LIST_LIMIT) {
    throw new RangeError(
      `listDocuments: limit must be an integer >= ${MIN_LIST_LIMIT}, got ${raw}`
    );
  }
  return Math.min(raw, MAX_LIST_LIMIT);
}

function clampListOffset(raw: number | undefined): number {
  if (raw === undefined) return 0;
  if (!Number.isInteger(raw) || raw < 0) {
    throw new RangeError(`listDocuments: offset must be an integer >= 0, got ${raw}`);
  }
  return raw;
}

// ============================================================
// renameDocument — US-013 (PATCH /rest/v1/documents)
// ============================================================

export type UpdateDocumentResult =
  | { data: DocumentDto; error: null }
  | { data: null; error: MappedError };

/**
 * Rename a document (US-013).
 *
 * Authorisation lives in the database, not here:
 *   - RLS USING + WITH CHECK enforce `owner_id = auth.uid()` AND email confirmed
 *     via the `public.user_email_confirmed()` SECURITY DEFINER helper.
 *   - DB CHECK `length(trim(name)) > 0 AND length(name) <= 100` is the
 *     authoritative validator; the preflight below only spares the round-trip.
 *
 * The PGRST116 → DOCUMENT_NOT_FOUND mapping is inlined here (rather than in the
 * generic `mapPostgrestError`) because PGRST116 means different things in
 * different endpoint contexts. For PATCH it means either "id not in `documents`"
 * or "RLS denied" — both surface identically; existence of other users' rows is
 * never leaked.
 */
export async function renameDocument(
  supabase: SupabaseClient<Database>,
  documentId: string,
  command: RenameDocumentCommand
): Promise<UpdateDocumentResult> {
  const trimmedName = command.name.trim();
  if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid'
      }
    };
  }

  const { data, error } = await supabase
    .from('documents')
    .update({ name: trimmedName })
    .eq('id', documentId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: error.code
        }
      };
    }
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  if (!isCanvasDocument(data.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      data: data.data,
      created_at: data.created_at,
      updated_at: data.updated_at
    },
    error: null
  };
}

// ============================================================
// saveDocumentData — US-009 autosave (PATCH /rest/v1/documents)
// ============================================================

/**
 * Lightweight projection returned by `saveDocumentData`. The 5 MB `data` blob
 * is intentionally NOT round-tripped on autosave — only the bits the UI needs
 * for the "saved at HH:MM" indicator (api-plan.md, plan §4.1).
 */
export type SavedDocumentDto = Pick<DocumentDto, 'id' | 'name' | 'updated_at'>;

export type SaveDocumentDataResult =
  | { data: SavedDocumentDto; error: null }
  | { data: null; error: MappedError };

/**
 * Persist the canvas scene (US-009 autosave).
 *
 * Debounce, localStorage fallback, and exponential backoff are NOT this
 * helper's responsibility — they belong to the React hook / slice consuming
 * this function. Keeping the helper pure makes it trivially mockable in unit
 * tests and reusable from Server Actions.
 *
 * The DB trigger `documents_before_iu_sync_schema_version` synchronises
 * `documents.schema_version` from `data->schemaVersion` on every UPDATE — that
 * is why we never PATCH `schema_version` directly. The CHECK on
 * `octet_length(data::text)` is the authoritative 5 MB cap; the preflight here
 * mirrors it purely to spare the network round-trip on obviously huge payloads.
 */
export async function saveDocumentData(
  supabase: SupabaseClient<Database>,
  documentId: string,
  command: SaveDocumentDataCommand
): Promise<SaveDocumentDataResult> {
  if (!isCanvasDocument(command.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  const serialized = JSON.stringify(command.data);
  if (serialized.length >= MAX_PAYLOAD_BYTES) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large'
      }
    };
  }

  const { data, error } = await supabase
    .from('documents')
    .update({ data: command.data as unknown as Json })
    .eq('id', documentId)
    .select(AUTOSAVE_SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: error.code
        }
      };
    }
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      updated_at: data.updated_at
    },
    error: null
  };
}

// ============================================================
// deleteDocument — US-011 (DELETE /rest/v1/documents)
// ============================================================

export type DeleteDocumentResult = { data: null; error: null } | { data: null; error: MappedError };

/**
 * Hard-delete a document by id (US-011, RODO art. 17).
 *
 * Authorisation:
 *   - The DB RLS policy `documents_delete_authenticated` is the source of
 *     truth for ownership/email-confirmed: `owner_id = auth.uid()` AND
 *     `public.user_email_confirmed()`. Cross-tenant deletes for OTHER
 *     authenticated users are filtered (0 rows, no error) so existence of
 *     other users' UUIDs cannot be probed by status code (plan §6.7) —
 *     "deleted" and "RLS-filtered" both resolve to `{ error: null }`.
 *
 *   - The `auth.getUser()` preflight below is NOT a duplicate of RLS. It
 *     guards the anon-role-with-no-cookies case: a request without a JWT
 *     hits PostgREST as the `anon` role, which has NO delete policy on
 *     `documents` — RLS filters all rows and PostgREST returns the same
 *     204 No Content as a real delete. Without this check, a user whose
 *     session cookies were lost (logout in another tab, manual cookie
 *     clear, etc.) would see a "deleted" toast for a delete that never
 *     happened. Same defensive pattern as `createDocument`.
 *
 * No `.select()` is chained on purpose: keeping the response empty (`204`)
 * avoids round-tripping the deleted row to the client. The DB has no
 * `BEFORE DELETE` trigger and no FKs point INTO `documents`, so the row is
 * the leaf — single-step delete, no cascade work to mirror here.
 */
export async function deleteDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<DeleteDocumentResult> {
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      data: null,
      error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }
    };
  }

  const { error } = await supabase.from('documents').delete().eq('id', documentId);

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  return { data: null, error: null };
}

// ============================================================
// resizeCanvas — US-014 (PATCH /rest/v1/documents, 3-step RMW)
// ============================================================

/**
 * Resize the canvas (US-014).
 *
 * Three-step read-modify-write: PostgREST cannot atomically merge JSONB, so we
 * SELECT the current `data` blob, splice in the new dimensions, then UPDATE.
 *
 * Race window between the read and the write is accepted for MVP per
 * `architecture-base.md` (single-tab dominant). Post-MVP optimistic concurrency
 * (`.eq('updated_at', expectedUpdatedAt)` on the write) is tracked in backlog
 * and intentionally NOT implemented here. The caller (slice/hook) is expected
 * to block autosave for the duration of resize so concurrent writes from the
 * same tab don't fight this sequence.
 */
export async function resizeCanvas(
  supabase: SupabaseClient<Database>,
  documentId: string,
  command: ResizeCanvasCommand
): Promise<UpdateDocumentResult> {
  if (
    !Number.isFinite(command.canvasWidth) ||
    !Number.isFinite(command.canvasHeight) ||
    command.canvasWidth <= 0 ||
    command.canvasHeight <= 0
  ) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  const { data: currentRow, error: readError } = await supabase
    .from('documents')
    .select('data')
    .eq('id', documentId)
    .single();

  if (readError) {
    if (readError.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: readError.code
        }
      };
    }
    const mapped = mapPostgrestError(readError) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: readError.code,
      rawMessage: readError.message
    };
    return { data: null, error: mapped };
  }

  if (!isCanvasDocument(currentRow.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  // Bind to a typed local — `Json` narrowed by isCanvasDocument is still
  // `Json & CanvasDocument`, which TS refuses to spread because Json includes
  // primitives. The explicit alias drops the Json branch.
  const currentScene: CanvasDocument = currentRow.data;
  const merged: CanvasDocument = {
    ...currentScene,
    canvasWidth: command.canvasWidth,
    canvasHeight: command.canvasHeight
  };

  // Re-check size: a legitimately near-cap document plus the dimension diff
  // could push us over after the merge. Authoritative cap is the DB CHECK.
  if (JSON.stringify(merged).length >= MAX_PAYLOAD_BYTES) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large'
      }
    };
  }

  const { data: updatedRow, error: writeError } = await supabase
    .from('documents')
    .update({ data: merged as unknown as Json })
    .eq('id', documentId)
    .select(SELECT_COLUMNS)
    .single();

  if (writeError) {
    if (writeError.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: writeError.code
        }
      };
    }
    const mapped = mapPostgrestError(writeError) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: writeError.code,
      rawMessage: writeError.message
    };
    return { data: null, error: mapped };
  }

  if (!isCanvasDocument(updatedRow.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  return {
    data: {
      id: updatedRow.id,
      name: updatedRow.name,
      schema_version: updatedRow.schema_version,
      data: updatedRow.data,
      created_at: updatedRow.created_at,
      updated_at: updatedRow.updated_at
    },
    error: null
  };
}
