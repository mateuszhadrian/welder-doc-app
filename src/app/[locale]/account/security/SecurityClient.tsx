'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { UpdatePasswordForm } from '@/components/account/UpdatePasswordForm';

type Props = {
  loginHref: string;
};

export function SecurityClient({ loginHref }: Props) {
  const tAccount = useTranslations('account');
  // `key` forces UpdatePasswordForm to remount on success so the inputs
  // (kept in component-local useState — never in a store) reset to empty.
  const [resetKey, setResetKey] = useState(0);

  const handleSuccess = useCallback(() => {
    toast.success(tAccount('password_updated'));
    setResetKey((k) => k + 1);
  }, [tAccount]);

  const handleSessionMissing = useCallback(() => {
    // Settings flow: an expired session means we need to re-authenticate.
    // Sign out cleanly so stale cookies don't trip the LocaleGuard, then
    // bounce to /login. We don't need to wait for the signOut promise —
    // the navigation kills the page either way, but awaiting keeps the
    // cookie clear deterministic before the next request.
    void (async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.assign(loginHref);
    })();
  }, [loginHref]);

  return (
    <UpdatePasswordForm
      key={resetKey}
      onSuccess={handleSuccess}
      onSessionMissing={handleSessionMissing}
    />
  );
}
