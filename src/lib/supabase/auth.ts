'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Browser-only helper around `supabase.auth.signOut()` (US-003).
 *
 * Idempotent on purpose: an `AuthSessionMissingError` is treated as success so
 * the caller can always proceed with local cleanup (Zustand reset + redirect).
 * See `.ai/api-endpoints-implementation-plans/logout-post-endpoint-implementation-plan.md` §4.
 *
 * Default scope is `local` — `global` (multi-device sign-out) is intentionally
 * out of MVP scope.
 */
export async function signOutClient(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();

  if (error && error.name !== 'AuthSessionMissingError') {
    // Don't throw — the caller still runs local cleanup + redirect (defense-in-depth).
    console.warn('signOut error (proceeding with local cleanup):', error.message);
  }
}
