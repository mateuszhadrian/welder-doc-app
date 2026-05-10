import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for `[locale]/settings/billing/page.tsx` — US-044.
 *
 * Coverage matrix:
 *   1. Free state — user with zero subscription rows + null paddle_customer_id
 *      renders the free placeholder + Upgrade CTA, NO Portal CTA.
 *   2. Active state — user with a `status='active'` subscription AND a
 *      non-null paddle_customer_id renders the current row, Portal CTA, and
 *      a history list with the older canceled row.
 *   3. Portal CTA gating — same active subscription BUT null
 *      `paddle_customer_id` falls back to Upgrade CTA (gating must require
 *      BOTH conditions per plan §4 / §6.5).
 *
 * Test isolation: dedicated user `e2e-bill@…` created in `beforeAll`. No
 * other spec touches it, so we are immune to cross-file races (same approach
 * as dashboard-list.spec.ts and canvas-load.spec.ts).
 *
 * Plan-driven design notes:
 *   - The `subscriptions_after_iu_refresh_plan` trigger flips
 *     `user_profiles.plan` whenever the table is touched. This is fine for
 *     our seed but means the assert order matters: insert subscription THEN
 *     assert page state, never the reverse.
 *   - The protected-columns trigger normally blocks `paddle_customer_id`
 *     UPDATE from `authenticated`, but the seed runs as `postgres` via psql,
 *     which bypasses it.
 */

const USER_ID = '99999999-bbbb-bbbb-bbbb-999999999999';
const USER_EMAIL = 'e2e-bill@test.local';
const PASSWORD = 'Test123456!';

// Subscription UUIDs deterministic so we can clean up by id between tests
// without nuking other rows that future specs might add.
const SUB_ACTIVE_ID = 'cccccccc-aaaa-aaaa-aaaa-cccccccc0001';
const SUB_CANCELED_ID = 'cccccccc-aaaa-aaaa-aaaa-cccccccc0002';

// Paddle reference strings — fully synthetic. The webhook helper rejects
// anything that doesn't match this prefix shape if signature verification
// fails, but read-only RLS doesn't care, so test-mode `sub_*`/`ctm_*` is fine.
const PADDLE_SUB_ACTIVE = 'sub_e2e_bill_active_001';
const PADDLE_SUB_CANCELED = 'sub_e2e_bill_canceled_002';
const PADDLE_CUSTOMER_ID = 'ctm_e2e_bill_001';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Idempotent setup: creates the dedicated billing user and primes consent +
 * locale so the LocaleGuard / consent re-check in `[locale]/layout.tsx`
 * doesn't bounce the test out of `/settings/billing`.
 *
 * `ON CONFLICT (id) DO NOTHING` is NOT enough here: `auth.users` has TWO
 * unique constraints — the PK on `id` and `users_email_partial_key` on
 * lower(email). A previous test run, manual seed, or earlier USER_ID value
 * can leave a row with our email but a different id; that case skips the
 * id-conflict branch and trips the email constraint instead. The delete
 * below clears either collision before the insert.
 *
 * Cascade safety:
 *   - `public.user_profiles.id` FK → ON DELETE CASCADE (default for the
 *     handle_new_user trigger flow), so the profile row goes too — and is
 *     recreated by the trigger after our INSERT.
 *   - `public.subscriptions.user_id` FK → ON DELETE SET NULL (per
 *     migration `20260507000000_complete_schema.sql` — billing audit must
 *     survive RODO erasure). `resetBillingState` already wipes our seeded
 *     rows by id, so an orphaned NULL user_id in those rows is harmless.
 *   - `public.consent_log.user_id` FK → ON DELETE CASCADE, also harmless
 *     here (we never assert against consent_log in this spec).
 */
