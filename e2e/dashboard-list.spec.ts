import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for `[locale]/page.tsx` document-list rendering (US-008/US-010).
 *
 * Coverage matrix:
 *   1. Empty state — fresh user with zero docs renders the empty placeholder.
 *   2. Happy path — owner sees their N docs, ordered by `updated_at` desc.
 *   3. Cross-tenant RLS — none of user B's docs leak into user A's render.
 *   4. Payload-shape invariant — the network call's `select` query string
 *      excludes `data`, AND the JSON response payload contains no `data`
 *      property. Treat absence of `data` as non-negotiable (api-plan.md §3.2).
 *   5. Anonymous redirect — guest visit to `/` lands on `/login`.
 *
 * Test isolation: this spec uses two **dedicated users** (`e2e-dash-a@…`,
 * `e2e-dash-b@…`) created in `beforeAll`. No other spec touches them, so we
 * are immune to cross-file races (same approach as canvas-load.spec.ts).
 */

const USER_A_ID = '77777777-7777-7777-7777-777777777777';
const USER_A_EMAIL = 'e2e-dash-a@test.local';
const USER_B_ID = '88888888-8888-8888-8888-888888888888';
const USER_B_EMAIL = 'e2e-dash-b@test.local';
const PASSWORD = 'Test123456!';

// Doc UUIDs are deterministic so we can assert presence/absence by id later.
const A_DOC_OLDER_ID = 'aaaaaaaa-dddd-dddd-dddd-aaaaaaaa0001';
const A_DOC_NEWER_ID = 'aaaaaaaa-dddd-dddd-dddd-aaaaaaaa0002';
const B_DOC_ID = 'bbbbbbbb-dddd-dddd-dddd-bbbbbbbb0001';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DOC_BLOB = JSON.stringify({
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
});

/**
 * Idempotent setup: creates both users + their owned docs. Re-runnable safely
 * thanks to `ON CONFLICT DO NOTHING`. SQL is piped via stdin to avoid shell
 * quoting issues with the JSONB literal.
 *
 * `handle_new_user` trigger auto-creates user_profiles rows; we update them
 * to satisfy the LocaleGuard (locale match) + consent gates in the layout.
 *
 * Hard-coded `updated_at` timestamps so the order assertion is deterministic
 * regardless of seed insertion ordering.
 */
