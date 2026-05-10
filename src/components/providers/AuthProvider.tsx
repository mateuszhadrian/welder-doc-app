'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { clearPendingSignupCredentials, flushPendingConsent } from '@/lib/auth/registration';
import { createClient } from '@/lib/supabase/client';
import { useResetUserScoped } from '@/store/use-canvas-store';

/**
 * Subscribes to `supabase.auth.onAuthStateChange` so a sign-out in one tab
 * propagates to every other tab (multi-tab sync, US-003), and flushes a
 * deferred consent bundle (US-001 sign-up) the first time a session appears
 * — runs after every callback (sign-up confirmation, OAuth, recovery), since
 * the route handler at /auth/callback can't reach sessionStorage itself.
 *
 * Mount inside `NextIntlClientProvider` so `useLocale()` resolves.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const tErrors = useTranslations('errors');
  const resetUserScoped = useResetUserScoped();

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        resetUserScoped();
        router.push(`/${locale}`);
        router.refresh();
        return;
      }

      // SIGNED_IN fires after the route-handler callback completes the PKCE
      // exchange and the SSR cookies materialise on the client side;
      // INITIAL_SESSION covers existing sessions on hard reload. Either way,
      // replay any deferred consent — flushPendingConsent is a no-op when
      // sessionStorage is empty.
      if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
        void flushPendingConsent().then((result) => {
          if (!result.ok) {
            toast.error(tErrors('consent_failed'));
            return;
          }
          // Resend-credentials are only useful pre-confirmation; once the
          // session is live, drop them to limit the password's exposure
          // window.
          clearPendingSignupCredentials();

          // Close the SSR-vs-client-flush race (US-052 plan §2): ONLY when
          // an actual flush happened (i.e., a fresh signup just confirmed
          // and the deferred consent bundle posted successfully). Without
          // the `flushed` guard this would also fire on every subsequent
          // sign-in (no-op flush) and kick the user off /consent-required
          // before they could re-accept an updated TOS.
          if (!result.flushed) return;
          if (typeof window === 'undefined') return;
          const stripped = window.location.pathname.replace(/^\/(en|pl)(?=\/|$)/, '');
          if (stripped === '/consent-required' || stripped.startsWith('/consent-required/')) {
            router.replace(`/${locale}`);
          }
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [locale, resetUserScoped, router, tErrors]);

  return <>{children}</>;
}
