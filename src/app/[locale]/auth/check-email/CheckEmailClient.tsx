'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { resendVerificationEmail } from '@/lib/auth/resendVerificationEmail';
import { type MappedError } from '@/lib/supabase/errors';

const RESEND_COOLDOWN_SECONDS = 60;

type Props = {
  email: string | null;
  locale: string;
};

export function CheckEmailClient({ email, locale }: Props) {
  const t = useTranslations('auth.checkEmail');
  const tErrors = useTranslations('errors');

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendSent, setResendSent] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const errorMessage = (() => {
    if (!error) return null;
    try {
      return tErrors(error.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]);
    } catch {
      return tErrors('unknown');
    }
  })();

  const buildLocalePath = (segment: string) =>
    locale === routing.defaultLocale ? segment : `/${locale}${segment}`;

  const loginHref = buildLocalePath('/login');

  async function handleResend() {
    if (!email || secondsLeft > 0 || isPending) return;
    setError(null);
    setResendSent(false);
    setIsPending(true);

    const emailRedirectTo = `${process.env.NEXT_PUBLIC_APP_URL}${buildLocalePath('/auth/callback')}`;

    const result = await resendVerificationEmail({
      type: 'signup',
      email,
      emailRedirectTo
    });

    setIsPending(false);

    if (!result.ok) {
      setError(result.mapped);
      return;
    }

    setResendSent(true);
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }

  const subtitle = email ? t('subtitle_with_email', { email }) : t('subtitle_generic');

  const resendLabel =
    secondsLeft > 0 ? t('resend_countdown', { seconds: secondsLeft }) : t('resend');

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-neutral-700">{subtitle}</p>
      <p className="text-xs text-neutral-500">{t('spam_hint')}</p>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      ) : null}

      {resendSent ? (
        <p role="status" className="text-sm text-emerald-700">
          {t('resend_sent')}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleResend}
        disabled={!email || secondsLeft > 0 || isPending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {resendLabel}
      </button>

      <Link
        href={loginHref}
        className="text-center text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
      >
        {t('back_to_login')}
      </Link>
    </div>
  );
}
