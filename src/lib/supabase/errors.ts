import type { AuthError, PostgrestError } from '@supabase/supabase-js';

export enum BusinessError {
  // Documents
  PROJECT_LIMIT_EXCEEDED = 'project_limit_exceeded',
  DOCUMENT_PAYLOAD_TOO_LARGE = 'document_payload_too_large',
  DOCUMENT_NAME_INVALID = 'document_name_invalid',
  DOCUMENT_DATA_SHAPE_INVALID = 'document_data_shape_invalid',

  // Consent
  CONSENT_TYPE_INVALID = 'consent_type_invalid',
  CONSENT_VERSION_MISSING = 'consent_version_missing',
  CONSENT_TARGET_UNAUTHORIZED = 'consent_target_unauthorized',

  // Profile
  PROFILE_LOCALE_INVALID = 'profile_locale_invalid',

  // Auth
  INVALID_CREDENTIALS = 'invalid_credentials',
  EMAIL_NOT_CONFIRMED = 'email_not_confirmed',
  EMAIL_ALREADY_REGISTERED = 'email_already_registered',
  PASSWORD_TOO_WEAK = 'password_too_weak',

  // Generic
  UNAUTHORIZED = 'unauthorized',
  RATE_LIMITED = 'rate_limited',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown'
}

export interface MappedError {
  business: BusinessError;
  /** i18n key under `errors.*` (next-intl). Missing key → fallback `errors.unknown`. */
  message: string;
  rawCode?: string;
  rawMessage?: string;
}

export function mapPostgrestError(err: PostgrestError | null): MappedError | null {
  if (!err) return null;

  // JWT issues → UNAUTHORIZED.
  // PGRST301 = JWT expired/invalid (PostgREST surfaces 401 with this code).
  // 42501    = insufficient_privilege (Postgres-level — e.g. RLS USING clause
  //            evaluating with `auth.uid()` NULL when the JWT cookie is gone).
  if (err.code === 'PGRST301' || err.code === '42501') {
    return {
      business: BusinessError.UNAUTHORIZED,
      message: 'errors.unauthorized',
      rawCode: err.code,
      rawMessage: err.message
    };
  }

  // P0001 = RAISE EXCEPTION from a DB function/trigger.
  if (err.code === 'P0001') {
    if (err.message.includes('project_limit_exceeded')) {
      return {
        business: BusinessError.PROJECT_LIMIT_EXCEEDED,
        message: 'errors.project_limit_exceeded',
        rawCode: err.code,
        rawMessage: err.message
      };
    }
    if (err.message.includes('unauthorized_consent_target')) {
      return {
        business: BusinessError.CONSENT_TARGET_UNAUTHORIZED,
        message: 'errors.consent_target_unauthorized',
        rawCode: err.code,
        rawMessage: err.message
      };
    }
  }

  // 23514 = check_violation (CHECK constraint).
  if (err.code === '23514') {
    if (err.message.includes('octet_length')) {
      return {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large',
        rawCode: err.code
      };
    }
    if (err.message.includes('length(trim(name))') || err.message.includes('length(name)')) {
      return {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid',
        rawCode: err.code
      };
    }
    if (err.message.includes('jsonb_typeof')) {
      return {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid',
        rawCode: err.code
      };
    }
    if (err.message.includes('locale')) {
      return {
        business: BusinessError.PROFILE_LOCALE_INVALID,
        message: 'errors.profile_locale_invalid',
        rawCode: err.code
      };
    }
    if (err.message.includes('consent_type')) {
      return {
        business: BusinessError.CONSENT_TYPE_INVALID,
        message: 'errors.consent_type_invalid',
        rawCode: err.code
      };
    }
  }

  // 23502 = not_null_violation.
  if (err.code === '23502' && err.message.includes('version')) {
    return {
      business: BusinessError.CONSENT_VERSION_MISSING,
      message: 'errors.consent_version_missing',
      rawCode: err.code
    };
  }

  return {
    business: BusinessError.UNKNOWN,
    message: 'errors.unknown',
    rawCode: err.code,
    rawMessage: err.message
  };
}

export function mapAuthError(err: AuthError | null): MappedError | null {
  if (!err) return null;

  // Rate-limit signals come either via HTTP status or a "too many" message.
  const lowered = err.message.toLowerCase();
  if (err.status === 429 || lowered.includes('too many') || lowered.includes('rate limit')) {
    return {
      business: BusinessError.RATE_LIMITED,
      message: 'errors.rate_limited',
      rawMessage: err.message
    };
  }

  switch (err.message) {
    case 'Invalid login credentials':
      return { business: BusinessError.INVALID_CREDENTIALS, message: 'errors.invalid_credentials' };
    case 'Email not confirmed':
      return { business: BusinessError.EMAIL_NOT_CONFIRMED, message: 'errors.email_not_confirmed' };
    case 'User already registered':
      return {
        business: BusinessError.EMAIL_ALREADY_REGISTERED,
        message: 'errors.email_already_registered'
      };
    default:
      if (lowered.includes('password') && lowered.includes('characters')) {
        return { business: BusinessError.PASSWORD_TOO_WEAK, message: 'errors.password_too_weak' };
      }
      // Returned by updateUser/getUser when no JWT cookie reaches GoTrue —
      // e.g. recovery PKCE callback hasn't completed or session expired.
      if (lowered.includes('auth session missing')) {
        return { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' };
      }
      return {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawMessage: err.message
      };
  }
}
