import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SubscriptionDto } from '@/types/api';

const { listSubscriptionsMock } = vi.hoisted(() => ({
  listSubscriptionsMock: vi.fn()
}));

vi.mock('./client', () => ({
  createClient: () => ({ __isClient: true })
}));

vi.mock('./subscriptions', async () => {
  const actual = await vi.importActual<typeof import('./subscriptions')>('./subscriptions');
  return {
    ...actual,
    listSubscriptions: listSubscriptionsMock
  };
});

import { usePollSubscriptionActivation } from './usePollSubscriptionActivation';
import { BusinessError } from './errors';

const SUB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const activeMonthly: SubscriptionDto = {
  id: SUB_ID,
  status: 'active',
  plan_tier: 'pro_monthly',
  current_period_start: '2026-05-01T00:00:00Z',
  current_period_end: '2026-06-01T00:00:00Z',
  cancel_at: null,
  created_at: '2026-05-01T00:00:00Z'
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePollSubscriptionActivation — initial state', () => {
  it('starts with polling=false, activated=null, timedOut=false', () => {
    const { result } = renderHook(() =>
      usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly' })
    );

    expect(result.current.polling).toBe(false);
    expect(result.current.activated).toBeNull();
    expect(result.current.timedOut).toBe(false);
  });

  it('does not call listSubscriptions until start() fires', () => {
    renderHook(() => usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly' }));
    expect(listSubscriptionsMock).not.toHaveBeenCalled();
  });
});

describe('usePollSubscriptionActivation — happy path', () => {
  it('resolves immediately on attempt 1 when row is already active', async () => {
    listSubscriptionsMock.mockResolvedValue({ data: [activeMonthly], error: null });
    const onActivated = vi.fn();

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly', onActivated })
    );

    await act(async () => {
      result.current.start();
      // First attempt has delay=0, so flushing pending microtasks is enough.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(listSubscriptionsMock).toHaveBeenCalledTimes(1);
    expect(result.current.activated).toEqual(activeMonthly);
    expect(result.current.polling).toBe(false);
    expect(result.current.timedOut).toBe(false);
    expect(onActivated).toHaveBeenCalledWith(activeMonthly);
  });

  it('keeps polling between attempts and resolves on attempt 2 (after 1s)', async () => {
    listSubscriptionsMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [activeMonthly], error: null });

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly' })
    );

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    // After attempt 1 returned [], the loop is sleeping the 1000 ms gap.
    expect(result.current.polling).toBe(true);
    expect(result.current.activated).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(listSubscriptionsMock).toHaveBeenCalledTimes(2);
    expect(result.current.activated).toEqual(activeMonthly);
    expect(result.current.polling).toBe(false);
  });
});

describe('usePollSubscriptionActivation — plan_tier matching', () => {
  it('does NOT activate on a stale active row of a different plan_tier', async () => {
    const annualRow = { ...activeMonthly, plan_tier: 'pro_annual' as const };
    listSubscriptionsMock.mockResolvedValue({ data: [annualRow], error: null });

    const onActivated = vi.fn();
    const onTimedOut = vi.fn();

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({
        expectedPlanTier: 'pro_monthly',
        onActivated,
        onTimedOut
      })
    );

    await act(async () => {
      result.current.start();
      // Drain the entire schedule: 0 + 1000 + 2000 + 4000 = 7000 ms.
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(onActivated).not.toHaveBeenCalled();
    expect(onTimedOut).toHaveBeenCalledTimes(1);
    expect(result.current.timedOut).toBe(true);
    expect(result.current.activated).toBeNull();
    expect(result.current.polling).toBe(false);
  });

  it('does NOT activate on a non-active row even when plan_tier matches', async () => {
    listSubscriptionsMock.mockResolvedValue({
      data: [{ ...activeMonthly, status: 'past_due' as const }],
      error: null
    });

    const onActivated = vi.fn();

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({
        expectedPlanTier: 'pro_monthly',
        onActivated
      })
    );

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(onActivated).not.toHaveBeenCalled();
    expect(result.current.timedOut).toBe(true);
  });
});

describe('usePollSubscriptionActivation — error tolerance', () => {
  it('treats a transient UNAUTHORIZED on attempt 1 as "try next tick" — does not abort', async () => {
    listSubscriptionsMock
      .mockResolvedValueOnce({
        data: null,
        error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }
      })
      .mockResolvedValueOnce({ data: [activeMonthly], error: null });

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly' })
    );

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(listSubscriptionsMock).toHaveBeenCalledTimes(2);
    expect(result.current.activated).toEqual(activeMonthly);
  });
});

describe('usePollSubscriptionActivation — timeout', () => {
  it('fires onTimedOut and sets timedOut=true after 4 unmatched attempts', async () => {
    listSubscriptionsMock.mockResolvedValue({ data: [], error: null });

    const onTimedOut = vi.fn();
    const onActivated = vi.fn();
    const { result } = renderHook(() =>
      usePollSubscriptionActivation({
        expectedPlanTier: 'pro_monthly',
        onActivated,
        onTimedOut
      })
    );

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(listSubscriptionsMock).toHaveBeenCalledTimes(4);
    expect(onActivated).not.toHaveBeenCalled();
    expect(onTimedOut).toHaveBeenCalledTimes(1);
    expect(result.current.timedOut).toBe(true);
    expect(result.current.polling).toBe(false);
  });
});

describe('usePollSubscriptionActivation — idempotency', () => {
  it('a second start() while polling is a no-op (does not stack loops)', async () => {
    listSubscriptionsMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() =>
      usePollSubscriptionActivation({ expectedPlanTier: 'pro_monthly' })
    );

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.polling).toBe(true);

    await act(async () => {
      result.current.start();
      result.current.start();
      await vi.advanceTimersByTimeAsync(7000);
    });

    // Exactly 4 attempts from the first loop — re-clicks did not stack.
    expect(listSubscriptionsMock).toHaveBeenCalledTimes(4);
  });
});

describe('usePollSubscriptionActivation — unmount cancellation', () => {
  it('does not fire callbacks after the component unmounts mid-flight', async () => {
    listSubscriptionsMock.mockResolvedValue({ data: [], error: null });

    const onTimedOut = vi.fn();
    const onActivated = vi.fn();

    const { result, unmount } = renderHook(() =>
      usePollSubscriptionActivation({
        expectedPlanTier: 'pro_monthly',
        onActivated,
        onTimedOut
      })
    );

    await act(async () => {
      result.current.start();
      // Run the immediate first attempt only.
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();

    await act(async () => {
      // Drain the rest of the schedule — none of these should produce a
      // callback or setState because the cancellation ref is set.
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(onActivated).not.toHaveBeenCalled();
    expect(onTimedOut).not.toHaveBeenCalled();
  });
});
