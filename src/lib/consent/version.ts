/**
 * Bump this when the Terms of Service or Privacy Policy text changes.
 * The `[locale]/layout.tsx` guard compares it against
 * `user_profiles.current_consent_version` and redirects to
 * `/[locale]/consent-required` for any user whose stored version is older
 * (lexicographic compare on ISO date strings — keep the format `YYYY-MM-DD`).
 *
 * Source of truth pairing: `POST /api/consent` writes this same string into
 * `consent_log.version` and `user_profiles.current_consent_version`.
 */
export const CURRENT_TOS_VERSION = '2026-05-01';
