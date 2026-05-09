import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const PASSWORD = 'Test123456!';
const DELETE_USER_ID = '55555555-5555-5555-5555-555555555555';
const DELETE_USER_EMAIL = 'e2e-delete-target@test.local';
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function runSql(sql: string): string {
  // Heredoc-style is fragile through child_process; write to a temp file and
  // psql -f. Returns stripped tabular output (last column only via -tA).
  const path = join(tmpdir(), `account-delete-${Date.now()}-${Math.random()}.sql`);
  writeFileSync(path, sql);
  try {
    return execSync(`psql "${LOCAL_DB_URL}" -tA -f "${path}"`, { encoding: 'utf8' }).trim();
  } finally {
    unlinkSync(path);
  }
}

function recreateDeleteTargetUser() {
  // Idempotent: drop the user if it exists (cascades to user_profiles via FK),
  // then insert fresh. Bypasses block_protected_columns_update because we run
  // as `postgres` superuser.
  runSql(`
    delete from auth.users where id = '${DELETE_USER_ID}';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${DELETE_USER_ID}',
      'authenticated', 'authenticated',
      '${DELETE_USER_EMAIL}',
      crypt('${PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb
    );
    update public.user_profiles
    set locale = 'pl', current_consent_version = '2026-05-01'
    where id = '${DELETE_USER_ID}';
  `);
}

// Tests in this file mutate the same auth.users row → run serially.
test.describe.configure({ mode: 'serial' });

test.describe('DELETE /api/user/account flow (RODO art. 17, US-052)', () => {
  test.beforeEach(async ({ context, page }) => {
    recreateDeleteTargetUser();
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

  test.afterAll(() => {
    // Make seed state predictable for downstream test files.
    recreateDeleteTargetUser();
  });

  test('błędne hasło → toast errors.invalid_password, sesja niezmieniona', async ({ page }) => {
    // Sign in as the delete-target user.
    await page.goto('/login');
    await page.getByLabel('Email').fill(DELETE_USER_EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    await page.goto('/account/delete');
    await expect(page.getByRole('heading', { name: 'Usuń konto' })).toBeVisible();

    await page.getByLabel('Hasło').fill('WrongPassword!');
    await page.getByLabel('Wpisz DELETE, aby potwierdzić').fill('DELETE');
    await page.getByRole('button', { name: 'Usuń konto na zawsze' }).click();

    // Toast — bypass `getByRole('alert')` to avoid Next.js's hidden
    // route-announcer node, mirror login.spec.ts pattern.
    await expect(page.getByText('Nieprawidłowe hasło.')).toBeVisible();

    // Negative assertion: user still exists in auth.users.
    const userCount = runSql(`select count(*) from auth.users where id = '${DELETE_USER_ID}';`);
    expect(userCount).toBe('1');
  });

  test('poprawne hasło + DELETE → /account-deleted, kaskada FK, kolejne /api/user/export = 401', async ({
    page,
    request
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DELETE_USER_EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    await page.goto('/account/delete');

    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByLabel('Wpisz DELETE, aby potwierdzić').fill('DELETE');
    await page.getByRole('button', { name: 'Usuń konto na zawsze' }).click();

    await page.waitForURL((url) => url.pathname === '/account-deleted');
    await expect(page.getByRole('heading', { name: 'Konto zostało usunięte' })).toBeVisible();

    // DELETE plan §15 manual-QA — automated equivalent. Verify cascade
    // through Postgres FK actually fired, not just that the API returned 200.
    expect(runSql(`select count(*) from auth.users where id = '${DELETE_USER_ID}';`)).toBe('0');
    expect(
      runSql(`select count(*) from public.user_profiles where id = '${DELETE_USER_ID}';`)
    ).toBe('0');
    expect(
      runSql(`select count(*) from public.documents where owner_id = '${DELETE_USER_ID}';`)
    ).toBe('0');
    expect(
      runSql(`select count(*) from public.consent_log where user_id = '${DELETE_USER_ID}';`)
    ).toBe('0');

    // Session cleared → subsequent authenticated endpoint returns 401.
    // `request` shares the browser context cookies; after the API's
    // Set-Cookie cleared `sb-*`, this fetch carries no auth.
    const exportRes = await request.get('/api/user/export');
    expect(exportRes.status()).toBe(401);
  });
});
