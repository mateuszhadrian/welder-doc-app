import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type {
  CanvasDocument,
  CreateDocumentCommand,
  DocumentDto,
  DocumentListItemDto
} from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

const MAX_NAME_LENGTH = 100;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const SELECT_COLUMNS = 'id, name, schema_version, data, created_at, updated_at' as const;
const LIST_SELECT_COLUMNS = 'id, name, created_at, updated_at' as const;

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
