'use client';

import { useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UpdatePasswordForm } from '@/components/account/UpdatePasswordForm';

type Props = {
  loginExpiredHref: string;
  loginSuccessHref: string;
};

export function ResetPasswordClient({ loginExpiredHref, loginSuccessHref }: Props) {
  // Sign out the recovery session before redirecting: (1) terminates a
  // session that was only meant for the password update, (2) forces the
  // user to verify they remember the new password, (3) avoids landing
  // them on a post-auth route (/, /consent-required) when /login?reset=success
  // was the intended destination — login/page.tsx redirects signed-in users
  // away from /login.
  // Hard navigation (window.location.assign) so the next request carries
  // the cleared Supabase cookies — same reasoning as LoginForm.
  const handleSuccess = useCallback(() => {
    void (async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.assign(loginSuccessHref);
    })();
  }, [loginSuccessHref]);

  const handleSessionMissing = useCallback(() => {
    window.location.assign(loginExpiredHref);
  }, [loginExpiredHref]);

  return <UpdatePasswordForm onSuccess={handleSuccess} onSessionMissing={handleSessionMissing} />;
}