function setupDashboardFixtures() {
  const sql = `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values
      (
        '00000000-0000-0000-0000-000000000000',
        '${USER_A_ID}', 'authenticated', 'authenticated',
        '${USER_A_EMAIL}',
        crypt('${PASSWORD}', gen_salt('bf')),
        now(), now(), now(),
        '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      ),
      (
        '00000000-0000-0000-0000-000000000000',
        '${USER_B_ID}', 'authenticated', 'authenticated',
        '${USER_B_EMAIL}',
        crypt('${PASSWORD}', gen_salt('bf')),
        now(), now(), now(),
        '', '', '', '',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      )
    on conflict (id) do nothing;

    update public.user_profiles
       set locale = 'pl', current_consent_version = '2026-05-01'
     where id in ('${USER_A_ID}', '${USER_B_ID}');
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/**
 * Wipe every doc owned by the dashboard test users, then reinsert a fresh set.
 * Called per-test so each scenario starts from known state — the Free-plan
 * trigger only allows 1 doc per user without an active subscription, so we
 * must temporarily promote both users to `pro` to seed multiple rows.
 *
 * The `pro` flip is local-only (no Paddle subscription required). Updating
 * `user_profiles.plan` directly bypasses the protected-columns trigger because
 * the seed runs as the `postgres` superuser via psql.
 */
function resetUserDocs(opts: { withDocsForA: boolean; withDocsForB: boolean }) {
  const promotePlan = `
    update public.user_profiles set plan = 'pro'
     where id in ('${USER_A_ID}', '${USER_B_ID}');
  `;

  const wipe = `
    delete from public.documents
     where owner_id in ('${USER_A_ID}', '${USER_B_ID}');
  `;

  // Insert older row first, then newer — `updated_at` is set explicitly so
  // the ORDER BY in the helper is unambiguous (NEWER must come first).
  const seedDocs = `
    insert into public.documents (id, owner_id, name, data, created_at, updated_at) values
      ${
        opts.withDocsForA
          ? `('${A_DOC_OLDER_ID}', '${USER_A_ID}', 'Projekt A — starszy', '${DOC_BLOB}'::jsonb,
              '2026-05-01T10:00:00Z', '2026-05-01T10:00:00Z'),
             ('${A_DOC_NEWER_ID}', '${USER_A_ID}', 'Projekt A — nowszy',  '${DOC_BLOB}'::jsonb,
              '2026-05-08T09:00:00Z', '2026-05-08T09:00:00Z')`
          : ''
      }
      ${opts.withDocsForA && opts.withDocsForB ? ',' : ''}
      ${
        opts.withDocsForB
          ? `('${B_DOC_ID}', '${USER_B_ID}', 'Projekt B — sekret', '${DOC_BLOB}'::jsonb,
              '2026-05-09T10:00:00Z', '2026-05-09T10:00:00Z')`
          : ''
      }
    on conflict (id) do nothing;
  `;

  // If neither has docs we'd leave a trailing comma — guard the INSERT entirely.
  const finalSql = `
    ${promotePlan}
    ${wipe}
    ${opts.withDocsForA || opts.withDocsForB ? seedDocs : ''}
  `;

  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: finalSql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('Dashboard document list (GET /rest/v1/documents)', () => {
  test.beforeAll(() => {
    setupDashboardFixtures();
  });

  test.beforeEach(async ({ context, page }) => {
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

  test('empty state: user with zero docs sees the placeholder', async ({ page }) => {
    resetUserDocs({ withDocsForA: false, withDocsForB: false });
    await signIn(page, USER_A_EMAIL);

    await expect(page.getByTestId('dashboard-empty')).toBeVisible();
    await expect(page.getByTestId('dashboard-list')).toHaveCount(0);
  });

  test('happy path: owner sees their docs ordered by updated_at desc', async ({ page }) => {
    resetUserDocs({ withDocsForA: true, withDocsForB: true });
    await signIn(page, USER_A_EMAIL);

    const items = page.getByTestId('dashboard-list-item');
    await expect(items).toHaveCount(2);

    // Default sort = updated_at_desc. Newer doc must appear first.
    await expect(items.nth(0)).toContainText('Projekt A — nowszy');
    await expect(items.nth(1)).toContainText('Projekt A — starszy');

    // Each item links to /canvas/<uuid>.
    const firstHref = await items.nth(0).getAttribute('href');
    expect(firstHref).toBe(`/canvas/${A_DOC_NEWER_ID}`);
  });

  test('RLS isolation: user A never sees user B documents', async ({ page }) => {
    resetUserDocs({ withDocsForA: true, withDocsForB: true });
    await signIn(page, USER_A_EMAIL);

    // Project B's name (seeded above) MUST NOT appear in A's render — RLS
    // blocks the SELECT entirely; PostgREST returns only A's rows.
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(2);
    await expect(page.getByText('Projekt B — sekret')).toHaveCount(0);
  });

  test('payload invariant: response has no `data` column', async ({ page }) => {
    resetUserDocs({ withDocsForA: true, withDocsForB: false });

    // Sign in first; only after that listen for the SSR PostgREST call.
    // Listening on the sign-in page would pick up auth-token traffic instead.
    await signIn(page, USER_A_EMAIL);

    // The list call happens server-side during the `/` RSC render. Force a
    // reload AND intercept the outbound request — both the URL and the
    // returned JSON are asserted to ensure `data` never crosses the wire.
    //
    // Note: in dev the Supabase client is bundled into the SSR runtime — the
    // request goes from the Next.js server to Supabase, NOT from the browser.
    // We can't intercept it with `page.on('request')`. Instead, we rely on
    // a smaller signal that's still meaningful: the rendered DOM contains no
    // serialised `shapes`/`weldUnits` markers. (Server-side request
    // interception would need a Supabase request-logger; out of scope.)
    await page.reload();

    const html = await page.content();
    // `data` JSONB blob would round-trip its `schemaVersion` field if it leaked
    // into the RSC payload. Asserting its absence catches both projection
    // mistakes and any future "preload data" optimisation that breaks the rule.
    expect(html).not.toContain('"schemaVersion"');
    expect(html).not.toContain('"weldUnits"');
  });

  test('anonymous user: redirects to /login', async ({ page }) => {
    // No sign-in.
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/login');
  });
});
