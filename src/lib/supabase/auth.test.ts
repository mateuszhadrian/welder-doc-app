import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn()
}));

import { createClient } from '@/lib/supabase/client';

import { signOutClient } from './auth';

interface SignOutErrorShape {
  name: string;
  message: string;
}

function mockSignOut(result: { error: SignOutErrorShape | null }) {
  const signOut = vi.fn().mockResolvedValue(result);
  (createClient as unknown as Mock).mockReturnValue({ auth: { signOut } });
  return signOut;
}

describe('signOutClient', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('rezolwuje void i nie logue ostrzeżenia gdy signOut zwraca error=null', async () => {
    const signOut = mockSignOut({ error: null });

    await expect(signOutClient()).resolves.toBeUndefined();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('traktuje AuthSessionMissingError jako sukces (idempotentny, brak warna)', async () => {
    mockSignOut({
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' }
    });

    await expect(signOutClient()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('loguje console.warn ale rezolwuje void przy błędach innych niż brak sesji', async () => {
    mockSignOut({
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' }
    });

    await expect(signOutClient()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('signOut error');
    expect(warnSpy.mock.calls[0]![1]).toBe('fetch failed');
  });
});
