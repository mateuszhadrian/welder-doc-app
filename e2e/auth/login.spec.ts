import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const PL_PASSWORD = 'Test123456!';

const E2E_USER_IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
];

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test.describe('Login flow', () => {
  test.beforeAll(() => {
    // Drop documents created by earlier runs so the free-plan project-limit
    // trigger doesn't make this suite non-idempotent (US-007 guest migration
    // would otherwise hit `project_limit_exceeded` on the 2nd run).
    const ids = E2E_USER_IDS.map((id) => `'${id}'`).join(',');
    execSync(
      `psql "${LOCAL_DB_URL}" -c "delete from public.documents where owner_id in (${ids});"`,
      { stdio: 'pipe' }
    );
  });

  test.beforeEach(async ({ context, page }) => {
    // Czyść cookies między testami — supabase session cookie persisting
    // would mask redirect tests.
    await context.clearCookies();
    // Surface page console errors in the test runner output so failed
    // assertions can be traced back to the actual JS / network failure.
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[browser console.error] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[browser pageerror] ${err.message}`);
    });
  });

  test('happy path: PL user → home (default locale, no prefix)', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();
  });

  test('invalid_credentials renders mapped i18n message', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill('WrongPassword!');
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    // Use text-based assertion — `getByRole('alert')` would also match
    // Next.js's hidden `__next-route-announcer__` element.
    await expect(page.getByText('Nieprawidłowy email lub hasło.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('locale mismatch: EN user signing in on /pl/login → /en', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('e2e-en-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    await page.waitForURL((url) => url.pathname.startsWith('/en'));
    expect(page.url()).toContain('/en');
  });

  test('consent missing → /consent-required', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('e2e-no-consent@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    await page.waitForURL((url) => url.pathname === '/consent-required');
    await expect(page.getByRole('heading', { name: 'Zaktualizuj swoje zgody' })).toBeVisible();
  });

  test('guest migration: localStorage.welderdoc_autosave → toast.success', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      const scene = {
        schemaVersion: 1,
        canvasWidth: 800,
        canvasHeight: 600,
        shapes: [],
        weldUnits: []
      };
      window.localStorage.setItem(
        'welderdoc_autosave',
        JSON.stringify({ schemaVersion: 1, scene })
      );
    });

    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    await page.waitForURL((url) => url.pathname === '/');

    const autosave = await page.evaluate(() => window.localStorage.getItem('welderdoc_autosave'));
    const sentinel = await page.evaluate(() =>
      window.localStorage.getItem('welderdoc_migrated_at')
    );
    expect(autosave).toBeNull();
    expect(sentinel).not.toBeNull();
  });
});
