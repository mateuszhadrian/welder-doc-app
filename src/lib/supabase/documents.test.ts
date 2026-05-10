import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CanvasDocument, CreateDocumentCommand, DocumentListItemDto } from '@/types/api';
import { createDocument, getDocument, listDocuments, type ListDocumentsSort } from './documents';
import { BusinessError } from './errors';

const USER_ID = '11111111-2222-3333-4444-555555555555';

const validData: CanvasDocument = {
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
};

const okRow = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'Nowy projekt',
  schema_version: 1,
  data: validData,
  created_at: '2026-05-08T12:00:00Z',
  updated_at: '2026-05-08T12:00:00Z'
};

interface MockOptions {
  user?: { id: string } | null;
  authError?: Partial<AuthError> | null;
  insertError?: Partial<PostgrestError> | null;
  insertRow?: typeof okRow | null;
}

function makeSupabase(opts: MockOptions = {}) {
  const single = vi.fn().mockResolvedValue({
    data: opts.insertRow ?? null,
    error: opts.insertError ?? null
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user: opts.user === undefined ? { id: USER_ID } : opts.user },
    error: opts.authError ?? null
  });
  const client = { from, auth: { getUser } } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, insert, select, single, getUser } };
}

function makeCommand(overrides: Partial<CreateDocumentCommand> = {}): CreateDocumentCommand {
  return {
    name: 'Nowy projekt',
    data: validData,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createDocument — preflight (no round-trip)', () => {
  it('rejects an empty name as DOCUMENT_NAME_INVALID without contacting the SDK', async () => {
    const { client, spies } = makeSupabase();
    const result = await createDocument(client, makeCommand({ name: '' }));

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
    expect(result.error?.message).toBe('errors.document_name_invalid');
    expect(spies.getUser).not.toHaveBeenCalled();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only name as DOCUMENT_NAME_INVALID', async () => {
    const { client, spies } = makeSupabase();
    const result = await createDocument(client, makeCommand({ name: '   \t  \n ' }));

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 100 characters', async () => {
    const { client } = makeSupabase();
    const result = await createDocument(client, makeCommand({ name: 'x'.repeat(101) }));

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
  });

  it('accepts a 100-character name (boundary)', async () => {
    const { client, spies } = makeSupabase({
      insertRow: { ...okRow, name: 'x'.repeat(100) }
    });
    const result = await createDocument(client, makeCommand({ name: 'x'.repeat(100) }));

    expect(result.error).toBeNull();
    expect(spies.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects data with missing schemaVersion as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabase();
    const result = await createDocument(
      client,
      makeCommand({
        data: {
          canvasWidth: 100,
          canvasHeight: 100,
          shapes: [],
          weldUnits: []
        } as unknown as CanvasDocument
      })
    );

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(result.error?.message).toBe('errors.document_data_shape_invalid');
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects data with non-array shapes as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabase();
    const result = await createDocument(
      client,
      makeCommand({
        data: { ...validData, shapes: null } as unknown as CanvasDocument
      })
    );

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });

  it('rejects data with non-array weldUnits as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabase();
    const result = await createDocument(
      client,
      makeCommand({
        data: { ...validData, weldUnits: 'oops' } as unknown as CanvasDocument
      })
    );

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });

  it('rejects null data as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabase();
    const result = await createDocument(
      client,
      makeCommand({ data: null as unknown as CanvasDocument })
    );

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });

  it('rejects payloads >=5MB as DOCUMENT_PAYLOAD_TOO_LARGE', async () => {
    const { client, spies } = makeSupabase();
    const huge: CanvasDocument = {
      ...validData,
      shapes: [{ blob: 'x'.repeat(5 * 1024 * 1024 + 10) }]
    };
    const result = await createDocument(client, makeCommand({ data: huge }));

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
    expect(result.error?.message).toBe('errors.document_payload_too_large');
    expect(spies.getUser).not.toHaveBeenCalled();
  });
});

describe('createDocument — auth', () => {
  it('returns UNAUTHORIZED when getUser yields no user', async () => {
    const { client, spies } = makeSupabase({ user: null });
    const result = await createDocument(client, makeCommand());

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED when getUser yields an auth error', async () => {
    const { client, spies } = makeSupabase({
      user: null,
      authError: { name: 'AuthError', message: 'session missing', status: 401 }
    });
    const result = await createDocument(client, makeCommand());

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.from).not.toHaveBeenCalled();
  });
});

