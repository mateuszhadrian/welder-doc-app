import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { listSubscriptions } from '@/lib/supabase/subscriptions';
import { BusinessError } from '@/lib/supabase/errors';
import type { SubscriptionDto, SubscriptionPlanTier, SubscriptionStatus } from '@/types/api';
import { BillingCTAs } from './BillingCTAs';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Mirrors the canonical helper in `[locale]/layout.tsx`. Normalises `/` → ''
 * so the default locale renders without prefix. Kept local because the
 * layout copy is not exported (other page-level form components in this
 * codebase follow the same idiom — see CLAUDE.md memory).
 */
function buildLocalePath(targetLocale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return targetLocale === routing.defaultLocale
    ? normalised || '/'
    : `/${targetLocale}${normalised}`;
}

/** Statuses that must render the Customer Portal CTA (plan §4 200 OK). */
const PORTAL_ELIGIBLE_STATUSES = new Set<SubscriptionStatus>(['active', 'trialing', 'past_due']);

/**
 * GET /[locale]/settings/billing — billing history (US-044).
 *
 * Flow:
 *   1. `auth.getUser()` — auth gate; sends anons to /login with ?next= for
 *      return. The `[locale]/layout.tsx` LocaleGuard + consent re-check
 *      already ran before this page renders, so we are NOT duplicating those
 *      checks — only the session presence guard.
 *   2. Parallel reads: `listSubscriptions(supabase)` + `paddle_customer_id`
 *      (single-column `user_profiles` select). The customer id is needed to
 *      gate the Customer Portal CTA per plan §4 / §6.5 — `user_profiles.ts`
 *      `getUserProfile()` deliberately omits this column from its projection,
 *      so we read it inline here rather than broadening that helper.
 *   3. Branch on `listSubscriptions` result:
 *      - UNAUTHORIZED → redirect to /login (token expired between layout & here).
 *      - any other error → render error state with retry.
 *      - `[]` → render Free-plan state + Upgrade CTA.
 *      - else → render latest row + history list. Customer Portal CTA gates on
 *        `PORTAL_ELIGIBLE_STATUSES` AND non-null `paddle_customer_id`.
 */
export default async function BillingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const next = buildLocalePath(locale, '/settings/billing');
    redirect(`${buildLocalePath(locale, '/login')}?next=${encodeURIComponent(next)}`);
  }

  // Parallel: subscription list + paddle_customer_id read. Promise.all keeps
  // both round-trips on the critical path (no waterfall) — `listSubscriptions`
  // already runs `auth.getUser()` internally, but the second call inside the
  // helper is cached by @supabase/ssr (memoised per request) so this is free.
  const [subscriptionsResult, customerIdResult] = await Promise.all([
    listSubscriptions(supabase),
    supabase.from('user_profiles').select('paddle_customer_id').eq('id', user.id).single()
  ]);

  if (subscriptionsResult.error) {
    if (subscriptionsResult.error.business === BusinessError.UNAUTHORIZED) {
      redirect(buildLocalePath(locale, '/login'));
    }
    return (
      <BillingErrorState
        // For UNKNOWN we surface the endpoint-specific i18n key per plan §7;
        // any other mapped business code keeps its own message (e.g. rate-limited).
        messageKey={
          subscriptionsResult.error.business === BusinessError.UNKNOWN
            ? 'errors.subscription_load_failed'
            : subscriptionsResult.error.message
        }
        locale={locale}
      />
    );
  }

  // Best-effort: a missing `paddle_customer_id` is the common case (free
  // user). A read error here should not break the page — it only means the
  // Customer Portal CTA stays hidden, which is the correct fallback.
  const paddleCustomerId = customerIdResult.data?.paddle_customer_id ?? null;

  const subscriptions = subscriptionsResult.data;
  const latest = subscriptions[0] ?? null;
  const showPortalCta =
    paddleCustomerId !== null &&
    latest !== null &&
    PORTAL_ELIGIBLE_STATUSES.has(latest.status as SubscriptionStatus);

  if (subscriptions.length === 0 || latest === null) {
    return <BillingFreeState locale={locale} />;
  }

  return (
    <BillingShell
      locale={locale}
      latest={latest}
      history={subscriptions.slice(1)}
      showPortalCta={showPortalCta}
    />
  );
}

