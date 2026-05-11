import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { assertIsUserPlan, fetchEffectivePlan } from './plan';
import { BusinessError } from './errors';

const USER_ID = '11111111-2222-3333-4444-555555555555';

interface MockOptions {
  data?: unknown;
  error?: Partial<PostgrestError> | null;
}

/**
 * Mock for `supabase.rpc('effective_plan', { uid })`. The SDK exposes the RPC
 * result as a single Promise on the `.rpc()` return value, so a one-shot
 * `vi.fn().mockResolvedValue({ data, error })` is enough — no chain.
 */
function makeSupabase(opts: MockOptions = {}) {
  const response = {
    data: opts.data === undefined ? 'free' : opts.data,
    error: opts.error ?? null
  };
  const rpc = vi.fn().mockResolvedValue(response);
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, spies: { rpc } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertIsUserPlan', () => {
  it("accepts 'free'", () => {
    expect(() => assertIsUserPlan('free')).not.toThrow();
  });

  it("accepts 'pro'", () => {
    expect(() => assertIsUserPlan('pro')).not.toThrow();
  });

  it('rejects unknown strings', () => {
    expect(() => assertIsUserPlan('enterprise')).toThrow(/Unexpected effective_plan value/);
  });

  it('rejects null', () => {
    expect(() => assertIsUserPlan(null)).toThrow();
  });

  it('rejects non-string scalars', () => {
    expect(() => assertIsUserPlan(1)).toThrow();
    expect(() => assertIsUserPlan(true)).toThrow();
    expect(() => assertIsUserPlan(undefined)).toThrow();
  });
});

describe('fetchEffectivePlan — UUID preflight', () => {
  it('rejects an empty string without firing the RPC', async () => {
    const { client, spies } = makeSupabase();
    const result = await fetchEffectivePlan(client, '');

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawMessage).toBe('invalid_uuid');
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed UUID without firing the RPC', async () => {
    const { client, spies } = makeSupabase();
    const result = await fetchEffectivePlan(client, 'not-a-uuid');

    expect(result.error?.rawMessage).toBe('invalid_uuid');
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('accepts UUIDs of any version (regex is structural, not version-strict)', async () => {
    const v1Like = 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee';
    const { client, spies } = makeSupabase({ data: 'free' });
    const result = await fetchEffectivePlan(client, v1Like);

    expect(result.error).toBeNull();
    expect(spies.rpc).toHaveBeenCalledOnce();
  });
});

describe('fetchEffectivePlan — happy path', () => {
  it("returns 'pro' and calls rpc('effective_plan', { uid })", async () => {
    const { client, spies } = makeSupabase({ data: 'pro' });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.data).toBe('pro');
    expect(result.error).toBeNull();
    expect(spies.rpc).toHaveBeenCalledWith('effective_plan', { uid: USER_ID });
  });

  it("returns 'free' for users with no qualifying subscription", async () => {
    const { client } = makeSupabase({ data: 'free' });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.data).toBe('free');
    expect(result.error).toBeNull();
  });
});

describe('fetchEffectivePlan — error mapping', () => {
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
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
  });

  it('maps 42501 (insufficient_privilege) to UNAUTHORIZED', async () => {
    const { client } = makeSupabase({
      error: {
        code: '42501',
        message: 'permission denied for function effective_plan',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
  });

  it('falls back to UNKNOWN for 22P02 (DB rejects UUID after regex passes)', async () => {
    const { client } = makeSupabase({
      error: {
        code: '22P02',
        message: 'invalid input syntax for type uuid',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('22P02');
  });

  it('falls back to UNKNOWN for any unmapped PostgREST error', async () => {
    const { client } = makeSupabase({
      error: {
        code: '99999',
        message: 'mystery',
        details: '',
        hint: '',
        name: 'PostgrestError'
      }
    });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawMessage).toBe('mystery');
  });
});

describe('fetchEffectivePlan — response narrowing', () => {
  it('treats { data: null, error: null } as a transport anomaly', async () => {
    // PostgREST should never return null for this function — the SQL CASE
    // always produces a scalar. If it does, surface UNKNOWN so the caller
    // can fall back to `user_profiles.plan` instead of defaulting to 'free'.
    const { client } = makeSupabase({ data: null });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawMessage).toBe('effective_plan_null_response');
  });

  it('rejects unexpected scalar values (forward-compat guard)', async () => {
    const { client } = makeSupabase({ data: 'enterprise' });
    const result = await fetchEffectivePlan(client, USER_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawMessage).toBe('unexpected_effective_plan_value:enterprise');
  });
});
