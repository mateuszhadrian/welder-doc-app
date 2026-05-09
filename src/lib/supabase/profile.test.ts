import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const eqMock = vi.fn(() => ({ select: selectMock }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock('./client', () => ({
  createClient: () => ({ from: fromMock })
}));

import { updateProfile, type SafeUpdate } from './profile';

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
