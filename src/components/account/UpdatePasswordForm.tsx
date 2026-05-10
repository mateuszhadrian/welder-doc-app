'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { isValidPassword } from '@/lib/auth/validation';
import { createClient } from '@/lib/supabase/client';
import { BusinessError, mapAuthError, type MappedError } from '@/lib/supabase/errors';

type ClientValidationError = 'password_too_short' | 'password_mismatch';

type FormError =
  | { kind: 'client'; key: ClientValidationError; field: 'password' | 'passwordConfirm' }
  | { kind: 'server'; mapped: MappedError };

type Props = {
  /** Called after `auth.updateUser({ password })` resolves without error. */
  onSuccess?: () => void;
  /**
   * Called when GoTrue returns `Auth session missing` (recovery PKCE never
   * completed or session expired). Lets the parent decide where to redirect
   * (`/login?expired=1` for reset flow, sign-out + `/login` for settings).
   */
  onSessionMissing?: () => void;
};

export function UpdatePasswordForm({ onSuccess, onSessionMissing }: Props) {
  const t = useTranslations('auth.resetPassword');
  const tErrors = useTranslations('errors');

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [isPending, startTransition] = useTransition();

  const fieldError = (field: 'password' | 'passwordConfirm') => {
    if (!error || error.kind !== 'client' || error.field !== field) return null;
    return tErrors(error.key);
  };

  const generalErrorMessage = (() => {
    if (!error || error.kind !== 'server') return null;
    try {
      return tErrors(
        error.mapped.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]
      );
    } catch {
      return tErrors('unknown');
    }
  })();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Preflight: GoTrue is the source of truth (config.toml min_length = 8),
    // these checks just save a network round-trip.
    if (!isValidPassword(password)) {
      setError({ kind: 'client', key: 'password_too_short', field: 'password' });
      return;
    }
    if (password !== passwordConfirm) {
      setError({ kind: 'client', key: 'password_mismatch', field: 'passwordConfirm' });
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.updateUser({ password });

      if (!authError) {
        onSuccess?.();
        return;
      }

      // Network failure (offline, DNS) — distinguish so user knows the
      // password was NOT updated. Mirrors ForgotPasswordForm pattern.
      const isNetworkError = authError.name === 'AuthRetryableFetchError' || authError.status === 0;
      if (isNetworkError) {
        setError({
          kind: 'server',
          mapped: { business: BusinessError.NETWORK_ERROR, message: 'errors.network_error' }
        });
        return;
      }

      const mapped = mapAuthError(authError);
      if (!mapped) return;

      // Slot field-level errors under the relevant input; keep generic
      // server errors as a top-level alert.
      if (mapped.business === BusinessError.PASSWORD_TOO_WEAK) {
        setError({ kind: 'server', mapped });
        return;
      }
      if (mapped.business === BusinessError.UNAUTHORIZED) {
        onSessionMissing?.();
        return;
      }
      setError({ kind: 'server', mapped });
    });
  }

  const isSubmitting = isPending;
  const passwordFieldError = fieldError('password');
  const confirmFieldError = fieldError('passwordConfirm');
  const passwordTopError =
    error?.kind === 'server' && error.mapped.business === BusinessError.PASSWORD_TOO_WEAK
      ? generalErrorMessage
      : null;
  const topLevelError = passwordTopError ?? (error?.kind === 'server' ? generalErrorMessage : null);

  return (
    <form
      onSubmit={handleSubmit}
      method="post"
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-neutral-800">
          {t('password_label')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('password_placeholder')}
          disabled={isSubmitting}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-describedby={passwordFieldError ? 'password-error' : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
        {passwordFieldError ? (
          <p id="password-error" role="alert" className="text-xs text-red-700">
            {passwordFieldError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="passwordConfirm" className="text-sm font-medium text-neutral-800">
          {t('password_confirm_label')}
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          placeholder={t('password_confirm_placeholder')}
          disabled={isSubmitting}
          aria-invalid={confirmFieldError ? true : undefined}
          aria-describedby={confirmFieldError ? 'passwordConfirm-error' : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
        {confirmFieldError ? (
          <p id="passwordConfirm-error" role="alert" className="text-xs text-red-700">
            {confirmFieldError}
          </p>
        ) : null}
      </div>

      {topLevelError ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {topLevelError}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || password.length === 0 || passwordConfirm.length === 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
