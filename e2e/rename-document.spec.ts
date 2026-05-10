import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for inline document rename (US-013).
 *
 * Coverage matrix (happy paths only per plan §9 step 9):
 *   1. Rename → exit edit mode → refresh — verifies persistence end-to-end.
 *   2. Client preflight — whitespace-only name shows inline error without
 *      issuing a PATCH (mirrors the unit-test guard but at the integration
 *      layer; catches regressions where the form bypasses the trim check).
 *   3. Cancel — exits edit mode without persisting.
 *
 * Test isolation: dedicated user (`e2e-rename@test.local`, UUID 99999999-…).
 * Users 1–8 are claimed by other specs (login uses 1–4, account-delete uses 5,
 * canvas-load uses 6, dashboard-list uses 7 + 8). Per-test `beforeEach` resets
 * the document name to a known initial value so tests are order-independent.
 */

const RENAME_USER_ID = '99999999-9999-9999-9999-999999999999';
const RENAME_USER_EMAIL = 'e2e-rename@test.local';
const RENAME_USER_PASSWORD = 'Test123456!';

const DOC_ID = 'cccccccc-dddd-dddd-dddd-cccccccc0013';
const INITIAL_NAME = 'Projekt do zmiany nazwy';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DOC_BLOB = JSON.stringify({
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
});

/**
 * Idempotent fixture setup. The `handle_new_user` trigger auto-creates the
 * `user_profiles` row on auth insert; we then update its `locale` and
 * `current_consent_version` to satisfy the LocaleGuard + consent gates in
 * [locale]/layout.tsx. SQL is piped via stdin (not `-c "..."`) because the
 * JSONB literal contains double quotes that would clash with shell quoting.
 *
 * `pg_advisory_xact_lock(7777013)` serialises concurrent runs of this
 * function from different Playwright workers (chromium-mobile / firefox-desktop
 * etc. — CI only runs chromium-desktop, but local multi-project runs would
 * otherwise race on `auth.users` insertion against the partial unique email
 * index). The lock auto-releases at transaction end; the magic number is
 * arbitrary but stable per-fixture.
 */
function setupRenameFixtures() {
  const sql = `
    begin;
    select pg_advisory_xact_lock(7777013);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    )
    select
      '00000000-0000-0000-0000-000000000000',
      '${RENAME_USER_ID}',
      'authenticated', 'authenticated',
      '${RENAME_USER_EMAIL}',
      crypt('${RENAME_USER_PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb
    where not exists (select 1 from auth.users where id = '${RENAME_USER_ID}');

    update public.user_profiles
       set locale = 'pl', current_consent_version = '2026-05-01'
     where id = '${RENAME_USER_ID}';

    insert into public.documents (id, owner_id, name, data)
    select '${DOC_ID}', '${RENAME_USER_ID}', '${INITIAL_NAME}', '${DOC_BLOB}'::jsonb
    where not exists (select 1 from public.documents where id = '${DOC_ID}');

    commit;
  `;
  execSync(`psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function resetDocumentName() {
  execSync(
    `psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1 -c "update public.documents set name='${INITIAL_NAME}' where id='${DOC_ID}';"`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

async function signInAsRenameUser(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(RENAME_USER_EMAIL);
  await page.getByLabel('Hasło').fill(RENAME_USER_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('Document rename (US-013)', () => {
  test.beforeAll(() => {
    setupRenameFixtures();
  });

  test.beforeEach(async ({ context, page }) => {
    resetDocumentName();
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

  test('happy path: rename a document, refresh, verify persistence', async ({ page }) => {
    const newName = `Nowa nazwa ${Date.now()}`;

    await signInAsRenameUser(page);
    await page.goto(`/canvas/${DOC_ID}`);

    // Initial state — the seeded name is the <h1>.
    await expect(page.getByRole('heading', { name: INITIAL_NAME })).toBeVisible();

    // Enter edit mode.
    await page.getByRole('button', { name: 'Zmień nazwę' }).click();

    // Input auto-focuses with the current value preloaded.
    const input = page.getByLabel('Nazwa projektu');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(INITIAL_NAME);

    await input.fill(newName);
    await page.getByRole('button', { name: 'Zapisz' }).click();

    // After PATCH success: edit mode exits, h1 shows the optimistic new name.
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();
    await expect(page.getByLabel('Nazwa projektu')).not.toBeVisible();

    // Persistence — refresh and confirm the server returned the same name.
    // router.refresh() already fires on success but a hard reload is the
    // assertion the plan actually asks for (US-013 step "refresh, verify").
    await page.reload();
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();
  });

  test('client preflight: whitespace-only name surfaces inline error without PATCHing', async ({
    page
  }) => {
    await signInAsRenameUser(page);
    await page.goto(`/canvas/${DOC_ID}`);

    await page.getByRole('button', { name: 'Zmień nazwę' }).click();

    const input = page.getByLabel('Nazwa projektu');
    await input.fill('    ');
    await page.getByRole('button', { name: 'Zapisz' }).click();

    // Inline alert from RenameDocumentForm. errors.document_name_invalid in pl.json
    // resolves to "Nazwa projektu jest nieprawidłowa." — match a stable
    // substring so future copy edits don't break the test. Scope by the
    // form-specific id (`#rename-error`) because Next.js' route announcer
    // ships another `role="alert"` element on the page.
    await expect(page.locator('#rename-error')).toContainText('nieprawidłowa');

    // Still in edit mode — the input is rendered, h1 still shows the seeded name.
    await expect(input).toBeVisible();

    // No PATCH fired → original name persists on reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: INITIAL_NAME })).toBeVisible();
  });

  test('cancel: typed draft is discarded, original name retained, edit mode exits', async ({
    page
  }) => {
    await signInAsRenameUser(page);
    await page.goto(`/canvas/${DOC_ID}`);

    await page.getByRole('button', { name: 'Zmień nazwę' }).click();
    await page.getByLabel('Nazwa projektu').fill('Edycja w toku — niezapisane');
    await page.getByRole('button', { name: 'Anuluj' }).click();

    // Back to view mode with the original name.
    await expect(page.getByRole('heading', { name: INITIAL_NAME })).toBeVisible();
    await expect(page.getByLabel('Nazwa projektu')).not.toBeVisible();

    // And the server-side name was not touched.
    await page.reload();
    await expect(page.getByRole('heading', { name: INITIAL_NAME })).toBeVisible();
  });
});
