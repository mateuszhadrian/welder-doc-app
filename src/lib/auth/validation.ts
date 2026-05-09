/**
 * Client-side preflight validation for the registration / sign-in forms.
 *
 * Authoritative rules live server-side (GoTrue `auth.password.min_length = 8`,
 * RFC email check) — these helpers only improve UX by rejecting obviously
 * malformed input before the network round-trip.
 */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** RFC 5321 — total length of an addr-spec must not exceed 254 octets. */
export const EMAIL_MAX_LENGTH = 254;

/** PRD US-001. Mirrors `supabase/config.toml [auth] minimum_password_length`. */
export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt truncates inputs longer than 72 bytes — GoTrue rejects past this. */
export const PASSWORD_MAX_LENGTH = 72;

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LENGTH) {
    return false;
  }
  return EMAIL_REGEX.test(trimmed);
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