// ============================================================
// Render shells — kept in-file because they're page-specific
// and have no other consumer. Promote to standalone components
// once a /settings/* nav lands and they need to be reused.
// ============================================================

async function BillingErrorState({ messageKey, locale }: { messageKey: string; locale: string }) {
  const t = await getTranslations('billing');
  const tRoot = await getTranslations();

  return (
    <main className="flex min-h-[calc(100vh-3rem)] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('error_title')}</h1>
        <p className="mt-3 text-sm text-neutral-600">{tRoot(messageKey)}</p>
        <a
          href={buildLocalePath(locale, '/settings/billing')}
          className="mt-6 inline-block rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
        >
          {t('retry')}
        </a>
      </div>
    </main>
  );
}

async function BillingFreeState({ locale }: { locale: string }) {
  const t = await getTranslations('billing');

  return (
    <main className="min-h-[calc(100vh-3rem)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('page_title')}</h1>
        <section
          data-testid="billing-free-state"
          className="mt-6 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 className="text-lg font-semibold text-neutral-900">{t('free_plan_title')}</h2>
          <p className="mt-2 text-sm text-neutral-600">{t('free_plan_subtitle')}</p>
          <div className="mt-6">
            <BillingCTAs locale={locale} kind="upgrade" />
          </div>
        </section>
      </div>
    </main>
  );
}

async function BillingShell({
  locale,
  latest,
  history,
  showPortalCta
}: {
  locale: string;
  latest: SubscriptionDto;
  history: SubscriptionDto[];
  showPortalCta: boolean;
}) {
  const t = await getTranslations('billing');

  return (
    <main className="min-h-[calc(100vh-3rem)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('page_title')}</h1>

        <section
          data-testid="billing-current"
          className="mt-6 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <header className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">
              {t(`plan_tier.${latest.plan_tier as SubscriptionPlanTier}`)}
            </h2>
            <span
              data-testid="billing-current-status"
              className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700"
            >
              {t(`status.${latest.status as SubscriptionStatus}`)}
            </span>
          </header>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-neutral-600">
            <dt className="font-medium text-neutral-700">{t('current_period_start')}</dt>
            <dd>{formatDate(latest.current_period_start, locale)}</dd>
            <dt className="font-medium text-neutral-700">{t('current_period_end')}</dt>
            <dd>{formatDate(latest.current_period_end, locale)}</dd>
            {latest.cancel_at && (
              <>
                <dt className="font-medium text-neutral-700">{t('cancels_at')}</dt>
                <dd>{formatDate(latest.cancel_at, locale)}</dd>
              </>
            )}
          </dl>
          <div className="mt-6">
            <BillingCTAs locale={locale} kind={showPortalCta ? 'portal' : 'upgrade'} />
          </div>
        </section>

        {history.length > 0 && (
          <section
            data-testid="billing-history"
            className="mt-8 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 className="text-lg font-semibold text-neutral-900">{t('history_title')}</h2>
            <ul className="mt-4 divide-y divide-neutral-200">
              {history.map((sub) => (
                <li
                  key={sub.id}
                  className="flex items-baseline justify-between py-3 text-sm"
                  data-testid="billing-history-row"
                >
                  <div>
                    <span className="font-medium text-neutral-900">
                      {t(`plan_tier.${sub.plan_tier as SubscriptionPlanTier}`)}
                    </span>
                    <span className="ml-3 text-neutral-500">
                      {formatDate(sub.current_period_start, locale)} –{' '}
                      {formatDate(sub.current_period_end, locale)}
                    </span>
                  </div>
                  <span className="text-xs tracking-wide text-neutral-500 uppercase">
                    {t(`status.${sub.status as SubscriptionStatus}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function formatDate(iso: string | null, locale: string): string {
  // The DB columns `current_period_start`, `current_period_end`, `cancel_at`
  // are nullable — webhook rows surface as `null` until Paddle backfills the
  // period. Render an em-dash so the row layout is preserved.
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === 'pl' ? 'pl-PL' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
