'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { routing, type Locale } from '@/i18n/routing';
import { mapPostgrestError } from '@/lib/supabase/errors';
import { updateProfile } from '@/lib/supabase/profile';

const LOCALE_PREFIX_RE = new RegExp(`^/(${routing.locales.join('|')})(?=/|$)`);
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function stripLocale(pathname: string): string {
  return pathname.replace(LOCALE_PREFIX_RE, '') || '/';
}

function buildLocalePath(targetLocale: Locale, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  if (targetLocale === routing.defaultLocale) {
    return normalised || '/';
  }
  return `/${targetLocale}${normalised}`;
}

function persistLocaleCookie(target: Locale): void {
  document.cookie = `NEXT_LOCALE=${target}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

type Props = {
  /** Locale currently rendered (from the URL `[locale]` segment). */
  currentLocale: Locale;
  /**
   * Authenticated user id from the session. When omitted, the switcher
   * runs in guest mode: it skips the `user_profiles` PATCH and only
   * updates the `NEXT_LOCALE` cookie + URL. The `LocaleGuard` in
   * `[locale]/layout.tsx` is the source of truth post-sign-in, so guest
   * preference is intentionally ephemeral.
   */
  userId?: string;
};

/**
 * Switches the UI language. For authenticated users, persists the choice
 * via `updateProfile()` (US-050). The cookie is set BEFORE `router.replace`
 * so the next request already carries the new preference and `LocaleGuard`
 * does not trigger a second redirect (api-plan.md §5).
 *
 * Direct `supabase.from('user_profiles').update(...)` is forbidden by
 * architecture invariant (CLAUDE.md) — always go through `updateProfile`.
 */
export function LocaleSwitcher({ currentLocale, userId }: Props) {
  const t = useTranslations('localeSwitcher');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  async function handleSelect(target: Locale) {
    if (target === currentLocale || isPending) return;

    if (userId) {
      const { error } = await updateProfile(userId, { locale: target });
      if (error) {
        const mapped = mapPostgrestError(error);
        const messageKey = (mapped?.message ?? 'errors.unknown').replace(
          /^errors\./,
          ''
        ) as Parameters<typeof tErrors>[0];
        try {
          toast.error(tErrors(messageKey));
        } catch {
          toast.error(tErrors('unknown'));
        }
        return;
      }
    }

    persistLocaleCookie(target);

    const targetPath = buildLocalePath(target, stripLocale(pathname ?? '/'));
    startTransition(() => {
      router.replace(targetPath);
    });
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex gap-1 rounded-md border border-neutral-200 bg-white p-1"
    >
      {routing.locales.map((loc) => {
        const isActive = loc === currentLocale;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => handleSelect(loc)}
            disabled={isPending}
            aria-pressed={isActive}
            lang={loc}
            className={
              isActive
                ? 'rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white'
                : 'rounded px-2 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {t(`locale_${loc}`)}
          </button>
        );
      })}
    </div>
  );
}
