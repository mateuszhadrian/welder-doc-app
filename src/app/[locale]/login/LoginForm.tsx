'use client';

import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/client';
import { BusinessError, mapAuthError, type MappedError } from '@/lib/supabase/errors';
import { migrateGuestAutosave } from '@/lib/autosave/migrateGuestAutosave';

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ClientValidationError = 'invalid_email_format' | 'password_required';

type FormError =
  | { kind: 'client'; key: ClientValidationError }
  | { kind: 'server'; mapped: MappedError };

type Props = {
  locale: string;
};

export function LoginForm({ locale }: Props) {
  const t = useTranslations('auth.login');
  const tErrors = useTranslations('errors');
  const tToasts = useTranslations('toasts');
  const tDocuments = useTranslations('documents');
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [resendSent, setResendSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const errorMessage = (() => {
    if (!error) return null;
    if (error.kind === 'client') return tErrors(error.key);
    // Fallback to errors.unknown if the mapped key is missing in the bundle.
    try {
      return tErrors(
        error.mapped.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]
      );
    } catch {
      return tErrors('unknown');
    }
  })();

  const showResend =
    error?.kind === 'server' && error.mapped.business === BusinessError.EMAIL_NOT_CONFIRMED;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResendSent(false);

    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError({ kind: 'client', key: 'invalid_email_format' });
      return;
    }
    if (password.length < 1) {
      setError({ kind: 'client', key: 'password_required' });
      return;
    }

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password
    });

    if (authError) {
      const mapped = mapAuthError(authError);
      setError(mapped ? { kind: 'server', mapped } : null);
      return;
    }

    if (data.user) {
      const migration = await migrateGuestAutosave(
        supabase,
        data.user.id,
        tDocuments('untitled_default')
      );
      if (migration.migrated) {
        toast.success(tToasts('guest_migrated'));
      } else if (migration.reason === 'project_limit') {
        toast.warning(tToasts('guest_migration_limit'));
      } else if (migration.reason === 'db_error') {
        toast.error(tToasts('guest_migration_failed'));
      }
    }

    const next = searchParams.get('next');
    // For the default locale, the canonical URL has no prefix (next-intl
    // `localePrefix: 'as-needed'`).
    const fallback = locale === routing.defaultLocale ? '/' : `/${locale}`;
    // Full page navigation rather than `router.replace`: after
    // `signInWithPassword` the @supabase/ssr browser client writes auth
    // cookies via `document.cookie`, but a soft RSC navigation can race
    // ahead of that write — the server's `auth.getUser()` then returns null
    // and the LocaleGuard / consent re-check silently skip. A full reload
    // guarantees the next request carries the fresh session cookies.
    startTransition(() => {
      window.location.assign(next ?? fallback);
    });
  }

  async function handleResend() {
    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError({ kind: 'client', key: 'invalid_email_format' });
      return;
    }
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: trimmedEmail
    });
    if (resendError) {
      const mapped = mapAuthError(resendError);
      setError(mapped ? { kind: 'server', mapped } : null);
      return;
    }
    setResendSent(true);
  }

  const isSubmitting = isPending;

  return (
    <form
      onSubmit={handleSubmit}
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('password_placeholder')}
          disabled={isSubmitting}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
      </div>

      <Link
        href={buildLocalePath(locale, '/forgot-password')}
        className="self-end text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
      >
        {t('forgot_password_link')}
      </Link>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      ) : null}

      {showResend ? (
        <button
          type="button"
          onClick={handleResend}
          disabled={isSubmitting}
          className="self-start text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
        >
          {t('resend_verification')}
        </button>
      ) : null}

      {resendSent ? (
        <p className="text-sm text-emerald-700" role="status">
          {t('resend_verification_sent')}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
