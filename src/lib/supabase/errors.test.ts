import { describe, expect, it } from 'vitest';
import type { AuthError, PostgrestError } from '@supabase/supabase-js';
import { BusinessError, mapAuthError, mapPostgrestError } from './errors';

const pgErr = (code: string, message: string): PostgrestError =>
  ({ code, message, details: '', hint: '' }) as PostgrestError;

const authErr = (message: string, status?: number): AuthError =>
  ({ name: 'AuthApiError', message, status }) as unknown as AuthError;

describe('mapPostgrestError', () => {
  it('zwraca null dla null', () => {
    expect(mapPostgrestError(null)).toBeNull();
  });

  it('mapuje P0001 project_limit_exceeded', () => {
    const m = mapPostgrestError(pgErr('P0001', 'project_limit_exceeded: free plan'));
    expect(m?.business).toBe(BusinessError.PROJECT_LIMIT_EXCEEDED);
    expect(m?.message).toBe('errors.project_limit_exceeded');
    expect(m?.rawCode).toBe('P0001');
  });

  it('mapuje P0001 unauthorized_consent_target', () => {
    const m = mapPostgrestError(pgErr('P0001', 'unauthorized_consent_target'));
    expect(m?.business).toBe(BusinessError.CONSENT_TARGET_UNAUTHORIZED);
    expect(m?.message).toBe('errors.consent_target_unauthorized');
  });

  it('mapuje 23514 octet_length → DOCUMENT_PAYLOAD_TOO_LARGE', () => {
    const m = mapPostgrestError(pgErr('23514', 'octet_length(data) > 1MB'));
    expect(m?.business).toBe(BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE);
  });

  it('mapuje 23514 length(name) → DOCUMENT_NAME_INVALID', () => {
    const m = mapPostgrestError(pgErr('23514', 'length(trim(name)) > 0'));
    expect(m?.business).toBe(BusinessError.DOCUMENT_NAME_INVALID);
  });

  it('mapuje 23514 jsonb_typeof → DOCUMENT_DATA_SHAPE_INVALID', () => {
    const m = mapPostgrestError(pgErr('23514', "jsonb_typeof(data) = 'object'"));
    expect(m?.business).toBe(BusinessError.DOCUMENT_DATA_SHAPE_INVALID);
  });

  it('mapuje 23514 locale → PROFILE_LOCALE_INVALID', () => {
    const m = mapPostgrestError(pgErr('23514', "locale IN ('pl','en')"));
    expect(m?.business).toBe(BusinessError.PROFILE_LOCALE_INVALID);
  });

  it('mapuje 23514 consent_type → CONSENT_TYPE_INVALID', () => {
    const m = mapPostgrestError(pgErr('23514', 'consent_type check failed'));
    expect(m?.business).toBe(BusinessError.CONSENT_TYPE_INVALID);
  });

  it('mapuje 23502 version → CONSENT_VERSION_MISSING', () => {
    const m = mapPostgrestError(pgErr('23502', 'null value in column "version"'));
    expect(m?.business).toBe(BusinessError.CONSENT_VERSION_MISSING);
  });

  it('zwraca UNKNOWN dla niemapowanych kodów', () => {
    const m = mapPostgrestError(pgErr('42P01', 'relation does not exist'));
    expect(m?.business).toBe(BusinessError.UNKNOWN);
    expect(m?.rawCode).toBe('42P01');
    expect(m?.rawMessage).toBe('relation does not exist');
  });
});

describe('mapAuthError', () => {
  it('zwraca null dla null', () => {
    expect(mapAuthError(null)).toBeNull();
  });

  it('mapuje "Invalid login credentials"', () => {
    const m = mapAuthError(authErr('Invalid login credentials', 400));
    expect(m?.business).toBe(BusinessError.INVALID_CREDENTIALS);
    expect(m?.message).toBe('errors.invalid_credentials');
  });

  it('mapuje "Email not confirmed"', () => {
    const m = mapAuthError(authErr('Email not confirmed', 400));
    expect(m?.business).toBe(BusinessError.EMAIL_NOT_CONFIRMED);
  });

  it('mapuje "User already registered"', () => {
    const m = mapAuthError(authErr('User already registered', 422));
    expect(m?.business).toBe(BusinessError.EMAIL_ALREADY_REGISTERED);
  });

  it('mapuje rate limit przez status 429', () => {
    const m = mapAuthError(authErr('Some message', 429));
    expect(m?.business).toBe(BusinessError.RATE_LIMITED);
    expect(m?.message).toBe('errors.rate_limited');
  });

  it('mapuje rate limit przez "too many" w message', () => {
    const m = mapAuthError(authErr('Too many requests', 400));
    expect(m?.business).toBe(BusinessError.RATE_LIMITED);
  });

  // Regression: GoTrue's resend 60s cooldown is HTTP 429; rely on the status branch.
  it('mapuje 60s cooldown z resend (status 429) → RATE_LIMITED', () => {
    const m = mapAuthError(
      authErr('For security purposes, you can only request this once every 60 seconds', 429)
    );
    expect(m?.business).toBe(BusinessError.RATE_LIMITED);
    expect(m?.message).toBe('errors.rate_limited');
  });

  // Regression: GoTrue's hourly cap "Email rate limit exceeded" — also surfaced as 429,
  // and the literal "rate limit" substring is a defense-in-depth fallback.
  it('mapuje "Email rate limit exceeded" → RATE_LIMITED', () => {
    const m = mapAuthError(authErr('Email rate limit exceeded', 429));
    expect(m?.business).toBe(BusinessError.RATE_LIMITED);
  });

  it('mapuje słabe hasło heurystyką password+characters', () => {
    const m = mapAuthError(authErr('Password should be at least 8 characters', 400));
    expect(m?.business).toBe(BusinessError.PASSWORD_TOO_WEAK);
  });

  it('mapuje "Auth session missing" → UNAUTHORIZED', () => {
    const m = mapAuthError(authErr('Auth session missing!', 401));
    expect(m?.business).toBe(BusinessError.UNAUTHORIZED);
    expect(m?.message).toBe('errors.unauthorized');
  });

  it('zwraca UNKNOWN dla niemapowanych komunikatów', () => {
    const m = mapAuthError(authErr('Some unrecognized error', 500));
    expect(m?.business).toBe(BusinessError.UNKNOWN);
    expect(m?.rawMessage).toBe('Some unrecognized error');
  });
});
