import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CanvasDocument, CreateDocumentCommand, DocumentListItemDto } from '@/types/api';
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  renameDocument,
  resizeCanvas,
  saveDocumentData,
  type ListDocumentsSort
} from './documents';
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

// ============================================================
// renameDocument — fixtures + mocks
// ============================================================

interface UpdateMockOptions {
  selectRow?: typeof okRow | null;
  selectError?: Partial<PostgrestError> | null;
}

/**
 * Mock chain for `from('documents').update(payload).eq('id', id).select(cols).single()`.
 * The terminal `.single()` resolves; every preceding link returns the same
 * chain so each call is observable via spies.
 */
function makeSupabaseForUpdate(opts: UpdateMockOptions = {}) {
  const single = vi.fn().mockResolvedValue({
    data: opts.selectRow ?? null,
    error: opts.selectError ?? null
  });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, update, eq, select, single } };
}

describe('renameDocument — preflight (no round-trip)', () => {
  it('rejects an empty name as DOCUMENT_NAME_INVALID without contacting the SDK', async () => {
    const { client, spies } = makeSupabaseForUpdate();
    const result = await renameDocument(client, DOCUMENT_ID, { name: '' });

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
    expect(result.error?.message).toBe('errors.document_name_invalid');
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only name as DOCUMENT_NAME_INVALID', async () => {
    const { client, spies } = makeSupabaseForUpdate();
    const result = await renameDocument(client, DOCUMENT_ID, { name: '   \t  \n ' });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 100 characters', async () => {
    const { client } = makeSupabaseForUpdate();
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'x'.repeat(101) });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
  });

  it('accepts a 100-character name (boundary)', async () => {
    const { client, spies } = makeSupabaseForUpdate({
      selectRow: { ...okRow, name: 'x'.repeat(100) }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'x'.repeat(100) });

    expect(result.error).toBeNull();
    expect(spies.update).toHaveBeenCalledTimes(1);
  });
});

describe('renameDocument — happy path', () => {
  it('returns a full DocumentDto and trims the name before PATCHing', async () => {
    const { client, spies } = makeSupabaseForUpdate({
      selectRow: { ...okRow, name: 'Nowa nazwa' }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: '  Nowa nazwa   ' });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      id: okRow.id,
      name: 'Nowa nazwa',
      schema_version: okRow.schema_version,
      data: validData,
      created_at: okRow.created_at,
      updated_at: okRow.updated_at
    });
    expect(result.data).not.toHaveProperty('owner_id');

    expect(spies.from).toHaveBeenCalledWith('documents');
    expect(spies.update).toHaveBeenCalledWith({ name: 'Nowa nazwa' });
    expect(spies.eq).toHaveBeenCalledWith('id', DOCUMENT_ID);
    expect(spies.select).toHaveBeenCalledWith(
      'id, name, schema_version, data, created_at, updated_at'
    );
  });
});

describe('renameDocument — DB error mapping', () => {
  it('maps PGRST116 (0 rows from .single()) to DOCUMENT_NOT_FOUND', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'ok' });

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
    expect(result.error?.rawCode).toBe('PGRST116');
  });

  it('maps CHECK 23514 length(trim(name)) to DOCUMENT_NAME_INVALID', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: '23514',
        message:
          'new row for relation "documents" violates check constraint "documents_name_check" (length(trim(name)))',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'ok' });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
  });

  it('maps PGRST301 (JWT expired) to UNAUTHORIZED', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'ok' });

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for an unmapped Postgres error', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'ok' });

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('99999');
  });
});

describe('renameDocument — data integrity guard', () => {
  it('surfaces DOCUMENT_DATA_SHAPE_INVALID if the returned row has a corrupted data blob', async () => {
    // Defence-in-depth: if pre-codec migration leaves a row with malformed JSONB,
    // the caller should not crash trying to render it. PATCH success + bad data
    // is a real (rare) state — the helper must surface it.
    const { client } = makeSupabaseForUpdate({
      selectRow: { ...okRow, data: null as unknown as CanvasDocument }
    });
    const result = await renameDocument(client, DOCUMENT_ID, { name: 'ok' });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });
});

// ============================================================
// saveDocumentData — autosave write
// ============================================================

