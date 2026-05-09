import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import type { Tables, TablesUpdate } from '@/types/database';
import { createClient } from './client';

/**
 * Columns that must never be modified through the public profile-update path.
 * Mutations to these go through privileged routes only:
 * - `plan` and `paddle_customer_id`: Paddle webhook (service role).
 * - `current_consent_version`: RPC `record_consent_bundle()` (SECURITY DEFINER).
 *
 * Defense-in-depth layers (architecture-base.md §22, api-plan.md §2.2):
 *   L1 type — `SafeUpdate` strips these at compile time.
 *   L2 runtime — this wrapper drops them from the patch before PATCH.
 *   L3 DB trigger — `block_protected_columns_update` silently restores OLD.<col>.
 */
const PROTECTED_FIELDS = ['plan', 'paddle_customer_id', 'current_consent_version'] as const;
type ProtectedField = (typeof PROTECTED_FIELDS)[number];

type UserProfileUpdate = TablesUpdate<'user_profiles'>;

/** Patch shape accepted by `updateProfile()` — protected columns excluded by type. */
export type SafeUpdate = Omit<UserProfileUpdate, ProtectedField>;

/**
 * Update the authenticated user's row in `public.user_profiles`.
 *
 * This is the ONLY allowed code path for mutating `user_profiles`. Direct
 * `supabase.from('user_profiles').update(...)` calls are forbidden by the
 * architecture invariant in CLAUDE.md.
 *
 * Authorization is enforced by RLS: `id = auth.uid()` USING + WITH CHECK.
 * Passing a `userId` that does not match the active session results in a
 * PostgREST 406/403 with `data === null`.
 *
 * Returns the native `PostgrestSingleResponse` so callers can pipe the error
 * through `mapPostgrestError()` without an extra abstraction layer.
 *
 * Empty-patch shortcut: if every key in `patch` is a protected field, the
 * function returns `{ data: null, error: null }` without any network round-trip.
 */
export async function updateProfile(
  userId: string,
  patch: SafeUpdate
): Promise<PostgrestSingleResponse<Tables<'user_profiles'>>> {
  const protectedSet = new Set<string>(PROTECTED_FIELDS);
  const safe: SafeUpdate = {};

  for (const [key, value] of Object.entries(patch)) {
    if (protectedSet.has(key)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[updateProfile] Dropped protected field "${key}" from patch. ` +
            `Use the privileged route (Paddle webhook / record_consent_bundle RPC) instead.`
        );
      }
      continue;
    }
    (safe as Record<string, unknown>)[key] = value;
  }

  if (Object.keys(safe).length === 0) {
    // Empty-patch shortcut: skip the network round-trip. The response shape
    // intentionally mirrors a successful no-op (data=null, error=null) so
    // callers can pipe through `mapPostgrestError(error)` uniformly. Cast
    // through `unknown` because PostgrestSingleResponse is a strict
    // discriminated union (success XOR failure) which doesn't model no-ops.
    return {
      data: null,
      error: null,
      count: null,
      status: 200,
      statusText: 'OK'
    } as unknown as PostgrestSingleResponse<Tables<'user_profiles'>>;
  }

  return createClient().from('user_profiles').update(safe).eq('id', userId).select().single();
}
