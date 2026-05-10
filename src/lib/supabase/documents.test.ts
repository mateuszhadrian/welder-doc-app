import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CanvasDocument, CreateDocumentCommand } from '@/types/api';
import { createDocument } from './documents';
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
