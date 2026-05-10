import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { SubscriptionDto } from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

/**
 * Column whitelist for the Settings → Billing page (US-044) and the
 * post-checkout polling flow (US-045). Deliberately omits `user_id`
 * (RODO-deleted rows have it `NULL`), `paddle_subscription_id`, and
 * `paddle_customer_snapshot` — those are billing-internal and have no UI
 * consumer (api-plan.md §6 / endpoint plan §6).
 */
const SELECT_COLUMNS =
  'id, status, plan_tier, current_period_start, current_period_end, cancel_at, created_at' as const;

export type ListSubscriptionsResult =
  | { data: SubscriptionDto[]; error: null }
  | { data: null; error: MappedError };

/**
 * List the authenticated user's subscription history (US-044, US-045).
 *
 * Authorisation lives in the database, not here:
 *   - RLS policy `subscriptions_select_authenticated` enforces
 *     `user_id = auth.uid()`. Sending a different UUID via `.eq('user_id', …)`
 *     yields zero rows, never a 401 — existence of other users' rows is not
 *     leaked. There are no INSERT/UPDATE/DELETE policies on this table; the
 *     only mutation path is `POST /api/paddle/webhook` running with
 *     `service_role`.
 *
 * The `auth.getUser()` preflight is NOT a duplicate of RLS — it guards the
 * anon-role-with-no-cookies case (logout in another tab, manual cookie
 * clear). Without it, a session-less call would hit PostgREST as `anon` and
 * silently return `[]`, which UI would render as "Free plan" instead of
 * surfacing the auth problem.
 *
 * Returns the SDK row shape narrowed to `SubscriptionDto[]`. The DB row's
 * `status` and `plan_tier` are typed as raw `string` in `Database`; the hook
 * layer (UI) re-casts to literal unions before rendering CTA gating.
 *
 * Empty array `[]` is the **normal** response for free-tier users who never
 * opened Paddle Checkout — callers must treat it as "no subscription yet"
 * (Upgrade CTA), not as an error.
 */
export async function listSubscriptions(
  supabase: SupabaseClient<Database>
): Promise<ListSubscriptionsResult> {
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      data: null,
      error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }
    };
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select(SELECT_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    // Endpoint-specific i18n key (`errors.subscription_load_failed`) is
    // chosen by the UI layer based on `business === UNKNOWN`, mirroring how
    // the Settings page renders a more actionable "Nie udało się wczytać
    // subskrypcji" toast instead of the generic "Coś poszło nie tak" copy.
    return { data: null, error: mapped };
  }

  return {
    data: (data ?? []) as SubscriptionDto[],
    error: null
  };
}
