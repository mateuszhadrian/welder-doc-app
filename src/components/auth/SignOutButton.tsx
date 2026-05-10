'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { signOutClient } from '@/lib/supabase/auth';
import { useResetUserScoped } from '@/store/use-canvas-store';

/**
 * US-003 sign-out trigger. Always runs local cleanup + redirect even if the
 * Supabase call fails — `signOutClient()` swallows `AuthSessionMissingError`,
 * and any other failure is surfaced via `console.warn` while UX continues.
 *
 * Redirect target is the URL-derived locale (`useLocale()`), NOT the profile
 * locale, because the profile is gone after sign-out.
 */
export function SignOutButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('auth.signOut');
  const resetUserScoped = useResetUserScoped();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    try {
      await signOutClient();
      resetUserScoped();
      router.push(`/${locale}`);
      // Refresh forces middleware to re-evaluate without the session cookie.
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? t('submitting') : t('label')}
    </button>
  );
}