describe('saveDocumentData — preflight (no round-trip)', () => {
  it('rejects null data as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabaseForUpdate();
    const result = await saveDocumentData(client, DOCUMENT_ID, {
      data: null as unknown as CanvasDocument
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects data with non-array shapes as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabaseForUpdate();
    const result = await saveDocumentData(client, DOCUMENT_ID, {
      data: { ...validData, shapes: 'oops' } as unknown as CanvasDocument
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects payloads >=5MB as DOCUMENT_PAYLOAD_TOO_LARGE without contacting the SDK', async () => {
    const { client, spies } = makeSupabaseForUpdate();
    const huge: CanvasDocument = {
      ...validData,
      shapes: [{ blob: 'x'.repeat(5 * 1024 * 1024 + 10) }]
    };
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: huge });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
    expect(spies.from).not.toHaveBeenCalled();
  });
});

describe('saveDocumentData — happy path', () => {
  it('returns the lightweight projection (id, name, updated_at only) — no data blob round-tripped', async () => {
    // Cheap response — drops the 5 MB blob to keep autosave round-trip
    // bandwidth-bounded.
    const lightRow = { id: okRow.id, name: okRow.name, updated_at: okRow.updated_at };
    const { client, spies } = makeSupabaseForUpdate({
      selectRow: lightRow as unknown as typeof okRow
    });
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: validData });

    expect(result.error).toBeNull();
    expect(result.data).toEqual(lightRow);
    expect(result.data).not.toHaveProperty('data');
    expect(result.data).not.toHaveProperty('schema_version');

    expect(spies.update).toHaveBeenCalledWith({ data: validData });
    expect(spies.eq).toHaveBeenCalledWith('id', DOCUMENT_ID);
    expect(spies.select).toHaveBeenCalledWith('id, name, updated_at');
  });
});

describe('saveDocumentData — DB error mapping', () => {
  it('maps PGRST116 (0 rows from .single()) to DOCUMENT_NOT_FOUND', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: validData });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
  });

  it('maps CHECK 23514 octet_length to DOCUMENT_PAYLOAD_TOO_LARGE', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: '23514',
        message:
          'new row for relation "documents" violates check constraint "documents_data_size_check" (octet_length)',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: validData });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
  });

  it('maps PGRST301 (JWT expired) to UNAUTHORIZED', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: validData });

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for an unmapped Postgres error', async () => {
    const { client } = makeSupabaseForUpdate({
      selectError: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await saveDocumentData(client, DOCUMENT_ID, { data: validData });

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('99999');
  });
});

// ============================================================
// resizeCanvas — 3-step read-modify-write
// ============================================================

interface ResizeMockOptions {
  readRow?: { data: CanvasDocument } | null;
  readError?: Partial<PostgrestError> | null;
  writeRow?: typeof okRow | null;
  writeError?: Partial<PostgrestError> | null;
}

/**
 * Mock that responds differently to SELECT vs UPDATE. `from()` returns a
 * chain whose terminal `.single()` returns the read response on the first
 * call and the write response on the second. Built ad-hoc because the SELECT
 * chain (`select → eq → single`) and UPDATE chain (`update → eq → select → single`)
 * diverge, but both end in `.single()`.
 */
function makeSupabaseForResize(opts: ResizeMockOptions = {}) {
  const readResponse = {
    data: opts.readRow ?? null,
    error: opts.readError ?? null
  };
  const writeResponse = {
    data: opts.writeRow ?? null,
    error: opts.writeError ?? null
  };

  const readSingle = vi.fn().mockResolvedValue(readResponse);
  const readEq = vi.fn(() => ({ single: readSingle }));
  const readSelect = vi.fn(() => ({ eq: readEq }));

  const writeSingle = vi.fn().mockResolvedValue(writeResponse);
  const writeSelect = vi.fn(() => ({ single: writeSingle }));
  const writeEq = vi.fn(() => ({ select: writeSelect }));
  const update = vi.fn(() => ({ eq: writeEq }));

  // `from('documents')` exposes BOTH `.select` (read path) and `.update`
  // (write path). The first call resolves to the read chain, the second to
  // the write chain — matches the actual SDK fluent surface.
  const from = vi.fn(() => ({ select: readSelect, update }));
  const client = { from } as unknown as SupabaseClient<Database>;

  return {
    client,
    spies: {
      from,
      readSelect,
      readEq,
      readSingle,
      update,
      writeEq,
      writeSelect,
      writeSingle
    }
  };
}

describe('resizeCanvas — preflight (no round-trip)', () => {
  it('rejects non-positive width as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabaseForResize();
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 0,
      canvasHeight: 2100
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects negative height as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabaseForResize();
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 2970,
      canvasHeight: -1
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects NaN dimensions as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client, spies } = makeSupabaseForResize();
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: NaN,
      canvasHeight: 2100
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('rejects Infinity dimensions as DOCUMENT_DATA_SHAPE_INVALID', async () => {
    const { client } = makeSupabaseForResize();
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: Number.POSITIVE_INFINITY,
      canvasHeight: 2100
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });
});

