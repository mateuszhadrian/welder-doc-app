'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { usePollSubscriptionActivation } from '@/lib/supabase/usePollSubscriptionActivation';

interface Props {
  locale: string;
  kind: 'upgrade' | 'portal';
}

/**
 * Billing call-to-action buttons (US-044, US-045, US-046).
 *
 * Rendered as a small Client Component so the Server-Component page can stay
 * pure data-fetch + render. Two intentional seams exist here that wire to
 * stories outside the scope of this endpoint:
 *
 *  - US-045 (Pro upgrade): the "Upgrade" button must call
 *    `paddle.Checkout.open({ items, customData: { user_id }, successCallback })`.
 *    The `customData.user_id` is mandatory per CLAUDE.md PR checklist —
 *    without it the first `subscription.created` webhook can drop into the
 *    orphan branch. The successCallback should call `poll.start()` (already
 *    wired below) so we resolve the active row before the user navigates.
 *
 *  - US-046 (Customer Portal): the "Manage subscription" button must call
 *    `paddle.CustomerPortal.open({ customerId })` using the
 *    `paddle_customer_id` already loaded by the Server Component. Pass it
 *    in via a new prop when wiring.
 *
 * Until those stories land both buttons fall through to a placeholder toast.
 * The polling hook is already instantiated and exposed via `data-testid` so
 * the Playwright spec for US-045 has a target.
 */
export function BillingCTAs({ locale: _locale, kind }: Props) {
  const t = useTranslations('billing');
  const router = useRouter();

  // The hook is instantiated even when the visible CTA is the portal button —
  // a future "Switch plan" affordance under the portal flow will reuse the
  // same poll on `subscription.updated`, so the lifecycle stays here.
  const poll = usePollSubscriptionActivation({
    expectedPlanTier: 'pro_monthly',
    onActivated: () => {
      toast.success(t('payment_activated_toast'));
      router.refresh();
    },
    onTimedOut: () => {
      toast.info(t('processing_payment_toast'));
    }
  });

  if (kind === 'portal') {
    return (
      <button
        type="button"
        data-testid="billing-portal-cta"
        // TODO US-046: paddle.CustomerPortal.open({ customerId: paddleCustomerId })
        onClick={() => toast.info(t('processing_payment_toast'))}
        className="inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      >
        {t('manage_subscription_cta')}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="billing-upgrade-cta"
      disabled={poll.polling}
      // TODO US-045: paddle.Checkout.open({
      //   items: [{ priceId, quantity: 1 }],
      //   customData: { user_id },
      //   successCallback: () => poll.start()
      // })
      onClick={() => {
        toast.info(t('processing_payment_toast'));
        poll.start();
      }}
      className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {poll.polling ? t('upgrade_pending') : t('upgrade_cta')}
    </button>
  );
}
