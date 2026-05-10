import type { AuthError, Session, User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn()
}));

import { createClient } from '@/lib/supabase/client';
import { BusinessError } from '@/lib/supabase/errors';

import {
  PENDING_CONSENT_KEY,
  PENDING_SIGNUP_CREDENTIALS_KEY,
  flushPendingConsent,
  registerUser,
  type RegisterUserCommand
} from './registration';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-uuid-1',
    aud: 'authenticated',
    email: 'user@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-05-09T12:00:00Z',
    ...overrides
  }) as User;

const makeSession = (): Session =>
  ({
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 3600,
    expires_at: 0,
    token_type: 'bearer',
    user: makeUser()
  }) as unknown as Session;

const makeAuthError = (message: string, status = 400): AuthError =>
  ({ name: 'AuthApiError', message, status }) as unknown as AuthError;

const makeCommand = (overrides: Partial<RegisterUserCommand> = {}): RegisterUserCommand => ({
  email: 'user@example.com',
  password: 'StrongPass123',
  consent: {
    types: ['terms_of_service', 'privacy_policy', 'cookies'],
    version: '1.0.0',
    accepted: true
  },
  emailRedirectTo: 'http://localhost:3000/auth/callback',
  ...overrides
});

function mockSignUp(result: {
  data: { user: User | null; session: Session | null };
  error: AuthError | null;
}) {
  const signUp = vi.fn().mockResolvedValue(result);
  (createClient as unknown as Mock).mockReturnValue({ auth: { signUp } });
  return signUp;
}

describe('registerUser', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('zwraca ok=true z consentDeferred=true gdy session=null (prod, email confirmation ON)', async () => {
    mockSignUp({ data: { user: makeUser(), session: null }, error: null });

    const result = await registerUser(makeCommand());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consentDeferred).toBe(true);
    expect(result.session).toBeNull();

    const stashed = window.sessionStorage.getItem(PENDING_CONSENT_KEY);
    expect(stashed).not.toBeNull();
    expect(JSON.parse(stashed!)).toEqual({
      types: ['terms_of_service', 'privacy_policy', 'cookies'],
      version: '1.0.0',
      accepted: true
    });
  });

  it('zwraca ok=true z consentDeferred=false gdy session istnieje (dev)', async () => {
    mockSignUp({ data: { user: makeUser(), session: makeSession() }, error: null });

    const result = await registerUser(makeCommand());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consentDeferred).toBe(false);
    expect(result.session).not.toBeNull();
    // Bundle wciąż stashed — flushPendingConsent zostanie wywołany w callbacku
    expect(window.sessionStorage.getItem(PENDING_CONSENT_KEY)).not.toBeNull();
  });

  it('mapuje błąd "User already registered" na EMAIL_ALREADY_REGISTERED', async () => {
    mockSignUp({
      data: { user: null, session: null },
      error: makeAuthError('User already registered', 422)
    });

    const result = await registerUser(makeCommand());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe('signup');
    expect(result.error.business).toBe(BusinessError.EMAIL_ALREADY_REGISTERED);
    expect(result.error.message).toBe('errors.email_already_registered');
    expect(window.sessionStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
  });

  it('mapuje rate limit (status 429) na RATE_LIMITED', async () => {
    mockSignUp({
      data: { user: null, session: null },
      error: makeAuthError('Too many requests', 429)
    });

    const result = await registerUser(makeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.business).toBe(BusinessError.RATE_LIMITED);
  });

  it('przycina białe znaki z emaila przed wywołaniem signUp', async () => {
    const signUp = mockSignUp({
      data: { user: makeUser(), session: null },
      error: null
    });

    await registerUser(makeCommand({ email: '  user@example.com  ' }));

    expect(signUp).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'StrongPass123',
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback' }
    });
  });

  // Regression: implicit flow (no emailRedirectTo) caused the email link to
  // bypass /auth/callback, leaving SSR cookies unset and consent_log empty
  // for every newly-registered user. Forcing the option blocks that.
  it('przekazuje emailRedirectTo z command do supabase.auth.signUp.options', async () => {
    const signUp = mockSignUp({
      data: { user: makeUser(), session: null },
      error: null
    });

    await registerUser(makeCommand({ emailRedirectTo: 'https://welder.test/en/auth/callback' }));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: 'https://welder.test/en/auth/callback' }
      })
    );
  });

  // Regression: stashing email+password is required so resendVerificationEmail
  // can replay signUp (workaround for GoTrue /resend ignoring PKCE).
  it('stashuje email+password w sessionStorage po sukcesie signUp', async () => {
    mockSignUp({ data: { user: makeUser(), session: null }, error: null });

    await registerUser(makeCommand({ email: '  user@example.com  ', password: 'Secret1234' }));

    const raw = window.sessionStorage.getItem(PENDING_SIGNUP_CREDENTIALS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      email: 'user@example.com',
      password: 'Secret1234'
    });
  });

  it('zwraca UNKNOWN gdy GoTrue nie zwróci ani usera, ani błędu (defensywne)', async () => {
    mockSignUp({ data: { user: null, session: null }, error: null });

    const result = await registerUser(makeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.business).toBe(BusinessError.UNKNOWN);
  });
});

describe('flushPendingConsent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('zwraca ok=true bez fetch gdy brak payloadu w sessionStorage', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await flushPendingConsent();

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wywołuje POST /api/consent z payloadem i czyści sessionStorage przy 201', async () => {
    window.sessionStorage.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({
        types: ['terms_of_service', 'privacy_policy', 'cookies'],
        version: '1.0.0',
        accepted: true
      })
    );

    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await flushPendingConsent();

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/consent');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      types: ['terms_of_service', 'privacy_policy', 'cookies'],
      version: '1.0.0',
      accepted: true
    });
    expect(window.sessionStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
  });

  it('zwraca consent_status_<code> i pozostawia payload przy błędzie HTTP', async () => {
    window.sessionStorage.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({ types: ['terms_of_service'], version: '1.0.0', accepted: true })
    );
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 })) as unknown as typeof fetch;

    const result = await flushPendingConsent();

    expect(result).toEqual({ ok: false, reason: 'consent_status_401' });
    // Payload pozostaje, by możliwy był retry po ponownym sign-in.
    expect(window.sessionStorage.getItem(PENDING_CONSENT_KEY)).not.toBeNull();
  });

  it('czyści payload i zwraca consent_parse_error przy uszkodzonym JSON', async () => {
    window.sessionStorage.setItem(PENDING_CONSENT_KEY, '{not-json');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await flushPendingConsent();

    expect(result).toEqual({ ok: false, reason: 'consent_parse_error' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
  });

  it('zwraca network_error gdy fetch rzuci', async () => {
    window.sessionStorage.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({ types: ['terms_of_service'], version: '1.0.0', accepted: true })
    );
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('network down')) as unknown as typeof fetch;

    const result = await flushPendingConsent();

    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });
});
