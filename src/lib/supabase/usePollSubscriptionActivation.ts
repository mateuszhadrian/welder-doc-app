'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubscriptionDto, SubscriptionPlanTier, SubscriptionStatus } from '@/types/api';
import { createClient } from './client';
import { listSubscriptions } from './subscriptions';

/**
 * Backoff schedule for the post-checkout activation poll (US-045).
 *
 * `ATTEMPT_DELAYS_MS[i]` is the wait BEFORE attempt `i`. The first attempt
 * fires immediately (delay 0) — Paddle's `subscription.created` webhook
 * usually lands faster than the user can navigate, so the first poll often
 * already finds the row. Total worst-case wait before timeout fires:
 *
 *   0 + 1000 + 2000 + 4000 = 7000 ms
 *
 * Plan §8 calls out "1s / 2s / 4s up to 4 attempts". Bumping the cap further
 * silently masks Paddle webhook outages — keep the timeout short and surface
 * a "processing" toast so the user knows to refresh.
 */
const ATTEMPT_DELAYS_MS = [0, 1000, 2000, 4000] as const;

const ACTIVATED_STATUS: SubscriptionStatus = 'active';

export interface UsePollSubscriptionActivationOptions {
  /** Plan the user just purchased — only matching rows count as "activated". */
  expectedPlanTier: SubscriptionPlanTier;
  /** Fired once when a matching `status='active'` row appears. */
  onActivated?: (sub: SubscriptionDto) => void;
  /** Fired once when the schedule exhausts without a match. */
  onTimedOut?: () => void;
}

export interface UsePollSubscriptionActivationResult {
  /**
   * Begin polling. No-op if a previous `start()` is still running. Idempotent
   * across re-renders; safe to wire to a Paddle Checkout `successCallback`.
   */
  start: () => void;
  /** True between `start()` and resolution (activation OR timeout). */
  polling: boolean;
  /** The matched subscription, or null until activation. */
  activated: SubscriptionDto | null;
  /** True after the schedule exhausts without a match. */
  timedOut: boolean;
}

/**
 * Polling hook for the Paddle Checkout success → subscription.created webhook
 * race (US-045). The Checkout closes before the webhook upserts the row, so
 * a naive single read returns `[]` and the UI falsely renders "Free plan".
 *
 * Wire this to `paddle.Checkout.open({ ..., successCallback: () => poll.start() })`
 * inside the BillingCTAs component. The hook handles:
 *   - Backoff schedule (`ATTEMPT_DELAYS_MS`).
 *   - Matching plan_tier (a stale `pro_annual` row from before must NOT
 *     count as activation for a `pro_monthly` purchase).
 *   - Cancellation on unmount (no setState after unmount, no orphan timers).
 *   - Idempotency: a second `start()` while polling is a no-op.
 *
 * Errors from `listSubscriptions` (UNAUTHORIZED, UNKNOWN, …) are treated as
 * "this attempt failed; try again next tick" rather than aborting the loop.
 * The Settings page reads the final state via `effective_plan()` after a
 * full-page navigate — no need to short-circuit on a transient blip.
 */
export function usePollSubscriptionActivation({
  expectedPlanTier,
  onActivated,
  onTimedOut
}: UsePollSubscriptionActivationOptions): UsePollSubscriptionActivationResult {
  const [polling, setPolling] = useState(false);
  const [activated, setActivated] = useState<SubscriptionDto | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // `cancelled` blocks setState / callback fire after unmount (or after a
  // future `cancel()` is added). `running` makes `start()` idempotent during
  // an in-flight poll — re-clicking "Upgrade" must not stack two loops.
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  // Refs for callbacks so a stale `start()` closure picks up the latest
  // handlers without re-running the effect (callers commonly pass inline arrows).
  // Assignment must happen in an effect — the react-hooks/refs lint rule
  // forbids mutating .current during render because it breaks Concurrent
  // Mode's render-replay guarantee.
  const onActivatedRef = useRef(onActivated);
  const onTimedOutRef = useRef(onTimedOut);
  useEffect(() => {
    onActivatedRef.current = onActivated;
    onTimedOutRef.current = onTimedOut;
  });

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelledRef.current = false;
    setPolling(true);
    setActivated(null);
    setTimedOut(false);

    void (async () => {
      const supabase = createClient();
      try {
        for (const delay of ATTEMPT_DELAYS_MS) {
          if (cancelledRef.current) return;
          if (delay > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
          }
          if (cancelledRef.current) return;

          const result = await listSubscriptions(supabase);
          if (cancelledRef.current) return;
          if (result.error || !result.data) continue;

          const latest = result.data[0];
          if (
            latest &&
            latest.status === ACTIVATED_STATUS &&
            (latest.plan_tier as SubscriptionPlanTier) === expectedPlanTier
          ) {
            setActivated(latest);
            onActivatedRef.current?.(latest);
            return;
          }
        }
        if (!cancelledRef.current) {
          setTimedOut(true);
          onTimedOutRef.current?.();
        }
      } finally {
        if (!cancelledRef.current) {
          setPolling(false);
        }
        runningRef.current = false;
      }
    })();
  }, [expectedPlanTier]);

  return { start, polling, activated, timedOut };
}
