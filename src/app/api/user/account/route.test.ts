import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeleteAccountApiErrorCode, DeleteAccountResponseDto } from '@/types/api';

const { getUserMock, signOutMock, tempSignInMock, adminDeleteUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  signOutMock: vi.fn(),
  tempSignInMock: vi.fn(),
  adminDeleteUserMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock
    }
  })),
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        deleteUser: adminDeleteUserMock
      }
    }
  }))
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: tempSignInMock
    }
  }))
}));

import { DELETE } from './route';

const USER = { id: 'user-uuid-1', email: 'me@test.local' };
const VALID_BODY = { password: 'CorrectHorseBattery1!', confirmation: 'DELETE' };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/user/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function readError(res: Response): Promise<DeleteAccountApiErrorCode> {
  const json = (await res.json()) as { error: DeleteAccountApiErrorCode };
  return json.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authed session, password OK, admin delete OK, signOut OK.
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
  tempSignInMock.mockResolvedValue({ data: {}, error: null });
  adminDeleteUserMock.mockResolvedValue({ data: {}, error: null });
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DELETE /api/user/account', () => {
  it('401 unauthorized — brak sesji', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(await readError(res)).toBe('unauthorized');
    // Re-auth and admin delete must NOT run when unauthorized.
    expect(tempSignInMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('401 unauthorized — user bez emaila', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: USER.id, email: null } },
      error: null
    });

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(await readError(res)).toBe('unauthorized');
  });

  it('400 invalid_payload — malformed JSON', async () => {
    const res = await DELETE(makeRequest('{not-json'));

    expect(res.status).toBe(400);
    expect(await readError(res)).toBe('invalid_payload');
    expect(tempSignInMock).not.toHaveBeenCalled();
  });

  it('400 missing_fields — brak password', async () => {
    const res = await DELETE(makeRequest({ confirmation: 'DELETE' }));

    expect(res.status).toBe(400);
    expect(await readError(res)).toBe('missing_fields');
  });

  it('400 missing_fields — brak confirmation', async () => {
    const res = await DELETE(makeRequest({ password: 'whatever' }));

    expect(res.status).toBe(400);
    expect(await readError(res)).toBe('missing_fields');
  });

  it('400 missing_fields — pusty password', async () => {
    const res = await DELETE(makeRequest({ password: '', confirmation: 'DELETE' }));

    expect(res.status).toBe(400);
    expect(await readError(res)).toBe('missing_fields');
  });

  it('400 invalid_confirmation — confirmation o złej wartości (case-sensitive)', async () => {
    const res = await DELETE(makeRequest({ password: 'pw', confirmation: 'delete' }));

    expect(res.status).toBe(400);
    expect(await readError(res)).toBe('invalid_confirmation');
    expect(tempSignInMock).not.toHaveBeenCalled();
  });

  it('401 invalid_password — Supabase zwraca Invalid login credentials', async () => {
    tempSignInMock.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials', status: 400 }
    });

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(await readError(res)).toBe('invalid_password');
    // Critical: admin delete must NOT run if re-auth failed.
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('429 rate_limited — Supabase status 429', async () => {
    tempSignInMock.mockResolvedValue({
      data: {},
      error: { message: 'too many requests', status: 429 }
    });

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect(await readError(res)).toBe('rate_limited');
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it('429 rate_limited — message zawiera "rate limit" przy innym statusie', async () => {
    tempSignInMock.mockResolvedValue({
      data: {},
      error: { message: 'rate limit exceeded', status: 400 }
    });

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect(await readError(res)).toBe('rate_limited');
  });

  it('500 internal_error — admin.deleteUser error', async () => {
    adminDeleteUserMock.mockResolvedValue({
      data: {},
      error: { message: 'db down' }
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(await readError(res)).toBe('internal_error');
    expect(errSpy).toHaveBeenCalled();
  });

  it('500 internal_error — wyjątek wyżej w pipeline', async () => {
    getUserMock.mockRejectedValue(new Error('network blew up'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(await readError(res)).toBe('internal_error');
    expect(errSpy).toHaveBeenCalled();
  });

  it('200 happy path — woła signOut, zwraca DeleteAccountResponseDto', async () => {
    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteAccountResponseDto;
    expect(body.deleted).toBe(true);
    expect(body.user_id).toBe(USER.id);
    expect(typeof body.deleted_at).toBe('string');
    // ISO 8601 sanity check.
    expect(new Date(body.deleted_at).toString()).not.toBe('Invalid Date');

    expect(tempSignInMock).toHaveBeenCalledWith({
      email: USER.email,
      password: VALID_BODY.password
    });
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER.id);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('200 happy path — nie loguje hasła', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await DELETE(makeRequest(VALID_BODY));

    const allCalls = [...errSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls];
    const serialised = JSON.stringify(allCalls);
    expect(serialised).not.toContain(VALID_BODY.password);
  });

  it('200 happy path — toleruje błąd signOut po skasowaniu usera', async () => {
    signOutMock.mockRejectedValue(new Error('user gone'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await DELETE(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
  });
});