describe('createDocument — DB error mapping', () => {
  it('maps trigger P0001 project_limit_exceeded to PROJECT_LIMIT_EXCEEDED', async () => {
    const { client } = makeSupabase({
      insertError: {
        code: 'P0001',
        message: 'project_limit_exceeded: free plan allows 1 project',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await createDocument(client, makeCommand());

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.PROJECT_LIMIT_EXCEEDED);
    expect(result.error?.message).toBe('errors.project_limit_exceeded');
  });

  it('maps CHECK 23514 octet_length to DOCUMENT_PAYLOAD_TOO_LARGE', async () => {
    const { client } = makeSupabase({
      insertError: {
        code: '23514',
        message:
          'new row for relation "documents" violates check constraint "documents_data_size_check" (octet_length)',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await createDocument(client, makeCommand());

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
  });

  it('maps PGRST301 (JWT expired) to UNAUTHORIZED', async () => {
    const { client } = makeSupabase({
      insertError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await createDocument(client, makeCommand());

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for an unmapped Postgres error', async () => {
    const { client } = makeSupabase({
      insertError: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await createDocument(client, makeCommand());

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('99999');
  });
});

// ============================================================
// getDocument — fixtures + mocks
// ============================================================

const DOCUMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface GetMockOptions {
  selectRow?: typeof okRow | null;
  selectError?: Partial<PostgrestError> | null;
}

/**
 * Mock chain for `from('documents').select(cols).eq('id', id).single()`.
 * Separate from the createDocument factory because the chain shape differs
 * (no `.insert()` link). Keeping factories distinct avoids shared-state
 * surprises across describe blocks.
 */
function makeSupabaseForGet(opts: GetMockOptions = {}) {
  const single = vi.fn().mockResolvedValue({
    data: opts.selectRow ?? null,
    error: opts.selectError ?? null
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, select, eq, single } };
}

describe('getDocument — happy path', () => {
  it('returns a DocumentDto without owner_id or share_token columns', async () => {
    const { client, spies } = makeSupabaseForGet({ selectRow: okRow });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: okRow.id,
      name: okRow.name,
      schema_version: okRow.schema_version,
      data: validData,
      created_at: okRow.created_at,
      updated_at: okRow.updated_at
    });
    expect(result.data).not.toHaveProperty('owner_id');
    expect(result.data).not.toHaveProperty('share_token');

    expect(spies.from).toHaveBeenCalledWith('documents');
    expect(spies.select).toHaveBeenCalledWith(
      'id, name, schema_version, data, created_at, updated_at'
    );
    expect(spies.eq).toHaveBeenCalledWith('id', DOCUMENT_ID);
    expect(spies.single).toHaveBeenCalledTimes(1);
  });
});

describe('getDocument — DB error mapping', () => {
  it('maps PGRST116 (0 rows from .single()) to DOCUMENT_NOT_FOUND', async () => {
    // PGRST116 is returned when RLS rejects the row OR the UUID does not exist.
    // Both must surface identically — we never leak existence of others' UUIDs.
    const { client } = makeSupabaseForGet({
      selectError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
    expect(result.error?.message).toBe('errors.document_not_found');
    expect(result.error?.rawCode).toBe('PGRST116');
  });

  it('maps PGRST301 (JWT expired) to UNAUTHORIZED', async () => {
    const { client } = makeSupabaseForGet({
      selectError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for an unmapped Postgres error (e.g. 22P02 invalid uuid)', async () => {
    const { client } = makeSupabaseForGet({
      selectError: {
        code: '22P02',
        message: 'invalid input syntax for type uuid',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await getDocument(client, 'not-a-uuid');

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('22P02');
  });
});

describe('getDocument — data integrity guard', () => {
  it('rejects a row whose data column is missing schemaVersion as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabaseForGet({
      selectRow: {
        ...okRow,
        data: {
          canvasWidth: 100,
          canvasHeight: 100,
          shapes: [],
          weldUnits: []
        } as unknown as CanvasDocument
      }
    });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(result.error?.message).toBe('errors.document_data_shape_invalid');
  });

  it('rejects a row whose data column is null as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabaseForGet({
      selectRow: { ...okRow, data: null as unknown as CanvasDocument }
    });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });

  it('rejects a row with non-array shapes as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabaseForGet({
      selectRow: {
        ...okRow,
        data: { ...validData, shapes: 'oops' } as unknown as CanvasDocument
      }
    });
    const result = await getDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });
});

describe('createDocument — happy path', () => {
  it('returns a DocumentDto without owner_id or share_token columns', async () => {
    const { client, spies } = makeSupabase({ insertRow: okRow });
    const result = await createDocument(client, makeCommand());

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: okRow.id,
      name: okRow.name,
      schema_version: okRow.schema_version,
      data: validData,
      created_at: okRow.created_at,
      updated_at: okRow.updated_at
    });
    expect(result.data).not.toHaveProperty('owner_id');
    expect(result.data).not.toHaveProperty('share_token');

    expect(spies.from).toHaveBeenCalledWith('documents');
    expect(spies.insert).toHaveBeenCalledWith({
      owner_id: USER_ID,
      name: 'Nowy projekt',
      data: validData
    });
    expect(spies.select).toHaveBeenCalledWith(
      'id, name, schema_version, data, created_at, updated_at'
    );
  });

  it('trims the name before inserting', async () => {
    const { client, spies } = makeSupabase({ insertRow: okRow });
    await createDocument(client, makeCommand({ name: '  Nowy projekt   ' }));

    expect(spies.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nowy projekt' }));
  });
});

// ============================================================
// listDocuments — fixtures + mocks
// ============================================================

const listRow: DocumentListItemDto = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'Nowy projekt',
  created_at: '2026-05-08T12:00:00Z',
  updated_at: '2026-05-08T12:00:00Z'
};

interface ListMockOptions {
  rows?: DocumentListItemDto[] | null;
  count?: number | null;
  error?: Partial<PostgrestError> | null;
}

/**
 * Mock chain for `from('documents').select(cols, { count }).eq('owner_id', uid)
 * .order(col, { ascending }).range(from, to)`. The terminal `.range()` resolves
 * the response — every preceding link returns the same chain object so each
 * call is observable via spies.
 */
function makeSupabaseForList(opts: ListMockOptions = {}) {
  const response = {
    data: opts.rows ?? [],
    error: opts.error ?? null,
    count: opts.count ?? (opts.rows ? opts.rows.length : 0)
  };

  const range = vi.fn().mockResolvedValue(response);
  const order = vi.fn(() => ({ range }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, select, eq, order, range } };
}

describe('listDocuments — defaults + sorting', () => {
  it('uses default limit=50, offset=0, sort=updated_at_desc and reads count', async () => {
    const rows = [listRow, { ...listRow, id: 'bbbbbbbb-1111-2222-3333-444444444444' }];
    const { client, spies } = makeSupabaseForList({ rows, count: 2 });

    const result = await listDocuments(client, { userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      items: rows,
      total: 2,
      limit: 50,
      offset: 0
    });

    expect(spies.from).toHaveBeenCalledWith('documents');
    expect(spies.select).toHaveBeenCalledWith('id, name, created_at, updated_at', {
      count: 'exact'
    });
    expect(spies.eq).toHaveBeenCalledWith('owner_id', USER_ID);
    expect(spies.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(spies.range).toHaveBeenCalledWith(0, 49);
  });

  it("maps sort='name_asc' to order('name', ascending=true)", async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });
    await listDocuments(client, { userId: USER_ID, sort: 'name_asc' });

    expect(spies.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it("maps sort='created_at_desc' to order('created_at', ascending=false)", async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });
    await listDocuments(client, {
      userId: USER_ID,
      sort: 'created_at_desc' satisfies ListDocumentsSort
    });

    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('translates limit/offset into the right .range() bounds', async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });
    await listDocuments(client, { userId: USER_ID, limit: 10, offset: 20 });

    // range is INCLUSIVE on both ends: offset..offset+limit-1.
    expect(spies.range).toHaveBeenCalledWith(20, 29);
  });

  it('clamps limit > 100 down to 100', async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });
    const result = await listDocuments(client, { userId: USER_ID, limit: 500 });

    expect(spies.range).toHaveBeenCalledWith(0, 99);
    expect(result.data?.limit).toBe(100);
  });
});

