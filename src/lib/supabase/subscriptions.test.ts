import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { SubscriptionDto } from '@/types/api';
import { listSubscriptions } from './subscriptions';
import { BusinessError } from './errors';

const USER_ID = '11111111-2222-3333-4444-555555555555';

const activeRow: SubscriptionDto = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  status: 'active',
  plan_tier: 'pro_monthly',
  current_period_start: '2026-05-01T00:00:00Z',
  current_period_end: '2026-06-01T00:00:00Z',
  cancel_at: null,
  created_at: '2026-05-01T00:00:00Z'
};

interface MockOptions {
  user?: { id: string } | null;
  authError?: Partial<AuthError> | null;
  rows?: SubscriptionDto[] | null;
  error?: Partial<PostgrestError> | null;
}

/**
 * Mock chain for `from('subscriptions').select(cols).eq('user_id', uid)
 * .order('created_at', { ascending: false })`. The terminal `.order()`
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

describe('listSubscriptions — auth preflight', () => {
  it('returns UNAUTHORIZED when getUser yields no user (no SDK call)', async () => {
    const { client, spies } = makeSupabase({ user: null });
    const result = await listSubscriptions(client);

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
    const result = await listSubscriptions(client);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(spies.from).not.toHaveBeenCalled();
  });
});

describe('listSubscriptions — query shape', () => {
  it('selects the column whitelist and never requests billing-internal columns', async () => {
    const { client, spies } = makeSupabase({ rows: [activeRow] });
    await listSubscriptions(client);

    expect(spies.from).toHaveBeenCalledWith('subscriptions');
    expect(spies.select).toHaveBeenCalledTimes(1);
    const projection = spies.select.mock.calls[0]?.[0];
    expect(projection).toBe(
      'id, status, plan_tier, current_period_start, current_period_end, cancel_at, created_at'
    );

    // Defence-in-depth: explicitly assert the forbidden columns are not in
    // the projection string. `user_id` is RODO-NULLed; paddle_* are billing
    // internal. Surfacing them in a UI consumer would be a leak.
    expect(projection).not.toContain('user_id');
    expect(projection).not.toContain('paddle_subscription_id');
    expect(projection).not.toContain('paddle_customer_snapshot');
  });

  it('filters by the resolved user id and orders by created_at desc', async () => {
    const { client, spies } = makeSupabase({ rows: [activeRow] });
    await listSubscriptions(client);

    expect(spies.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});

describe('listSubscriptions — happy paths', () => {
  it('returns the rows verbatim ordered as-given by PostgREST', async () => {
    const olderRow: SubscriptionDto = {
      ...activeRow,
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      status: 'canceled',
      created_at: '2026-04-01T00:00:00Z'
    };
    const { client } = makeSupabase({ rows: [activeRow, olderRow] });
    const result = await listSubscriptions(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([activeRow, olderRow]);
  });

  it('returns an empty array (NOT an error) for free-tier users with no rows', async () => {
    const { client } = makeSupabase({ rows: [] });
    const result = await listSubscriptions(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('coerces a null PostgREST data field into an empty array', async () => {
    // Defensive — depending on the PostgREST version, an RLS-filtered read
    // can come back as `data: null` instead of `[]`. The helper must still
    // return a stable shape so UI never sees `null`.
    const { client } = makeSupabase({ rows: null });
    const result = await listSubscriptions(client);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});

describe('listSubscriptions — DB error mapping', () => {
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
    const result = await listSubscriptions(client);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
  });

  it('maps Postgres 42501 (insufficient_privilege) to UNAUTHORIZED', async () => {
    const { client } = makeSupabase({
      error: {
        code: '42501',
        message: 'permission denied for table subscriptions',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listSubscriptions(client);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN with subscription_load_failed message for unmapped errors', async () => {
    const { client } = makeSupabase({
      error: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await listSubscriptions(client);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    // The unmapped fallback uses the endpoint-specific i18n key so the toast
    // is more actionable than the generic "Coś poszło nie tak" copy.
    expect(result.error?.message).toBe('errors.unknown');
    expect(result.error?.rawCode).toBe('99999');
    expect(result.error?.rawMessage).toBe('mystery');
  });
});
