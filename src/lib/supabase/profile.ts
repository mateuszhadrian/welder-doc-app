import type { PostgrestSingleResponse, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Tables, TablesUpdate } from '@/types/database';
import type { UserProfileDto } from '@/types/api';
import { createClient } from './client';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

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

/**
 * Allowlisted projection for `getUserProfile()`. `paddle_customer_id` is
 * intentionally excluded from session-client reads (operational metadata,
 * no UI consumer). Keep this string in sync with `UserProfileDto`.
 */
const PROFILE_COLUMNS =
  'id, plan, locale, current_consent_version, created_at, updated_at' as const;

export type GetUserProfileResult =
  | { data: UserProfileDto; error: null }
  | { data: null; error: MappedError };

/**
 * Read the authenticated user's row from `public.user_profiles`.
 *
 * Client-agnostic: accepts the Supabase client as an argument so Server
 * Components, Route Handlers, and Client Components can all reuse it without
 * importing the wrong `createClient` variant.
 *
 * Authorization is enforced by RLS (`user_profiles_select_authenticated`:
 * `id = auth.uid()`). The `userId` argument is defence-in-depth — RLS will
 * still reject any UUID that does not match the active session.
 *
 * Errors are normalised through `mapPostgrestError()` to a typed `MappedError`,
 * so callers must never inspect raw `PostgrestError.message`.
 */
export async function getUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<GetUserProfileResult> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  // The `select` string is an exact match for the `UserProfileDto` Pick<>
  // projection — broaden one and broaden the other.
  return { data: data as UserProfileDto, error: null };
}
