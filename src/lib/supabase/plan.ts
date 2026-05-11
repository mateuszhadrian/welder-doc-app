import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { UserPlan } from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

/**
 * Permissive UUID v1–v5 / nil shape (8-4-4-4-12 hex). Strict version/variant
 * nibbles are intentionally not enforced — the DB does the authoritative
 * `22P02` check on cast to `uuid`. This regex is purely a fail-fast guard so
 * obviously malformed strings never burn a Supabase round-trip.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Discriminated union mirroring the convention used by `listSubscriptions`,
 * `getUserProfile`, and the document helpers — keeps callers off raw
 * `error.message.includes(...)` checks and uniform with the rest of `src/lib/supabase/`.
 */
export type FetchEffectivePlanResult =
  | { data: UserPlan; error: null }
  | { data: null; error: MappedError };

/**
 * Narrows an unknown SDK scalar to `UserPlan`. PostgREST returns the function
 * result as a JSON-encoded scalar string; the SDK exposes it as `string | null`
 * in `Database['public']['Functions']['effective_plan'].Returns`. Reject anything
 * else so a future DB-side typo or unexpected value cannot silently turn
 * paying users into free-tier ones.
 */
export function assertIsUserPlan(value: unknown): asserts value is UserPlan {
  if (value !== 'free' && value !== 'pro') {
    throw new Error(`Unexpected effective_plan value: ${String(value)}`);
  }
}

/**
 * Real-time `'pro' | 'free'` lookup computed directly from `public.subscriptions`,
 * bypassing the `user_profiles.plan` cache. Use only in cache-bypass scenarios
 * (post-Paddle-checkout return page where the webhook may not have updated the
 * cache yet, or explicit "refresh plan" UX). For every other read path use
 * `user_profiles.plan` — the trigger `subscriptions_after_iu_refresh_plan` and
 * the daily `refresh_expired_plans` cron keep that cache fresh.
 *
 * SECURITY NOTE: the underlying SQL function does NOT enforce
 * `uid = auth.uid()` — any authenticated caller can pass any UUID. Pass
 * `(await supabase.auth.getUser()).data.user.id` ONLY; never accept `userId`
 * from user-controlled input (URL params, request bodies). See plan §6.2.
 *
 * Performance: do not invoke from layouts, render loops, or hot paths.
 * Designed for at most a handful of calls per checkout session.
 *
 * Reference: .ai/api-endpoints-implementation-plans/effective-plan-rpc-post-endpoint-implementation-plan.md
 */
export async function fetchEffectivePlan(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<FetchEffectivePlanResult> {
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return {
      data: null,
      error: {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawMessage: 'invalid_uuid'
      }
    };
  }

  const { data, error } = await supabase.rpc('effective_plan', { uid: userId });

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  // PostgREST should never return `data: null` without an `error` for this
  // function (the SQL body always evaluates to a scalar). Treat as a transport
  // anomaly rather than silently defaulting to 'free' — UI then falls back to
  // the cached `user_profiles.plan`.
  if (data === null) {
    return {
      data: null,
      error: {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawMessage: 'effective_plan_null_response'
      }
    };
  }

  try {
    assertIsUserPlan(data);
  } catch {
    return {
      data: null,
      error: {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawMessage: `unexpected_effective_plan_value:${String(data)}`
      }
    };
  }

  return { data, error: null };
}
