import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ConsentLogItemDto } from '@/types/api';
import { listConsentLog } from './consentLog';
import { BusinessError } from './errors';

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const tosRow: ConsentLogItemDto = {
  consent_type: 'terms_of_service',
  version: '1.0',
  accepted: true,
  accepted_at: '2026-01-01T00:00:00Z'
};

const cookiesRow: ConsentLogItemDto = {
  consent_type: 'cookies',
  version: '1.0',
  accepted: false,
  accepted_at: '2026-03-01T00:00:00Z'
};

interface MockOptions {
  user?: { id: string } | null;
  authError?: Partial<AuthError> | null;
  rows?: ConsentLogItemDto[] | null;
  error?: Partial<PostgrestError> | null;
}

/**
 * Mock chain for `from('consent_log').select(cols).eq('user_id', uid)
 * .order('accepted_at', { ascending: false })`. The terminal `.order()`
 * resolves the response — every preceding link returns the same chain
 * object so each call is observable via spies.
 */
function makeSupabase(opts: MockOptions = {}) {
  const response = {
    data: opts.rows ?? [],
    error: opts.error ?? null
  };

  const order = vi.fn().mockResolvedValue(response);
  const eq = vi.fn((_col: string, _val: string) => ({ order }));
  const select = vi.fn((_cols: string) => ({ eq }));
  const from = vi.fn((_table: string) => ({ select }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user: opts.user === undefined ? { id: USER_ID } : opts.user },
    error: opts.authError ?? null
  });
  const client = { from, auth: { getUser } } as unknown as SupabaseClient<Database>;
  return { client, spies: { from, select, eq, order, getUser } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listConsentLog — auth preflight', () => {
  it('returns UNAUTHORIZED when getUser yields no user (no SDK call)', async () => {
    const { client, spies } = makeSupabase({ user: null });
    const result = await listConsentLog(client);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED when getUser yields an auth error', async () => {
    const { client, spies } = makeSupabase({
      user: null,
      authError: { name: 'AuthError', message: 'session missing', status: 401 }
    });
    const result = await listConsentLog(client);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.from).not.toHaveBeenCalled();
  });
});

describe('listConsentLog — query shape', () => {
  it('selects the column whitelist and never requests audit/PII columns', async () => {
    const { client, spies } = makeSupabase({ rows: [tosRow] });
    await listConsentLog(client);

    expect(spies.from).toHaveBeenCalledWith('consent_log');
    expect(spies.select).toHaveBeenCalledTimes(1);
    const projection = spies.select.mock.calls[0]?.[0];
    expect(projection).toBe('consent_type, version, accepted, accepted_at');

    // Defence-in-depth: explicitly assert the forbidden columns are not in
    // the projection string. `ip_address` is privacy-sensitive INET;
    // `user_agent` is audit-only; `user_id` / `id` are not user-visible.
    expect(projection).not.toContain('ip_address');
    expect(projection).not.toContain('user_agent');
    expect(projection).not.toContain('user_id');
    // Word-boundary check so `accepted_at` doesn't trip the `id` assertion.
    expect(projection).not.toMatch(/(^|\s|,)id(\s|,|$)/);
  });

  it('filters by the resolved user id and orders by accepted_at desc', async () => {
    const { client, spies } = makeSupabase({ rows: [tosRow] });
    await listConsentLog(client);

    expect(spies.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(spies.order).toHaveBeenCalledWith('accepted_at', { ascending: false });
  });
});

describe('listConsentLog — happy paths', () => {
  it('returns the rows verbatim ordered as-given by PostgREST', async () => {
    const { client } = makeSupabase({ rows: [cookiesRow, tosRow] });
    const result = await listConsentLog(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([cookiesRow, tosRow]);
  });

  it('returns an empty array (NOT an error) when the user has no consent rows', async () => {
    const { client } = makeSupabase({ rows: [] });
    const result = await listConsentLog(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('coerces a null PostgREST data field into an empty array', async () => {
    // Defensive — depending on the PostgREST version, an RLS-filtered read
    // can come back as `data: null` instead of `[]`. The helper must still
    // return a stable shape so UI never sees `null`.
    const { client } = makeSupabase({ rows: null });
    const result = await listConsentLog(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});

describe('listConsentLog — DB error mapping', () => {
  it('maps PGRST301 (JWT expired) to UNAUTHORIZED via mapPostgrestError', async () => {
    const { client } = makeSupabase({
      error: {
        code: 'PGRST301',
        message: 'JWT expired',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listConsentLog(client);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
  });

  it('maps Postgres 42501 (insufficient_privilege) to UNAUTHORIZED', async () => {
    const { client } = makeSupabase({
      error: {
        code: '42501',
        message: 'permission denied for table consent_log',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listConsentLog(client);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for unmapped errors and preserves raw diagnostics', async () => {
    const { client } = makeSupabase({
      error: {
        code: '08006',
        message: 'connection failure',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listConsentLog(client);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.message).toBe('errors.unknown');
    expect(result.error?.rawCode).toBe('08006');
    expect(result.error?.rawMessage).toBe('connection failure');
  });
});
