'use client';

import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { isValidEmail } from '@/lib/auth/validation';
import { createClient } from '@/lib/supabase/client';
import { BusinessError, mapAuthError, type MappedError } from '@/lib/supabase/errors';

type ClientValidationError = 'invalid_email_format';

type FormError =
  | { kind: 'client'; key: ClientValidationError }
  | { kind: 'server'; mapped: MappedError };

type Props = {
  locale: string;
};

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export function ForgotPasswordForm({ locale }: Props) {
  const t = useTranslations('auth.forgotPassword');
  const tErrors = useTranslations('errors');

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [isPending, startTransition] = useTransition();

  const errorMessage = (() => {
    if (!error) return null;
    if (error.kind === 'client') return tErrors(error.key);
    try {
      return tErrors(
        error.mapped.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]
      );
    } catch {
      return tErrors('unknown');
    }
  })();

  const loginHref = buildLocalePath(locale, '/login');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setError({ kind: 'client', key: 'invalid_email_format' });
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      // `next` must carry the locale prefix so an `en` user lands on
      // `/en/reset-password`, not the default-locale Polish page. The
      // callback's `safeNext` check accepts both `/reset-password` and
      // `/en/reset-password` (`startsWith('/') && !startsWith('//')`).
      const callbackPath = buildLocalePath(locale, '/auth/callback');
      const nextPath = buildLocalePath(locale, '/reset-password');
      const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}${callbackPath}?next=${encodeURIComponent(nextPath)}`;

      const { error: authError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo
      });

      if (!authError) {
        setSubmitted(true);
        return;
      }

      // Network failure (offline, DNS, supabase URL unreachable) surfaces as
      // AuthRetryableFetchError with status 0. Distinguish from a real GoTrue
      // response so the user knows the email was NOT sent.
      const isNetworkError = authError.name === 'AuthRetryableFetchError' || authError.status === 0;
      if (isNetworkError) {
        setError({
          kind: 'server',
          mapped: { business: BusinessError.NETWORK_ERROR, message: 'errors.network_error' }
        });
        return;
      }

      const mapped = mapAuthError(authError);
      // Anti-enumeration safety net: any GoTrue response error other than
      // rate-limit gets the silent-success UI. Rate-limit is per-IP (not
      // per-email) and worth surfacing so the user understands retries.
      if (mapped?.business === BusinessError.RATE_LIMITED) {
        setError({ kind: 'server', mapped });
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {t('sent_generic')}
        </p>
        <Link
          href={loginHref}
          className="self-center text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
        >
          {t('back_to_login')}
        </Link>
      </div>
    );
  }

  const isSubmitting = isPending;

  return (
    <form
      onSubmit={handleSubmit}
      // `method="post"` mirrors LoginForm/SignUpForm: if hydration ever
      // fails the native fallback POSTs the email rather than GETting it
      // into the URL (where it would land in proxy logs).
      method="post"
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-neutral-800">
          {t('email_label')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('email_placeholder')}
          disabled={isSubmitting}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
      </div>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || email.length === 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>

      <Link
        href={loginHref}
        className="self-center text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
      >
        {t('back_to_login')}
      </Link>
    </form>
  );
}
