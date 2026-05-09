import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const PL_PASSWORD = 'Test123456!';
const PL_USER_ID = '11111111-1111-1111-1111-111111111111';
const PL_USER_EMAIL = 'e2e-pl-ok@test.local';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function resetUserLocale(userId: string, locale: 'pl' | 'en') {
  // Run as `postgres` (superuser) — bypasses the `block_protected_columns_update`
  // trigger so we can reset state between runs without the wrapper.
  execSync(
    `psql "${LOCAL_DB_URL}" -c "update public.user_profiles set locale='${locale}' where id='${userId}';"`,
    { stdio: 'pipe' }
  );
}

test.describe('Locale switching (US-050)', () => {
  test.beforeAll(() => {
    // Idempotent reset: previous failures may have left the user on `en`.
    resetUserLocale(PL_USER_ID, 'pl');
  });

  test.afterAll(() => {
    // Belt-and-suspenders: leave the seeded state intact for downstream specs.
    resetUserLocale(PL_USER_ID, 'pl');
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

  test('guest mode: switcher on /login persists cookie + URL prefix without DB write', async ({
    page,
    context
  }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();

    await page
      .getByRole('group', { name: 'Język interfejsu' })
      .getByRole('button', { name: 'EN' })
      .click();

    await page.waitForURL((url) => url.pathname === '/en/login');

    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === 'NEXT_LOCALE');
    expect(localeCookie?.value).toBe('en');

    // English copy is now rendered (login form translates the heading).
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('auth: pl→en updates DB locale, sets cookie, redirects to /en', async ({
    page,
    context
  }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill(PL_USER_EMAIL);
    await page.getByLabel('Hasło').fill(PL_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();

    // Default locale `pl` → no URL prefix.
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();

    // Trigger the switcher in the layout header.
    await page
      .getByRole('group', { name: 'Język interfejsu' })
      .getByRole('button', { name: 'EN' })
      .click();

    // The switcher writes the cookie BEFORE router.replace, so the next
    // server render carries `NEXT_LOCALE=en` and the LocaleGuard does not
    // bounce the user (api-plan.md §5).
    await page.waitForURL((url) => url.pathname.startsWith('/en'));

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('en');

    // DB has been persisted: a hard reload to `/` (default-locale URL) would
    // be redirected back to `/en` by the LocaleGuard, which only fires when
    // `user_profiles.locale === 'en'`.
    await page.goto('/');
    await page.waitForURL((url) => url.pathname.startsWith('/en'));
  });
});
