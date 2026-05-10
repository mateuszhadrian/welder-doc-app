'use client';

import type { Session, User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { BusinessError, type MappedError, mapAuthError } from '@/lib/supabase/errors';
import type { ConsentType } from '@/types/api';

/**
 * Browser-only orchestration for the two-step registration flow (US-001):
 *   1. `supabase.auth.signUp()` — public Supabase Auth (GoTrue) endpoint.
 *   2. `POST /api/consent` — bundled atomically via `record_consent_bundle()`,
 *      but deferred until the email-confirmation callback because the session
 *      cookie does not exist until the user clicks the verification link in
 *      production (`enable_confirmations = true`).
 *
 * The consent payload is therefore stashed in `sessionStorage` and replayed
 * by `flushPendingConsent()` from `/[locale]/auth/callback` once the session
 * is live. See implementation plan §5–§6.
 */

export interface RegisterUserCommand {
  email: string;
  password: string;
  consent: {
    types: [ConsentType, ...ConsentType[]];
    version: string;
    accepted: true;
  };
  /**
   * Required: forces GoTrue to use PKCE flow for the confirmation email.
   * Without it the email link redirects to `site_url` with the session in
   * the URL hash (implicit flow), bypassing `/auth/callback`. The route
   * handler at `/auth/callback` is what sets the SSR cookies that make
   * `flushPendingConsent()` succeed; without those cookies `/api/consent`
   * 401s and the consent_log row is never written.
   * Build via `${APP_URL}${buildLocalePath(locale, '/auth/callback')}`.
   */
  emailRedirectTo: string;
}

export type RegisterUserResult =
  | {
      ok: true;
      user: User;
      session: Session | null;
      /** True when GoTrue requires email confirmation (prod) — consent was deferred. */
      consentDeferred: boolean;
    }
  | {
      ok: false;
      step: 'signup';
      error: MappedError;
    };

export type FlushPendingConsentResult =
  | { ok: true; flushed: boolean }
  | { ok: false; reason: string };

export const PENDING_CONSENT_KEY = 'welderdoc_pending_consent';

/**
 * Per-tab sessionStorage key holding `{ email, password }` from the most
 * recent signUp. Read by `resendVerificationEmail()` to bypass a server-side
 * GoTrue bug: POST /auth/v1/resend ignores `code_challenge` in the body and
 * issues a non-PKCE confirmation token even when the SDK forwards PKCE params.
 * Calling auth.signUp() again for an existing unconfirmed user IS handled
 * with PKCE, so we replay it as the resend mechanism.
 *
 * Cleared by `clearPendingSignupCredentials()` from AuthProvider after the
 * first successful sign-in (matches consent-bundle lifecycle).
 *
 * Security: per-tab, gone on tab close. Same XSS exposure as the password
 * being held in form state during signUp submit.
 */
export const PENDING_SIGNUP_CREDENTIALS_KEY = 'welderdoc_pending_signup_credentials';

interface PendingConsentPayload {
  types: [ConsentType, ...ConsentType[]];
  version: string;
  accepted: boolean;
}

interface PendingSignupCredentials {
  email: string;
  password: string;
}

export function readPendingSignupCredentials(forEmail: string): PendingSignupCredentials | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_SIGNUP_CREDENTIALS_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as PendingSignupCredentials;
    if (parsed.email !== forEmail) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSignupCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_SIGNUP_CREDENTIALS_KEY);
  } catch {
    // ignore
  }
}

export async function registerUser(command: RegisterUserCommand): Promise<RegisterUserResult> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signUp({
    email: command.email.trim(),
    password: command.password,
    options: { emailRedirectTo: command.emailRedirectTo }
  });

  if (error) {
    return { ok: false, step: 'signup', error: mapAuthError(error)! };
  }

  if (!data.user) {
    // Defensive fallback — GoTrue should always populate `user` on success.
    return {
      ok: false,
      step: 'signup',
      error: { business: BusinessError.UNKNOWN, message: 'errors.unknown' }
    };
  }

  // Stash the consent bundle so the callback page can replay it after the
  // session cookie exists. In dev (`enable_confirmations = false`) the session
  // is created immediately and the callback page can flush right away;
  // in prod the user must click the verification link first.
  //
  // Also stash the credentials so resendVerificationEmail can replay signUp
  // for PKCE-correct confirmation emails (server-side /resend bug).
  if (typeof window !== 'undefined') {
    const consentPayload: PendingConsentPayload = {
      types: command.consent.types,
      version: command.consent.version,
      accepted: command.consent.accepted
    };
    const credPayload: PendingSignupCredentials = {
      email: command.email.trim(),
      password: command.password
    };
    try {
      window.sessionStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(consentPayload));
      window.sessionStorage.setItem(PENDING_SIGNUP_CREDENTIALS_KEY, JSON.stringify(credPayload));
    } catch {
      // sessionStorage may be unavailable (private mode quota, sandboxed iframe).
      // The signup itself succeeded — let the caller decide how to surface the
      // missing consent at sign-in time.
    }
  }

  return {
    ok: true,
    user: data.user,
    session: data.session,
    consentDeferred: data.session === null
  };
}

/**
 * Replays the deferred `POST /api/consent` once a session cookie exists.
 * Idempotent — clears the sessionStorage marker on success and is a no-op
 * when nothing is pending.
 */
export async function flushPendingConsent(): Promise<FlushPendingConsentResult> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'ssr' };
  }

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_CONSENT_KEY);
  } catch {
    return { ok: false, reason: 'storage_unavailable' };
  }

  if (raw === null) {
    // No-op: nothing was pending. Distinguishing this from a real flush
    // matters for AuthProvider, which only auto-redirects off
    // /consent-required when an actual flush updated current_consent_version.
    return { ok: true, flushed: false };
  }

  let body: PendingConsentPayload;
  try {
    body = JSON.parse(raw) as PendingConsentPayload;
  } catch {
    // Corrupt payload — drop it so we don't retry forever.
    try {
      window.sessionStorage.removeItem(PENDING_CONSENT_KEY);
    } catch {
      // ignore
    }
    return { ok: false, reason: 'consent_parse_error' };
  }

  let res: Response;
  try {
    res = await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!res.ok) {
    return { ok: false, reason: `consent_status_${res.status}` };
  }

  try {
    window.sessionStorage.removeItem(PENDING_CONSENT_KEY);
  } catch {
    // ignore
  }
  return { ok: true, flushed: true };
}
