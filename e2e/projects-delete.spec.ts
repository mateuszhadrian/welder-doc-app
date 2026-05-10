import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for dashboard project delete (US-011, DELETE /rest/v1/documents).
 *
 * Coverage matrix:
 *   1. Happy path — open modal → confirm → row disappears, success toast,
 *      DB confirms only the targeted row was removed.
 *   2. Cancel via "Anuluj" — modal closes, no DELETE fires, both docs intact.
 *   3. Cancel via ESC — same as (2), via keyboard. Verifies the native
 *      <dialog> close behaviour from the Client Component.
 *   4. Session-expired regression — cookies cleared mid-session, click
 *      confirm: helper short-circuits at `auth.getUser()` preflight (NOT at
 *      RLS), so NO DELETE request fires AND no misleading "deleted" toast
 *      renders. Page redirects to /login. Guards the bug where the `anon`
 *      role would otherwise have produced a silent 204 + green toast.
 *
 * Test isolation: a single dedicated user (`e2e-delete-doc@test.local`,
 * UUID eeeeeeee-…). UUIDs 1–9 are claimed by other specs (login/canvas-load/
 * account-delete/dashboard-list/rename — see comments at the top of those
 * files). Pro plan promotion lets us seed two docs (Free-plan trigger caps
 * at one); the seed runs as `postgres` so the protected-columns trigger
 * is bypassed. Each test resets both docs to known state so order does not
 * matter.
 */

const DEL_USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const DEL_USER_EMAIL = 'e2e-delete-doc@test.local';
const DEL_USER_PASSWORD = 'Test123456!';

// Two seed documents per test: the "target" is the one we delete, the
// "keeper" is the one that must remain after the operation. Names are
// distinctive substrings so locators won't collide with text from other
// docs that might land in the same render.
const TARGET_DOC_ID = 'eeeeeeee-aaaa-aaaa-aaaa-eeeeeeee0001';
const TARGET_DOC_NAME = 'Projekt do skasowania — pierwszy';
const KEEPER_DOC_ID = 'eeeeeeee-bbbb-bbbb-bbbb-eeeeeeee0002';
const KEEPER_DOC_NAME = 'Projekt do zachowania — drugi';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DOC_BLOB = JSON.stringify({
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
});

/**
 * Idempotent fixture setup. SQL piped via stdin (not `-c "..."`) because the
 * JSONB literal contains double quotes that would clash with shell quoting.
 *
 * `pg_advisory_xact_lock(7777011)` serialises concurrent runs across workers
 * (auto-released at commit). The magic number is arbitrary but stable
 * per-fixture, distinct from other specs (rename uses 7777013, etc.).
 *
 * User starts on `pro` plan so the per-test `resetDocs()` can seed 2 docs
 * without tripping the Free-plan `check_free_project_limit` trigger.
 */