describe('resizeCanvas — 3-step happy path', () => {
  it('reads current data, merges new dimensions, and writes the merged blob', async () => {
    const existingScene: CanvasDocument = {
      schemaVersion: 1,
      canvasWidth: 2970,
      canvasHeight: 2100,
      shapes: [{ id: 's1' }, { id: 's2' }],
      weldUnits: [{ id: 'u1' }]
    };
    const mergedScene: CanvasDocument = {
      ...existingScene,
      canvasWidth: 4000,
      canvasHeight: 3000
    };

    const { client, spies } = makeSupabaseForResize({
      readRow: { data: existingScene },
      writeRow: { ...okRow, data: mergedScene }
    });

    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 4000,
      canvasHeight: 3000
    });

    expect(result.error).toBeNull();
    expect(result.data?.data).toEqual(mergedScene);

    // Step 1 — read just the data column.
    expect(spies.readSelect).toHaveBeenCalledWith('data');
    expect(spies.readEq).toHaveBeenCalledWith('id', DOCUMENT_ID);

    // Step 3 — write the merged blob; preserves shapes/weldUnits/schemaVersion.
    expect(spies.update).toHaveBeenCalledWith({ data: mergedScene });
    expect(spies.writeEq).toHaveBeenCalledWith('id', DOCUMENT_ID);
    expect(spies.writeSelect).toHaveBeenCalledWith(
      'id, name, schema_version, data, created_at, updated_at'
    );
  });

  it('preserves schemaVersion, shapes, and weldUnits from the existing scene', async () => {
    const existingScene: CanvasDocument = {
      schemaVersion: 7,
      canvasWidth: 100,
      canvasHeight: 100,
      shapes: [{ id: 'keep-me' }],
      weldUnits: [{ id: 'unit-keep-me' }]
    };

    const { client, spies } = makeSupabaseForResize({
      readRow: { data: existingScene },
      writeRow: { ...okRow }
    });

    await resizeCanvas(client, DOCUMENT_ID, { canvasWidth: 200, canvasHeight: 200 });

    // The exact `data` arg passed to update() — proves the merge logic.
    // `vi.fn()` infers a no-arg call signature; cast through `unknown` to read
    // the actual args we know the SUT passed.
    const updateCalls = spies.update.mock.calls as unknown as Array<[{ data: CanvasDocument }]>;
    const writtenPayload = updateCalls[0]?.[0];
    expect(writtenPayload).toBeDefined();
    expect(writtenPayload?.data.schemaVersion).toBe(7);
    expect(writtenPayload?.data.shapes).toEqual([{ id: 'keep-me' }]);
    expect(writtenPayload?.data.weldUnits).toEqual([{ id: 'unit-keep-me' }]);
    expect(writtenPayload?.data.canvasWidth).toBe(200);
    expect(writtenPayload?.data.canvasHeight).toBe(200);
  });
});

