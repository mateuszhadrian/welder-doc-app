import { test, expect } from '@playwright/test';

const PL_SENT_GENERIC =
  'Jeśli email istnieje w naszej bazie, wysłaliśmy link resetujący. Sprawdź również folder Spam.';
const EN_SENT_GENERIC =
  "If this email is registered, we've sent a reset link. Don't forget to check your Spam folder.";
const PL_INVALID_FORMAT = 'Nieprawidłowy format adresu email.';

// Anti-enumeration: a fresh, definitely-nonexistent address. Random per run
// so a previous run's mailbox in Inbucket can't accidentally match.
function randomNonexistentEmail() {
  return `nope-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@test.local`;
}

test.describe('Forgot-password flow (US-004)', () => {
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

  test('PL: anti-enumeration — nieistniejący email pokazuje generic sent message', async ({
    page
  }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Resetuj hasło' })).toBeVisible();

    await page.getByLabel('Adres email').fill(randomNonexistentEmail());
    await page.getByRole('button', { name: 'Wyślij link' }).click();

    // Generic silent-success message — same UI whether the email exists or not.
    await expect(page.getByText(PL_SENT_GENERIC)).toBeVisible();
    // Form is replaced by the success state — submit button no longer present.
    await expect(page.getByRole('button', { name: 'Wyślij link' })).not.toBeVisible();
  });

  test('EN: anti-enumeration — nieistniejący email pokazuje generic sent message po angielsku', async ({
    page
  }) => {
    await page.goto('/en/forgot-password');
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();

    await page.getByLabel('Email').fill(randomNonexistentEmail());
    await page.getByRole('button', { name: 'Send link' }).click();

    await expect(page.getByText(EN_SENT_GENERIC)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send link' })).not.toBeVisible();
  });

  test('preflight: niepoprawny format email blokuje submit, formularz nadal widoczny', async ({
    page
  }) => {
    await page.goto('/forgot-password');

    await page.getByLabel('Adres email').fill('not-an-email');
    await page.getByRole('button', { name: 'Wyślij link' }).click();

    // Inline format error — text-based to avoid Next.js's route-announcer.
    await expect(page.getByText(PL_INVALID_FORMAT)).toBeVisible();
    // Form must still be on screen (no silent-success branch taken).
    await expect(page.getByRole('button', { name: 'Wyślij link' })).toBeVisible();
    await expect(page.getByText(PL_SENT_GENERIC)).not.toBeVisible();
  });

  test('/login renderuje link "Nie pamiętasz hasła?" i prowadzi do /forgot-password', async ({
    page
  }) => {
    await page.goto('/login');

    const link = page.getByRole('link', { name: 'Nie pamiętasz hasła?' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/forgot-password');

    await link.click();
    await page.waitForURL((url) => url.pathname === '/forgot-password');
    await expect(page.getByRole('heading', { name: 'Resetuj hasło' })).toBeVisible();
  });

  test('/en/login renderuje "Forgot your password?" i prowadzi do /en/forgot-password', async ({
    page
  }) => {
    await page.goto('/en/login');

    const link = page.getByRole('link', { name: 'Forgot your password?' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/en/forgot-password');

    await link.click();
    await page.waitForURL((url) => url.pathname === '/en/forgot-password');
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });
});