function setupBillingFixtures() {
  const sql = `
    delete from auth.users
     where email = '${USER_EMAIL}' or id = '${USER_ID}';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${USER_ID}', 'authenticated', 'authenticated',
      '${USER_EMAIL}',
      crypt('${PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );

    update public.user_profiles
       set locale = 'pl', current_consent_version = '2026-05-01'
     where id = '${USER_ID}';
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/**
 * Reset the user to a known state. `subscriptions` rows are wiped + re-seeded,
 * THEN `paddle_customer_id` is set last.
 *
 * SQL ordering is load-bearing here: the trigger `sync_paddle_customer` fires
 * AFTER INSERT on subscriptions and copies `paddle_customer_snapshot` into
 * `user_profiles.paddle_customer_id` *if it was NULL*. If we set the customer
 * id BEFORE the insert, the trigger silently overwrites our value with the
 * snapshot — which broke the gating test (active row + null customer id) and
 * mis-set the active-state customer id to the snapshot literal. By ordering
 * the customer-id UPDATE after the inserts, the explicit test value (or NULL)
 * always wins, regardless of what the trigger did.
 *
 * `paddle_customer_snapshot` is set to the desired customer id so the seed
 * mirrors what Paddle actually delivers (snapshot == customer id at create
 * time) — when paddleCustomerId is null we still write a synthetic snapshot
 * (the column is NOT NULL).
 */
function resetBillingState(opts: {
  withActiveSubscription: boolean;
  withCanceledSubscription: boolean;
  paddleCustomerId: string | null;
}) {
  const wipe = `
    delete from public.subscriptions
     where id in ('${SUB_ACTIVE_ID}', '${SUB_CANCELED_ID}');
  `;

  // The snapshot column is NOT NULL, so we always need a value. Use the
  // requested customer id when present; otherwise a synthetic placeholder
  // (immediately overwritten by the trailing UPDATE that sets paddle_customer_id
  // back to NULL on user_profiles — the snapshot stays on the subscription row
  // for billing-audit continuity, which mirrors production behaviour).
  const snapshot = opts.paddleCustomerId ?? 'ctm_synthetic_for_test';

  const inserts: string[] = [];
  if (opts.withActiveSubscription) {
    inserts.push(`(
      '${SUB_ACTIVE_ID}', '${USER_ID}', '${PADDLE_SUB_ACTIVE}', '${snapshot}',
      'pro_monthly', 'active',
      '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z',
      null, '2026-05-01T00:00:00Z'
    )`);
  }
  if (opts.withCanceledSubscription) {
    inserts.push(`(
      '${SUB_CANCELED_ID}', '${USER_ID}', '${PADDLE_SUB_CANCELED}', '${snapshot}',
      'pro_monthly', 'canceled',
      '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z',
      '2026-04-01T00:00:00Z', '2026-03-01T00:00:00Z'
    )`);
  }

  const seed = inserts.length
    ? `
        insert into public.subscriptions (
          id, user_id, paddle_subscription_id, paddle_customer_snapshot,
          plan_tier, status,
          current_period_start, current_period_end,
          cancel_at, created_at
        ) values
          ${inserts.join(',\n')}
        on conflict (id) do nothing;
      `
    : '';

  // Final UPDATE — overrides whatever the sync_paddle_customer trigger wrote.
  const setCustomerId = `
    update public.user_profiles
       set paddle_customer_id = ${
         opts.paddleCustomerId === null ? 'null' : `'${opts.paddleCustomerId}'`
       }
     where id = '${USER_ID}';
  `;

  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: `${wipe}\n${seed}\n${setCustomerId}`,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USER_EMAIL);
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('Settings → Billing (US-044)', () => {
  // Single-user fixtures (one dedicated `e2e-bill@…` account, mutated per
  // test) race when multiple browser projects run in parallel — chromium-
  // desktop's `resetBillingState` overwrites chromium-mobile's mid-flight,
  // and vice versa. Per CLAUDE.md, `chromium-desktop` is the only mandatory
  // CI project; the others are informational. Skipping there avoids both
  // (a) the parallel-write race on shared rows and (b) the missing-browser
  // failures on dev machines that haven't `playwright install`-ed everything.
  // If multi-project coverage is wanted later, refactor to per-project users
  // (e.g. derive USER_ID/USER_EMAIL from `testInfo.project.name`).
  test.beforeAll(({}, testInfo) => {
    if (testInfo.project.name !== 'chromium-desktop') return;
    setupBillingFixtures();
  });

  test.beforeEach(async ({ context, page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'Billing spec is single-user; runs only on chromium-desktop (CLAUDE.md mandatory project).'
    );
    await context.clearCookies();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[browser console.error] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[browser pageerror] ${err.message}`);
    });
  });

  test('free state: zero subscriptions + null customer id → free placeholder + upgrade CTA', async ({
    page
  }) => {
    resetBillingState({
      withActiveSubscription: false,
      withCanceledSubscription: false,
      paddleCustomerId: null
    });
    await signIn(page);
    await page.goto('/settings/billing');

    await expect(page.getByTestId('billing-free-state')).toBeVisible();
    await expect(page.getByTestId('billing-upgrade-cta')).toBeVisible();
    // Hard negative — the portal CTA must not exist anywhere on the page.
    await expect(page.getByTestId('billing-portal-cta')).toHaveCount(0);
    await expect(page.getByTestId('billing-current')).toHaveCount(0);
  });

  test('active state: active row + customer id → current row + portal CTA + history', async ({
    page
  }) => {
    resetBillingState({
      withActiveSubscription: true,
      withCanceledSubscription: true,
      paddleCustomerId: PADDLE_CUSTOMER_ID
    });
    await signIn(page);
    await page.goto('/settings/billing');

    await expect(page.getByTestId('billing-current')).toBeVisible();
    await expect(page.getByTestId('billing-current-status')).toContainText('Aktywna');
    await expect(page.getByTestId('billing-portal-cta')).toBeVisible();
    // Hard negative — the upgrade CTA must NOT render alongside portal.
    await expect(page.getByTestId('billing-upgrade-cta')).toHaveCount(0);
    await expect(page.getByTestId('billing-free-state')).toHaveCount(0);

    // History list contains the canceled row only (current row is rendered
    // separately at the top, so history.length === total - 1).
    await expect(page.getByTestId('billing-history')).toBeVisible();
    await expect(page.getByTestId('billing-history-row')).toHaveCount(1);
  });

  test('gating: active row but null customer id → upgrade CTA (NOT portal)', async ({ page }) => {
    // Plan §4 / §6.5: portal gating MUST require BOTH the eligible status
    // AND a non-null paddle_customer_id. Drop the customer id and the page
    // must fall back to the upgrade CTA — proves the gate is conjunctive,
    // not disjunctive (a regression here would silently expose the portal
    // button to a user whose Paddle profile we cannot identify).
    resetBillingState({
      withActiveSubscription: true,
      withCanceledSubscription: false,
      paddleCustomerId: null
    });
    await signIn(page);
    await page.goto('/settings/billing');

    await expect(page.getByTestId('billing-current')).toBeVisible();
    await expect(page.getByTestId('billing-upgrade-cta')).toBeVisible();
    await expect(page.getByTestId('billing-portal-cta')).toHaveCount(0);
  });
});
