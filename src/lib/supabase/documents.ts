import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { CanvasDocument, CreateDocumentCommand, DocumentDto } from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

const MAX_NAME_LENGTH = 100;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const SELECT_COLUMNS = 'id, name, schema_version, data, created_at, updated_at' as const;

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