function setupDeleteFixtures() {
  const sql = `
    begin;
    select pg_advisory_xact_lock(7777011);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    )
    select
      '00000000-0000-0000-0000-000000000000',
      '${DEL_USER_ID}',
      'authenticated', 'authenticated',
      '${DEL_USER_EMAIL}',
      crypt('${DEL_USER_PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb
    where not exists (select 1 from auth.users where id = '${DEL_USER_ID}');

    update public.user_profiles
       set locale = 'pl', current_consent_version = '2026-05-01', plan = 'pro'
     where id = '${DEL_USER_ID}';

    commit;
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/**
 * Wipe the user's documents and re-seed the two-doc fixture. Called per-test
 * so each scenario is independent — important because tests in this spec
 * MUTATE the doc set (unlike e.g. dashboard-list which is read-only).
 */
function resetDocs() {
  const sql = `
    delete from public.documents where owner_id = '${DEL_USER_ID}';

    insert into public.documents (id, owner_id, name, data, created_at, updated_at) values
      ('${TARGET_DOC_ID}', '${DEL_USER_ID}', '${TARGET_DOC_NAME}', '${DOC_BLOB}'::jsonb,
       '2026-05-01T10:00:00Z', '2026-05-08T09:00:00Z'),
      ('${KEEPER_DOC_ID}', '${DEL_USER_ID}', '${KEEPER_DOC_NAME}', '${DOC_BLOB}'::jsonb,
       '2026-05-01T10:00:00Z', '2026-05-01T10:00:00Z')
    on conflict (id) do nothing;
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

/** Count rows still owned by the delete-test user. Used as the strongest
 *  end-to-end assertion: was the DB actually touched? */
function countOwnedDocs(): number {
  const out = execSync(
    `psql "${LOCAL_DB_URL}" -t -A -v ON_ERROR_STOP=1 -c "select count(*) from public.documents where owner_id='${DEL_USER_ID}';"`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
    .toString()
    .trim();
  return Number.parseInt(out, 10);
}

async function signInAsDeleteUser(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEL_USER_EMAIL);
  await page.getByLabel('Hasło').fill(DEL_USER_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

/**
 * Open the confirm modal for the target document and return the scoped LI
 * locator. Each `DocumentListItem` renders its own native `<dialog>` (the
 * dialog is a child of the row's `<li>`), so a global `getByTestId('dashboard-
 * delete-confirm')` would resolve to N elements — one per row — and trip
 * Playwright's strict-mode check even when only one is actually visible.
 * Scoping by row eliminates the ambiguity and is the canonical pattern.
 */
async function openConfirmModalForTarget(page: Page) {
  const targetItem = page.getByRole('listitem').filter({ hasText: TARGET_DOC_NAME });
  await targetItem.getByRole('button', { name: `Usuń projekt ${TARGET_DOC_NAME}` }).click();
  // Confirm button must be visible before we proceed — the native <dialog>
  // is opened imperatively in a useEffect, so it's not synchronous with
  // the click.
  await expect(targetItem.getByTestId('dashboard-delete-confirm')).toBeVisible();
  return targetItem;
}

test.describe.serial('Dashboard project delete (US-011)', () => {
  test.beforeAll(() => {
    setupDeleteFixtures();
  });

  test.beforeEach(async ({ context, page }) => {
    resetDocs();
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

  test('happy path: confirm deletes the row, shows toast, persists server-side', async ({
    page
  }) => {
    await signInAsDeleteUser(page);

    // Pre-condition: both docs visible, DB has 2.
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(2);
    expect(countOwnedDocs()).toBe(2);

    const targetItem = await openConfirmModalForTarget(page);
    await targetItem.getByTestId('dashboard-delete-confirm').click();

    // Success toast — exact PL string from messages/pl.json `dashboard.delete.success`.
    await expect(page.getByText('Projekt usunięty')).toBeVisible();

    // Only the keeper remains, and the target row is gone in the UI.
    // Scope name assertions to dashboard-list-item — each row also renders a
    // (closed) <dialog> containing its name in the confirmation body, so a
    // bare getByText() would resolve to multiple elements and trip Playwright's
    // strict-mode check.
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(1);
    await expect(
      page.getByTestId('dashboard-list-item').filter({ hasText: TARGET_DOC_NAME })
    ).toHaveCount(0);
    await expect(
      page.getByTestId('dashboard-list-item').filter({ hasText: KEEPER_DOC_NAME })
    ).toHaveCount(1);

    // Server-side: row really gone, keeper intact.
    expect(countOwnedDocs()).toBe(1);

    // Reload to confirm persistence beyond router.refresh() invalidation.
    await page.reload();
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(1);
    await expect(
      page.getByTestId('dashboard-list-item').filter({ hasText: KEEPER_DOC_NAME })
    ).toHaveCount(1);
  });

  test('cancel via Anuluj button: modal closes, no DELETE fires, both docs intact', async ({
    page
  }) => {
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/documents')) {
        deleteRequests.push(req.url());
      }
    });

    await signInAsDeleteUser(page);
    const targetItem = await openConfirmModalForTarget(page);

    await targetItem.getByTestId('dashboard-delete-cancel').click();

    // Modal closes — Cancel button no longer visible. (Native <dialog>.close()
    // hides the modal's interactive surface even though the element stays in DOM.)
    await expect(targetItem.getByTestId('dashboard-delete-cancel')).not.toBeVisible();

    // Both docs still on screen + in DB.
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(2);
    expect(countOwnedDocs()).toBe(2);
    expect(deleteRequests).toHaveLength(0);
  });

  test('cancel via ESC: modal closes via keyboard, both docs intact', async ({ page }) => {
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/documents')) {
        deleteRequests.push(req.url());
      }
    });

    await signInAsDeleteUser(page);
    const targetItem = await openConfirmModalForTarget(page);

    await page.keyboard.press('Escape');

    await expect(targetItem.getByTestId('dashboard-delete-cancel')).not.toBeVisible();
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(2);
    expect(countOwnedDocs()).toBe(2);
    expect(deleteRequests).toHaveLength(0);
  });

  test('session-expired regression: cookies cleared mid-session → /login, no DELETE, no success toast', async ({
    page,
    context
  }) => {
    // This guards the bug where, with cleared cookies, the request fell to
    // PostgREST as `anon`, RLS filtered all rows, and the server returned a
    // misleading 204 — the UI then showed "Projekt usunięty" before the
    // middleware redirected to /login. The `auth.getUser()` preflight in
    // `deleteDocument` must short-circuit BEFORE the DELETE ever fires.
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/documents')) {
        deleteRequests.push(req.url());
      }
    });

    await signInAsDeleteUser(page);
    await expect(page.getByTestId('dashboard-list-item')).toHaveCount(2);

    const targetItem = await openConfirmModalForTarget(page);

    // Yank the session AFTER the modal is open — simulates a logout in
    // another tab or a manual cookie wipe between rendering the dashboard
    // and confirming the delete.
    await context.clearCookies();

    await targetItem.getByTestId('dashboard-delete-confirm').click();

    // Middleware re-renders without a session → redirect to /login.
    await page.waitForURL((url) => url.pathname === '/login');

    // Critical assertions for the regression:
    //   - No DELETE request ever crossed the wire. The preflight caught it.
    //   - No success toast rendered. We never entered the `toast.success()`
    //     branch because the helper returned UNAUTHORIZED.
    //   - The DB still has 2 docs.
    expect(deleteRequests).toHaveLength(0);
    await expect(page.getByText('Projekt usunięty')).toHaveCount(0);
    expect(countOwnedDocs()).toBe(2);
  });
});
