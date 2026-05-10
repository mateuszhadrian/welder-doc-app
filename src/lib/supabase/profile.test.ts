import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const eqMock = vi.fn(() => ({ select: selectMock }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock('./client', () => ({
  createClient: () => ({ from: fromMock })
}));

import { getUserProfile, updateProfile, type SafeUpdate } from './profile';
import { BusinessError } from './errors';

const USER_ID = '00000000-0000-0000-0000-000000000001';

const okRow = {
  id: USER_ID,
  plan: 'free',
  locale: 'en',
  paddle_customer_id: null,
  current_consent_version: '1.0',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-05-09T12:00:00Z'
};

const successResponse = { data: okRow, error: null, count: null, status: 200, statusText: 'OK' };

beforeEach(() => {
  fromMock.mockClear();
  updateMock.mockClear();
  eqMock.mockClear();
  selectMock.mockClear();
  singleMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('updateProfile', () => {
  it('Test A — happy path: PATCH-uje wyłącznie dozwolone pola i filtruje po id', async () => {
    singleMock.mockResolvedValue(successResponse);

    const result = await updateProfile(USER_ID, { locale: 'en' });

    expect(fromMock).toHaveBeenCalledWith('user_profiles');
    expect(updateMock).toHaveBeenCalledWith({ locale: 'en' });
    expect(eqMock).toHaveBeenCalledWith('id', USER_ID);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(singleMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(successResponse);
  });

  it('Test B — runtime defense: chronione pola są zdejmowane z patcha', async () => {
    singleMock.mockResolvedValue(successResponse);
    vi.stubEnv('NODE_ENV', 'production');

    await updateProfile(USER_ID, {
      locale: 'en',
      plan: 'pro',
      paddle_customer_id: 'cus_xyz',
      current_consent_version: '2.0'
    } as unknown as SafeUpdate);

    expect(updateMock).toHaveBeenCalledWith({ locale: 'en' });
  });

  it('Test C — empty-patch shortcut: brak round-tripu, zwraca null/null', async () => {
    const result = await updateProfile(USER_ID, {
      plan: 'pro',
      paddle_customer_id: 'cus_xyz',
      current_consent_version: '2.0'
    } as unknown as SafeUpdate);

    expect(fromMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  it('Test D — error PostgrestError jest przepuszczany bez opakowania', async () => {
    const error = {
      code: '23514',
      message: "new row violates check constraint \"locale IN ('pl','en')\"",
      details: '',
      hint: ''
    } as PostgrestError;
    singleMock.mockResolvedValue({
      data: null,
      error,
      count: null,
      status: 400,
      statusText: 'Bad Request'
    });

    const result = await updateProfile(USER_ID, { locale: 'de' as 'pl' | 'en' });

    expect(result.data).toBeNull();
    expect(result.error).toBe(error);
    expect(result.error?.code).toBe('23514');
  });

  it('Test E — dev warning: console.warn wywołany dla protected key', async () => {
    singleMock.mockResolvedValue(successResponse);
    vi.stubEnv('NODE_ENV', 'development');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await updateProfile(USER_ID, {
      locale: 'en',
      plan: 'pro'
    } as unknown as SafeUpdate);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('plan');
  });

  it('Test E.2 — w production console.warn nie jest wywoływany', async () => {
    singleMock.mockResolvedValue(successResponse);
    vi.stubEnv('NODE_ENV', 'production');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await updateProfile(USER_ID, {
      locale: 'en',
      plan: 'pro'
    } as unknown as SafeUpdate);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// getUserProfile()
// Chain shape: from('user_profiles').select(COLUMNS).eq('id', userId).single()
// ----------------------------------------------------------------------------

interface ReadChainSpies {
  client: SupabaseClient<Database>;
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function makeReadClient(singleResult: unknown): ReadChainSpies {
  const single = vi.fn().mockResolvedValue(singleResult);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    select,
    eq,
    single
  };
}

const profileRow = {
  id: USER_ID,
  plan: 'free',
  locale: 'pl',
  current_consent_version: '1.0',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-05-09T12:00:00Z'
};

describe('getUserProfile', () => {
  it('Test A — happy path: zwraca UserProfileDto z dokładną listą kolumn', async () => {
    const spies = makeReadClient({
      data: profileRow,
      error: null,
      count: null,
      status: 200,
      statusText: 'OK'
    });

    const result = await getUserProfile(spies.client, USER_ID);

    expect(spies.from).toHaveBeenCalledWith('user_profiles');
    // Allowlist explicitly excludes paddle_customer_id.
    expect(spies.select).toHaveBeenCalledWith(
      'id, plan, locale, current_consent_version, created_at, updated_at'
    );
    expect(spies.eq).toHaveBeenCalledWith('id', USER_ID);
    expect(spies.single).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(profileRow);
  });

  it('Test B — PGRST301 (JWT expired) → MappedError UNAUTHORIZED', async () => {
    const error = {
      code: 'PGRST301',
      message: 'JWT expired',
      details: '',
      hint: ''
    } as PostgrestError;
    const spies = makeReadClient({
      data: null,
      error,
      count: null,
      status: 401,
      statusText: 'Unauthorized'
    });

    const result = await getUserProfile(spies.client, USER_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(result.error?.message).toBe('errors.unauthorized');
  });

  it('Test C — PGRST116 (no row, single() failed) → MappedError UNKNOWN', async () => {
    // PostgREST `.single()` returns PGRST116 when 0 rows match. With RLS the
    // forged-id case looks identical: 0 rows, single() escalates to error.
    const error = {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
      details: 'Results contain 0 rows',
      hint: ''
    } as PostgrestError;
    const spies = makeReadClient({
      data: null,
      error,
      count: null,
      status: 406,
      statusText: 'Not Acceptable'
    });

    const result = await getUserProfile(spies.client, USER_ID);

    expect(result.data).toBeNull();
    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.message).toBe('errors.unknown');
    expect(result.error?.rawCode).toBe('PGRST116');
  });

  it('Test D — generic PostgrestError → UNKNOWN z rawCode/rawMessage do dev logów', async () => {
    const error = {
      code: '42P01',
      message: 'relation "user_profiles" does not exist',
      details: '',
      hint: ''
    } as PostgrestError;
    const spies = makeReadClient({
      data: null,
      error,
      count: null,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const result = await getUserProfile(spies.client, USER_ID);

    expect(result.error?.business).toBe(BusinessError.UNKNOWN);
    expect(result.error?.rawCode).toBe('42P01');
    expect(result.error?.rawMessage).toBe('relation "user_profiles" does not exist');
  });
});
