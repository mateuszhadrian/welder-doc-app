import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PASSWORD = 'StrongPass123';

/**
 * Email of a user already present in `supabase/seed.sql` — used as the
 * "duplicate email" fixture. Re-creating it is idempotent (ON CONFLICT DO
 * NOTHING) so tests can rely on its presence.
 */
const SEEDED_EMAIL = 'e2e-pl-ok@test.local';

function runSql(sql: string): string {
  const path = join(tmpdir(), `sign-up-${Date.now()}-${Math.random()}.sql`);
  writeFileSync(path, sql);
  try {
    return execSync(`psql "${LOCAL_DB_URL}" -tA -f "${path}"`, { encoding: 'utf8' }).trim();
  } finally {
    unlinkSync(path);
  }
}

function deleteUserByEmail(email: string) {
  // Cascades through user_profiles + consent_log + documents via FK.
  runSql(`delete from auth.users where email = '${email}';`);
}

test.describe('Sign-up flow (US-001)', () => {
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

  test('preflight: niepoprawny email → inline alert, brak nawigacji', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await expect(page.getByRole('heading', { name: 'Załóż konto' })).toBeVisible();

    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByLabel('Akceptuję Regulamin').check();
    await page.getByLabel('Akceptuję Politykę Prywatności').check();
    await page.getByLabel('Akceptuję politykę cookies').check();
    await page.getByRole('button', { name: 'Załóż konto' }).click();

    await expect(page.getByText('Nieprawidłowy format adresu email.')).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
  });

  test('preflight: hasło 7 znaków → inline alert "minimum 8 znaków"', async ({ page }) => {
    await page.goto('/auth/sign-up');

    await page.getByLabel('Email').fill('ok@test.local');
    await page.getByLabel('Hasło').fill('1234567');
    await page.getByLabel('Akceptuję Regulamin').check();
    await page.getByLabel('Akceptuję Politykę Prywatności').check();
    await page.getByLabel('Akceptuję politykę cookies').check();
    await page.getByRole('button', { name: 'Załóż konto' }).click();

    await expect(page.getByText('Hasło musi mieć minimum 8 znaków.')).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
  });

  test('preflight: brak zaznaczonej zgody → inline alert consent_required', async ({ page }) => {
    await page.goto('/auth/sign-up');

    await page.getByLabel('Email').fill('ok@test.local');
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByLabel('Akceptuję Regulamin').check();
    // Drugiej i trzeciej zgody NIE klikamy.
    await page.getByRole('button', { name: 'Załóż konto' }).click();

    await expect(
      page.getByText('Aby założyć konto, zaakceptuj wszystkie wymagane zgody.')
    ).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
  });

  test('happy path: poprawne dane → redirect /auth/check-email z parametrem ?email', async ({
    page
  }) => {
    // Unikalny email per run, żeby test był idempotentny niezależnie od stanu DB.
    const uniqueEmail = `e2e-signup-${Date.now()}@test.local`;

    try {
      await page.goto('/auth/sign-up');

      await page.getByLabel('Email').fill(uniqueEmail);
      await page.getByLabel('Hasło').fill(PASSWORD);
      await page.getByLabel('Akceptuję Regulamin').check();
      await page.getByLabel('Akceptuję Politykę Prywatności').check();
      await page.getByLabel('Akceptuję politykę cookies').check();
      await page.getByRole('button', { name: 'Załóż konto' }).click();

      await page.waitForURL((url) => url.pathname === '/auth/check-email');
      expect(page.url()).toContain(`email=${encodeURIComponent(uniqueEmail)}`);

      // Strona check-email pokazuje email użytkownika i przycisk resend.
      await expect(page.getByRole('heading', { name: 'Sprawdź swoją skrzynkę' })).toBeVisible();
      await expect(page.getByText(uniqueEmail)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Wyślij link ponownie' })).toBeVisible();

      // Sanity check: user faktycznie jest w auth.users (signUp się powiódł).
      const count = runSql(`select count(*) from auth.users where email = '${uniqueEmail}';`);
      expect(count).toBe('1');
    } finally {
      // Sprzątanie: usuń utworzonego usera, by kolejne runy były czyste.
      deleteUserByEmail(uniqueEmail);
    }
  });

  test('duplicate email: existing user → alert email_already_registered + link "Zaloguj się"', async ({
    page
  }) => {
    await page.goto('/auth/sign-up');

    await page.getByLabel('Email').fill(SEEDED_EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByLabel('Akceptuję Regulamin').check();
    await page.getByLabel('Akceptuję Politykę Prywatności').check();
    await page.getByLabel('Akceptuję politykę cookies').check();
    await page.getByRole('button', { name: 'Załóż konto' }).click();

    await expect(page.getByText('Ten email jest już zarejestrowany.')).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);

    // CTA "Zaloguj się" wewnątrz alertu prowadzi do /login. Stały link u dołu
    // formularza ma tę samą treść — wybieramy ten wewnątrz role=alert.
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute(
      'href',
      '/login'
    );
  });

  test('locale EN: /en/auth/sign-up renderuje formularz po angielsku', async ({ page }) => {
    await page.goto('/en/auth/sign-up');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });
});
