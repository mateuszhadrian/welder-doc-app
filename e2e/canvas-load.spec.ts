import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for /[locale]/canvas/[id] (US-009 document load).
 *
 * Coverage matrix:
 *   1. Happy path — owner loads their own document, page renders metadata.
 *   2. Not-found UUID — random UUID returns 404.
 *   3. Cross-tenant RLS leak — owner-A's UUID returns identical 404 to owner-B.
 *      This is the most important assertion: PostgREST `PGRST116` covers BOTH
 *      "row does not exist" and "RLS rejected", and the page must not leak
 *      which one happened.
 *   4. Invalid UUID — `not-a-uuid` returns 404 without a DB round-trip
 *      (handled by `isUuid()` preflight; see src/lib/uuid.ts).
 *   5. Anonymous redirect — guest visit redirects to /login?next=...
 *
 * Test isolation: this spec uses a **dedicated user** (`e2e-canvas-load@test.local`,
 * UUID `66666666-...`) created in `beforeAll`. No other spec touches this user,
 * so we are immune to cross-file races with:
 *   - `documents-create.spec.ts` (wipes documents for users 1–4 per-test)
 *   - `auth/sign-out.spec.ts` (wipes documents for users 1–4 in beforeAll)
 *   - `auth/account-delete.spec.ts` (deletes + recreates user 5)
 *   - `locale-switch.spec.ts` (flips user 1's locale mid-test)
 * Earlier attempts at sharing the canonical e2e users 1/2 caused flakes when
 * Playwright ran specs across workers in parallel.
 */

const CANVAS_USER_ID = '66666666-6666-6666-6666-666666666666';
const CANVAS_USER_EMAIL = 'e2e-canvas-load@test.local';
const CANVAS_USER_PASSWORD = 'Test123456!';

const OWN_DOC_ID = 'aaaaaaaa-cccc-cccc-cccc-aaaaaaaaaaa1';
// Cross-tenant doc ID belongs to e2e-pl-ok (user 1). Even if `documents-create`
// wipes user 1's docs concurrently, this assertion still holds: missing-row and
// RLS-rejected both surface as PostgREST PGRST116 → identical 404. The unit
// test in `documents.test.ts` covers the strict RLS-vs-not-found distinction.
const CROSS_TENANT_DOC_ID = 'bbbbbbbb-cccc-cccc-cccc-bbbbbbbbbbb2';
const CROSS_TENANT_OWNER_ID = '11111111-1111-1111-1111-111111111111';

const RANDOM_UNKNOWN_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const CANVAS_DOC_BLOB = JSON.stringify({
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
});

/**
 * Idempotent setup: creates the dedicated canvas-load user + their owned doc +
 * a cross-tenant doc owned by user 1. Re-runnable safely thanks to
 * `ON CONFLICT DO NOTHING`. SQL is piped via stdin instead of `-c "..."` because
 * the JSONB literal contains double quotes that would clash with shell quoting.
 *
 * The `handle_new_user` trigger auto-creates the `user_profiles` row on auth
 * insert; we then update its `locale` and `current_consent_version` to satisfy
 * the LocaleGuard + consent gates in [locale]/layout.tsx.
 */
function setupCanvasFixtures() {
  const sql = `
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${CANVAS_USER_ID}',
      'authenticated', 'authenticated',
      '${CANVAS_USER_EMAIL}',
      crypt('${CANVAS_USER_PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb
    ) on conflict (id) do nothing;

    update public.user_profiles
       set locale = 'pl', current_consent_version = '2026-05-01'
     where id = '${CANVAS_USER_ID}';

    insert into public.documents (id, owner_id, name, data) values
      ('${OWN_DOC_ID}', '${CANVAS_USER_ID}', 'PL projekt testowy', '${CANVAS_DOC_BLOB}'::jsonb),
      ('${CROSS_TENANT_DOC_ID}', '${CROSS_TENANT_OWNER_ID}', 'Cross-tenant test doc', '${CANVAS_DOC_BLOB}'::jsonb)
    on conflict (id) do nothing;
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

async function signInAsCanvasUser(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(CANVAS_USER_EMAIL);
  await page.getByLabel('Hasło').fill(CANVAS_USER_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('Canvas page load (US-009)', () => {
  test.beforeAll(() => {
    setupCanvasFixtures();
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

  test('happy path: owner loads their own document', async ({ page }) => {
    await signInAsCanvasUser(page);
    await page.goto(`/canvas/${OWN_DOC_ID}`);

    // Document name renders as <h1>; this proves getDocument() returned the row
    // AND the page hydrated server-side without redirecting.
    await expect(page.getByRole('heading', { name: 'PL projekt testowy' })).toBeVisible();
    // Editor placeholder is part of the loaded shell — sanity-check it rendered.
    await expect(page.getByText('Edytor canvas w przygotowaniu')).toBeVisible();
    await expect(page).toHaveURL(`/canvas/${OWN_DOC_ID}`);
  });

  test('non-existent UUID: returns 404 (no row leak)', async ({ page }) => {
    await signInAsCanvasUser(page);
    const response = await page.goto(`/canvas/${RANDOM_UNKNOWN_UUID}`);

    expect(response?.status()).toBe(404);
  });

  test('cross-tenant RLS: other user’s UUID returns identical 404', async ({ page }) => {
    await signInAsCanvasUser(page);
    // CROSS_TENANT_DOC_ID was seeded for user 1, not us. RLS rejects the
    // SELECT and PostgREST surfaces PGRST116, mapped to DOCUMENT_NOT_FOUND.
    // The status code MUST match the not-found case — any difference (e.g.
    // 403) would leak existence.
    const response = await page.goto(`/canvas/${CROSS_TENANT_DOC_ID}`);

    expect(response?.status()).toBe(404);
  });

  test('invalid UUID syntax: returns 404 (preflight, no DB round-trip)', async ({ page }) => {
    await signInAsCanvasUser(page);
    const response = await page.goto('/canvas/not-a-uuid');

    expect(response?.status()).toBe(404);
  });

  test('anonymous user: redirects to /login?next=', async ({ page }) => {
    // No sign-in.
    await page.goto(`/canvas/${OWN_DOC_ID}`);

    // After redirect, URL is /login?next=%2Fcanvas%2F<uuid>.
    await page.waitForURL((url) => url.pathname === '/login');
    expect(page.url()).toContain(`next=${encodeURIComponent(`/canvas/${OWN_DOC_ID}`)}`);
  });
});
