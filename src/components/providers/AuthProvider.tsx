'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useResetUserScoped } from '@/store/use-canvas-store';

/**
 * Subscribes to `supabase.auth.onAuthStateChange` so a sign-out in one tab
 * propagates to every other tab (multi-tab sync, US-003).
 *
 * On `SIGNED_OUT`: clear user-scoped Zustand state and navigate home in the
 * current locale. The active tab also runs the same cleanup via
 * `SignOutButton` — duplicating the navigation is harmless (`router.push`
 * to the same URL is a no-op).
 *
 * Mount inside `NextIntlClientProvider` so `useLocale()` resolves.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const resetUserScoped = useResetUserScoped();

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        resetUserScoped();
        router.push(`/${locale}`);
        router.refresh();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [locale, resetUserScoped, router]);

  return <>{children}</>;
}
