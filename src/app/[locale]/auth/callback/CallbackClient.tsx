'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { flushPendingConsent } from '@/lib/auth/registration';

type Props = {
  /** Absolute path (with locale prefix when applicable) to navigate to once consent is flushed. */
  destination: string;
};

export function CallbackClient({ destination }: Props) {
  const t = useTranslations('auth.callback');
  const tErrors = useTranslations('errors');
  // StrictMode mounts effects twice in dev — guard against double-flushing.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      const result = await flushPendingConsent();
      if (!result.ok) {
        // Best-effort: surface a toast but still navigate. The layout's consent
        // re-check will redirect to /consent-required if the bundle is missing,
        // so the user is never trapped — they just complete consent there.
        toast.error(tErrors('consent_failed'));
      }
      window.location.assign(destination);
    })();
  }, [destination, tErrors]);

  return (
    <p className="text-sm text-neutral-600" aria-live="polite">
      {t('processing')}
    </p>
  );
}
