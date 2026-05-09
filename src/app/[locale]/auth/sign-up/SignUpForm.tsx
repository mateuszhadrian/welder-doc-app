'use client';

import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { registerUser } from '@/lib/auth/registration';
import { isValidEmail, isValidPassword } from '@/lib/auth/validation';
import { BusinessError, type MappedError } from '@/lib/supabase/errors';

type ClientValidationError = 'invalid_email_format' | 'password_too_short' | 'consent_required';

type FormError =
  | { kind: 'client'; key: ClientValidationError }
  | { kind: 'server'; mapped: MappedError };

type Props = {
  locale: string;
  consentVersion: string;
};

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export function SignUpForm({ locale, consentVersion }: Props) {
  const t = useTranslations('auth.signUp');
  const tErrors = useTranslations('errors');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptPp, setAcceptPp] = useState(false);
  const [acceptCookies, setAcceptCookies] = useState(false);
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

  const showSignInCTA =
    error?.kind === 'server' && error.mapped.business === BusinessError.EMAIL_ALREADY_REGISTERED;

  const loginHref = buildLocalePath(locale, '/login');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError({ kind: 'client', key: 'invalid_email_format' });
      return;
    }
    if (!isValidPassword(password)) {
      setError({ kind: 'client', key: 'password_too_short' });
      return;
    }
    if (!acceptTos || !acceptPp || !acceptCookies) {
      setError({ kind: 'client', key: 'consent_required' });
      return;
    }

    const result = await registerUser({
      email,
      password,
      consent: {
        types: ['terms_of_service', 'privacy_policy', 'cookies'],
        version: consentVersion,
        accepted: true
      }
    });

    if (!result.ok) {
      setError({ kind: 'server', mapped: result.error });
      return;
    }

    const trimmedEmail = email.trim();
    const target = `${buildLocalePath(locale, '/auth/check-email')}?email=${encodeURIComponent(trimmedEmail)}`;
    // Full-page navigation mirrors the login form rationale: lets the
    // @supabase/ssr browser client finish writing auth cookies before any
    // server-side `auth.getUser()` runs on the destination route.
    startTransition(() => {
      window.location.assign(target);
    });
  }

  const isSubmitting = isPending;

  return (
    <form
      onSubmit={handleSubmit}
      // `method="post"` is a defense-in-depth: if hydration ever fails (e.g.
      // Next.js dev cross-origin block on `_next/*`), the React onSubmit
      // handler won't attach. Without an explicit method the browser falls
      // back to GET and serialises `password` into the URL. POST keeps it in
      // the body (where the server simply 405s — no credential leak).
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
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
        <p className="text-xs text-neutral-500">{t('password_hint')}</p>
      </div>

      <fieldset className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
        <legend className="mb-1 text-sm font-medium text-neutral-800">{t('consent_legend')}</legend>
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            name="consent_tos"
            required
            checked={acceptTos}
            onChange={(e) => setAcceptTos(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <span>{t('consent_tos_label')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            name="consent_pp"
            required
            checked={acceptPp}
            onChange={(e) => setAcceptPp(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <span>{t('consent_pp_label')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            name="consent_cookies"
            required
            checked={acceptCookies}
            onChange={(e) => setAcceptCookies(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5"
          />
          <span>{t('consent_cookies_label')}</span>
        </label>
      </fieldset>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMessage}
          {showSignInCTA ? (
            <>
              {' '}
              <Link href={loginHref} className="font-medium underline hover:text-red-900">
                {t('already_registered_cta')}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>

      <p className="text-center text-sm text-neutral-600">
        {t('sign_in_prompt')}{' '}
        <Link href={loginHref} className="font-medium text-neutral-900 underline">
          {t('sign_in_link')}
        </Link>
      </p>
    </form>
  );
}
