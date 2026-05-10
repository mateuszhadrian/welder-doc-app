import type { AuthError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn()
}));

import { createClient } from '@/lib/supabase/client';
import { BusinessError } from '@/lib/supabase/errors';

import { PENDING_SIGNUP_CREDENTIALS_KEY } from './registration';
import {
  resendVerificationEmail,
  type ResendVerificationEmailResult
} from './resendVerificationEmail';

const makeAuthError = (message: string, status = 400): AuthError =>
  ({ name: 'AuthApiError', message, status }) as unknown as AuthError;

function mockSignUp(result: { error: AuthError | null }) {
  const signUp = vi.fn().mockResolvedValue({
    data: { user: { id: 'u1', email: 'user@example.com' }, session: null },
    ...result
  });
  (createClient as unknown as Mock).mockReturnValue({ auth: { signUp } });
  return signUp;
}

function stashCredentials(email: string, password: string) {
  window.sessionStorage.setItem(
    PENDING_SIGNUP_CREDENTIALS_KEY,
    JSON.stringify({ email, password })
  );
}

const REDIRECT = 'http://localhost:3000/auth/callback';

describe('resendVerificationEmail', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('zwraca ok=true gdy auth.signUp(replay) zwraca error=null', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    mockSignUp({ error: null });

    const result: ResendVerificationEmailResult = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result).toEqual({ ok: true });
  });

  // Krytyczne: workaround na bug GoTrue /resend (ignorujący PKCE) polega na
  // wywołaniu auth.signUp ze stashed password — endpoint /signup obsługuje
  // PKCE i traktuje powtórny call dla unconfirmed user'a jako resend.
  it('przekazuje email + stashed password + emailRedirectTo do auth.signUp', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    const signUp = mockSignUp({ error: null });

    await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'StrongPass123',
      options: { emailRedirectTo: REDIRECT }
    });
  });

  it('zwraca resend_session_lost gdy sessionStorage nie ma credentials', async () => {
    // Brak stash — symuluje user wracającego do tabu po jego zamknięciu.
    const signUp = mockSignUp({ error: null });

    const result = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.message).toBe('errors.resend_session_lost');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('odrzuca request gdy email z command nie zgadza się z stashed', async () => {
    stashCredentials('other@example.com', 'StrongPass123');
    const signUp = mockSignUp({ error: null });

    const result = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.message).toBe('errors.resend_session_lost');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('zwraca błąd dla type !== signup (email_change nieobsługiwane w tym workaround)', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    const signUp = mockSignUp({ error: null });

    const result = await resendVerificationEmail({
      type: 'email_change',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.business).toBe(BusinessError.UNKNOWN);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('mapuje 429 z auth.signUp na RATE_LIMITED', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    mockSignUp({
      error: makeAuthError(
        'For security purposes, you can only request this once every 60 seconds',
        429
      )
    });

    const result = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.business).toBe(BusinessError.RATE_LIMITED);
    expect(result.mapped.message).toBe('errors.rate_limited');
  });

  it('mapuje "Email rate limit exceeded" na RATE_LIMITED', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    mockSignUp({ error: makeAuthError('Email rate limit exceeded', 429) });

    const result = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.business).toBe(BusinessError.RATE_LIMITED);
  });

  it('zwraca UNKNOWN z rawMessage dla niemapowanych błędów', async () => {
    stashCredentials('user@example.com', 'StrongPass123');
    mockSignUp({ error: makeAuthError('Some unknown GoTrue error', 500) });

    const result = await resendVerificationEmail({
      type: 'signup',
      email: 'user@example.com',
      emailRedirectTo: REDIRECT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mapped.business).toBe(BusinessError.UNKNOWN);
    expect(result.mapped.rawMessage).toBe('Some unknown GoTrue error');
  });
});
