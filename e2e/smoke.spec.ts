import { expect, test } from '@playwright/test';

test('homepage renders the WelderDoc title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();
});
