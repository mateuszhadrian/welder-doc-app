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

test.describe('Sign-out flow (US-003)', () => {
  test.beforeAll(() => {
    // Mirror login.spec.ts hygiene — drop docs from prior runs so the project
    // limit trigger does not poison guest-migration in shared fixtures.
    const ids = E2E_USER_IDS.map((id) => `'${id}'`).join(',');
    execSync(
      `psql "${LOCAL_DB_URL}" -c "delete from public.documents where owner_id in (${ids});"`,
      { stdio: 'pipe' }
    );
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

  test('happy path: signed-in user clicks Wyloguj → redirect home, header reflects signed-out state', async ({
    page,
    context
  }) => {
    // 1. Sign in.
    await page.goto('/login');
    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // After login the header renders SignOutButton (conditional on user).
    await expect(page.getByRole('button', { name: 'Wyloguj' })).toBeVisible();

    // Pre-condition: session cookies present (we don't assert exact bytes,
    // just that *some* sb-* cookie exists so the post-state is meaningful).
    const cookiesBefore = await context.cookies();
    expect(cookiesBefore.some((c) => c.name.startsWith('sb-'))).toBe(true);

    // 2. Sign out via the header button.
    await page.getByRole('button', { name: 'Wyloguj' }).click();

    // 3. Stays on / (default locale, public segment OK without session).
    await page.waitForURL((url) => url.pathname === '/');

    // 4. SignOutButton gone — proves the next server render saw `user=null`,
    //    which means @supabase/ssr cleared cookies on the refresh roundtrip.
    //    This is the user-facing observable; raw cookie-byte assertions are
    //    flaky because httpOnly clearance is driven by the server response,
    //    not by the browser-side signOut().
    await expect(page.getByRole('button', { name: 'Wyloguj' })).toHaveCount(0);
  });

  test('localStorage.welderdoc_autosave survives sign-out (guest mode preservation)', async ({
    page
  }) => {
    // 1. Sign in.
    await page.goto('/login');
    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // 2. Seed an autosave AFTER login (mimics the canvas writing it during a session).
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

    // 3. Sign out.
    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // 4. Autosave key MUST NOT be cleared by sign-out.
    const autosave = await page.evaluate(() => window.localStorage.getItem('welderdoc_autosave'));
    expect(autosave).not.toBeNull();
  });

  test('signed-out session: navigating to protected /account/delete redirects to /login', async ({
    page
  }) => {
    // 1. Sign in then sign out.
    await page.goto('/login');
    await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // 2. Visiting a protected route after sign-out must hit the auth gate.
    await page.goto('/account/delete');
    await page.waitForURL((url) => url.pathname === '/login');
  });
});