describe('resizeCanvas — read-step error handling', () => {
  it('maps read-step PGRST116 to DOCUMENT_NOT_FOUND and never issues the write', async () => {
    const { client, spies } = makeSupabaseForResize({
      readError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('surfaces DOCUMENT_DATA_SHAPE_INVALID if existing data blob is corrupt', async () => {
    const { client, spies } = makeSupabaseForResize({
      readRow: { data: null as unknown as CanvasDocument }
    });
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('maps read-step PGRST301 (JWT expired) to UNAUTHORIZED and never issues the write', async () => {
    const { client, spies } = makeSupabaseForResize({
      readError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.update).not.toHaveBeenCalled();
  });
});

describe('resizeCanvas — write-step error handling', () => {
  it('maps write-step CHECK 23514 octet_length to DOCUMENT_PAYLOAD_TOO_LARGE', async () => {
    const { client } = makeSupabaseForResize({
      readRow: { data: validData },
      writeError: {
        code: '23514',
        message:
          'new row for relation "documents" violates check constraint "documents_data_size_check" (octet_length)',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
  });

  it('maps write-step PGRST116 to DOCUMENT_NOT_FOUND (row deleted between read and write)', async () => {
    const { client } = makeSupabaseForResize({
      readRow: { data: validData },
      writeError: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
  });
});

describe('resizeCanvas — post-merge payload size guard', () => {
  it('rejects DOCUMENT_PAYLOAD_TOO_LARGE if the merged scene exceeds 5MB without issuing the write', async () => {
    // A near-cap existing scene + dimension change can tip over. Authoritative
    // cap is the DB CHECK; this preflight is a band-aid against obvious cases.
    const nearCapScene: CanvasDocument = {
      ...validData,
      shapes: [{ blob: 'x'.repeat(5 * 1024 * 1024 + 50) }]
    };
    const { client, spies } = makeSupabaseForResize({
      readRow: { data: nearCapScene }
    });

    const result = await resizeCanvas(client, DOCUMENT_ID, {
      canvasWidth: 200,
      canvasHeight: 200
    });

    expect(result.error?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
    expect(spies.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// deleteDocument — fixtures + mocks
// ============================================================

interface DeleteMockOptions {
  deleteError?: Partial<PostgrestError> | null;
  user?: { id: string } | null;
  authError?: Partial<AuthError> | null;
}

/**
 * Mock chain for `from('documents').delete().eq('id', id)` + `auth.getUser()`.
 * Terminal `.eq()` resolves directly — DELETE deliberately does NOT chain
 * `.select()` / `.single()` (keeps the response empty per plan §2). The
 * `getUser` preflight guards the anon-cookies-gone case where PostgREST
 * would otherwise return 204 with 0 rows under the `anon` role.
 */
function makeSupabaseForDelete(opts: DeleteMockOptions = {}) {
  const eq = vi.fn().mockResolvedValue({
    data: null,
    error: opts.deleteError ?? null
  });
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user: opts.user === undefined ? { id: USER_ID } : opts.user },
    error: opts.authError ?? null
  });
  const client = { from, auth: { getUser } } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, delete: del, eq, getUser } };
}

describe('deleteDocument — auth preflight', () => {
  it('returns UNAUTHORIZED without contacting the table when getUser returns no user', async () => {
    // Cleared-cookies case: anonymous request would otherwise reach PostgREST
    // as the `anon` role and produce a misleading 204 with 0 rows affected
    // (RLS filters all rows under the documents_delete_authenticated policy,
    // which is FOR authenticated only). The preflight short-circuits this so
    // the UI never shows a "deleted" toast for a delete that didn't happen.
    const { client, spies } = makeSupabaseForDelete({ user: null });
    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.delete).not.toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED when getUser surfaces an AuthError', async () => {
    const { client, spies } = makeSupabaseForDelete({
      user: null,
      authError: { name: 'AuthSessionMissingError', message: 'Auth session missing!' }
    });
    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('proceeds to the delete when getUser returns a user', async () => {
    const { client, spies } = makeSupabaseForDelete();
    await deleteDocument(client, DOCUMENT_ID);

    expect(spies.getUser).toHaveBeenCalledTimes(1);
    expect(spies.delete).toHaveBeenCalledTimes(1);
  });
});

describe('deleteDocument — happy path', () => {
  it('returns { data: null, error: null } when the SDK reports no error', async () => {
    const { client } = makeSupabaseForDelete();
    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result).toEqual({ data: null, error: null });
  });

  it('calls from(documents).delete().eq(id, documentId) with no .select() chained', async () => {
    const { client, spies } = makeSupabaseForDelete();
    await deleteDocument(client, DOCUMENT_ID);

    expect(spies.from).toHaveBeenCalledWith('documents');
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.eq).toHaveBeenCalledWith('id', DOCUMENT_ID);
    // Idempotent surface: no `.select()` is exposed on the chain mock, so a
    // regression that adds `.select()` would crash this test (TypeError).
    const firstCall = spies.delete.mock.results[0];
    if (!firstCall) throw new Error('delete() was never called');
    const eqResult = await firstCall.value.eq('id', DOCUMENT_ID);
    expect(eqResult).not.toHaveProperty('select');
  });

  it('idempotent: same { data: null, error: null } when the row never existed (RLS / 0 rows)', async () => {
    // Without `.single()`, PostgREST does NOT raise PGRST116 for 0 rows
    // affected. RLS rejection (other user's row) and "already deleted" both
    // surface as the same success — by design (plan §6.7 — no info leakage).
    const { client } = makeSupabaseForDelete();
    const result = await deleteDocument(client, '99999999-9999-9999-9999-999999999999');

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
});

describe('deleteDocument — DB error mapping', () => {
  it('maps PGRST301 (JWT expired) to UNAUTHORIZED via mapPostgrestError', async () => {
    const { client } = makeSupabaseForDelete({
      deleteError: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });

    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
  });

  it('maps 42501 (insufficient_privilege) to UNAUTHORIZED', async () => {
    const { client } = makeSupabaseForDelete({
      deleteError: {
        code: '42501',
        message: 'permission denied for table documents',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });

    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN with rawCode/rawMessage for an unrecognised PostgrestError', async () => {
    const { client } = makeSupabaseForDelete({
      deleteError: {
        code: '08006',
        message: 'connection failure',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });

    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('08006');
    expect(result.error?.rawMessage).toBe('connection failure');
  });

  it('falls back to UNKNOWN for a PostgrestError with an undefined code', async () => {
    // Defensive: `mapPostgrestError` returns its UNKNOWN MappedError for any
    // non-null error it doesn't recognise; verify deleteDocument forwards
    // that without crashing on the missing code.
    const { client } = makeSupabaseForDelete({
      deleteError: {
        message: 'something went wrong',
        details: '',
        hint: '',
        name: 'PostgrestError'
      } as Partial<PostgrestError>
    });

    const result = await deleteDocument(client, DOCUMENT_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
  });
});
