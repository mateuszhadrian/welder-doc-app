import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

const PASSWORD = 'Test123456!';

const PL_USER_ID = '11111111-1111-1111-1111-111111111111';
const EN_USER_ID = '22222222-2222-2222-2222-222222222222';

const E2E_USER_IDS = [
  PL_USER_ID,
  EN_USER_ID,
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
];

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function signInAsPlOk(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e-pl-ok@test.local');
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

async function signInAsEnOk(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('e2e-en-ok@test.local');
  await page.getByLabel('Hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  // EN user → LocaleGuard redirects `/` → `/en` after sign-in.
  await page.waitForURL((url) => url.pathname === '/en');
}

// `serial` because the two tests would otherwise race for `documents` table
// state on the same workers; serial mode keeps the wipe + click sequence
// deterministic. Each test ALSO uses a different user (`e2e-pl-ok` for the
// happy path, `e2e-en-ok` for the limit path) so that parallel sibling specs
// can't poison the run by mutating one user's profile mid-test:
//   - `locale-switch.spec.ts` flips `e2e-pl-ok`'s `user_profiles.locale` to
//     `'en'` inside its test body and only resets in `afterAll`. If that test
//     is mid-flight when our happy path signs in, the LocaleGuard redirects
//     us to `/en` and `waitForURL((url) => url.pathname === '/')` times out.
//   - `e2e-en-ok` is referenced by `login.spec.ts` only for a redirect
//     assertion — its profile is never mutated, so the limit test is safe.
test.describe.serial('Create document (US-008)', () => {
  test.beforeEach(async ({ context, page }) => {
    // Wipe documents per-test (not per-suite) so the Free-plan trigger sees a
    // clean slate. Reset `e2e-pl-ok`'s locale defensively in case
    // `locale-switch.spec.ts` left it on `'en'` from a previous failed run.
    const ids = E2E_USER_IDS.map((id) => `'${id}'`).join(',');
    execSync(
      `psql "${LOCAL_DB_URL}" -c "delete from public.documents where owner_id in (${ids}); update public.user_profiles set locale='pl' where id='${PL_USER_ID}';"`,
      { stdio: 'pipe' }
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

  test('happy path (PL): button creates a document and navigates to /canvas/<id>', async ({
    page
  }) => {
    await signInAsPlOk(page);

    // `exact: true` to avoid colliding with the per-row delete trigger's
    // aria-label ("Usuń projekt {name}"), which substring-matches "Nowy projekt"
    // whenever the user already has a doc with the default name.
    await page.getByRole('button', { name: 'Nowy projekt', exact: true }).click();

    // The canvas route doesn't exist yet (it'll 404 inside the locale layout)
    // — we only care that navigation happened with a UUID, which proves the
    // INSERT succeeded and `data.id` made it back to the client.
    await page.waitForURL(
      /\/canvas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('Free-plan limit (EN): second create surfaces the i18n toast and stays on /en', async ({
    page
  }) => {
    await signInAsEnOk(page);

    // Burn the user's single Free-plan project quota in this test, so the
    // assertion does not depend on state left behind by another test or spec.
    // `exact: true` to avoid colliding with the per-row delete trigger's
    // aria-label ("Delete project {name}"), which substring-matches
    // "New project" once the first doc has been created.
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.waitForURL(
      /\/en\/canvas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Back to home; click again — trigger should fire.
    await page.goto('/en');
    await page.getByRole('button', { name: 'New project', exact: true }).click();

    // The toast text comes from `errors.project_limit_exceeded` — must match
    // the EN message exactly. Sonner renders into a portal at the root, so a
    // text-based query is the most robust way to assert visibility.
    await expect(page.getByText("You've reached the Free plan project limit.")).toBeVisible();
    await expect(page).toHaveURL(/\/en$/);
  });
});