describe('listDocuments — empty + RLS-hidden state', () => {
  it('returns items=[] / total=0 when the user has no documents', async () => {
    const { client } = makeSupabaseForList({ rows: [], count: 0 });
    const result = await listDocuments(client, { userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('returns items=[] when PostgREST hands back null data + null count', async () => {
    // Defensive — RLS-filtered responses can come back as `data: null, count: null`
    // depending on PostgREST version; the helper must still return a stable shape.
    const { client } = makeSupabaseForList({ rows: null, count: null });
    const result = await listDocuments(client, { userId: USER_ID });

    expect(result.error).toBeNull();
    expect(result.data?.items).toEqual([]);
    expect(result.data?.total).toBe(0);
  });
});

describe('listDocuments — input guards (developer errors)', () => {
  it('throws RangeError on limit=0 before contacting the SDK', async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });

    await expect(listDocuments(client, { userId: USER_ID, limit: 0 })).rejects.toBeInstanceOf(
      RangeError
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('throws RangeError on negative limit', async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });

    await expect(listDocuments(client, { userId: USER_ID, limit: -1 })).rejects.toBeInstanceOf(
      RangeError
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('throws RangeError on negative offset', async () => {
    const { client, spies } = makeSupabaseForList({ rows: [] });

    await expect(listDocuments(client, { userId: USER_ID, offset: -1 })).rejects.toBeInstanceOf(
      RangeError
    );
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('throws RangeError on non-integer limit (NaN)', async () => {
    const { client } = makeSupabaseForList({ rows: [] });

    await expect(listDocuments(client, { userId: USER_ID, limit: NaN })).rejects.toBeInstanceOf(
      RangeError
    );
  });

  it('throws RangeError on fractional offset', async () => {
    const { client } = makeSupabaseForList({ rows: [] });

    await expect(listDocuments(client, { userId: USER_ID, offset: 1.5 })).rejects.toBeInstanceOf(
      RangeError
    );
  });
});

describe('listDocuments — DB error mapping', () => {
  it('maps PGRST301 (JWT expired) to UNAUTHORIZED', async () => {
    const { client } = makeSupabaseForList({
      error: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listDocuments(client, { userId: USER_ID });

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for unmapped Postgres errors', async () => {
    const { client } = makeSupabaseForList({
      error: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listDocuments(client, { userId: USER_ID });

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('99999');
    expect(result.error?.rawMessage).toBe('mystery');
  });
});
