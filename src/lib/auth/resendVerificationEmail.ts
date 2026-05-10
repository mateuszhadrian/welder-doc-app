import { readPendingSignupCredentials } from '@/lib/auth/registration';
import { createClient } from '@/lib/supabase/client';
import { BusinessError, mapAuthError, type MappedError } from '@/lib/supabase/errors';
import type { ResendVerificationEmailCommand } from '@/types/api';

export type ResendVerificationEmailResult = { ok: true } | { ok: false; mapped: MappedError };

/**
 * Resend the email-confirmation message for `cmd.email`.
 *
 * Implementation note — we DO NOT call `supabase.auth.resend()` because of a
 * server-side GoTrue bug: POST /auth/v1/resend ignores the `code_challenge`
 * params even when forwarded by the SDK, and issues a non-PKCE OTP token. The
 * resulting verify URL has no `pkce_` prefix, redirects with implicit-flow
 * tokens (#access_token=…), and our `/auth/callback` route handler can't
 * exchange them (it expects `?code=…`), so the user lands on
 * `/login?callback_error=1`.
 *
 * Workaround: call `supabase.auth.signUp()` again with the credentials stashed
 * during the original sign-up. GoTrue's /signup endpoint properly handles
 * PKCE and treats a repeat signUp on an existing unconfirmed user as a resend
 * — same end result (a fresh confirmation email), but with a valid `pkce_`
 * token URL.
 *
 * Once the upstream GoTrue server fixes /resend to honour PKCE, replace the
 * body of this helper with the simpler `supabase.auth.resend(...)` call.
 */
export async function resendVerificationEmail(
  cmd: ResendVerificationEmailCommand
): Promise<ResendVerificationEmailResult> {
  if (cmd.type !== 'signup') {
    // 'email_change' isn't part of MVP US-001; the workaround relies on the
    // signUp endpoint, which only applies to signup confirmations.
    return {
      ok: false,
      mapped: { business: BusinessError.UNKNOWN, message: 'errors.unknown' }
    };
  }

  const credentials = readPendingSignupCredentials(cmd.email);
  if (!credentials) {
    // Tab was closed and reopened, sessionStorage cleared, or email mismatch.
    // User must restart from sign-up — the alternative would be to expose a
    // server-side resend endpoint we own, which is out of scope.
    return {
      ok: false,
      mapped: {
        business: BusinessError.UNKNOWN,
        message: 'errors.resend_session_lost'
      }
    };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: { emailRedirectTo: cmd.emailRedirectTo }
  });

  if (!error) return { ok: true };

  const mapped = mapAuthError(error) ?? {
    business: BusinessError.UNKNOWN,
    message: 'errors.unknown',
    rawMessage: error.message
  };
  return { ok: false, mapped };
}
