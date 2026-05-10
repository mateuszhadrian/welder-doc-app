import { expect, test } from '@playwright/test';

test('anonymous visit to / redirects to /login', async ({ page }) => {
  // The home page is now the post-login dashboard. Anonymous users must be
  // bounced to /login by the page's auth guard. This smoke check proves the
  // app boots, the layout chain runs, and the guard redirect fires — without
  // depending on any specific dashboard or login copy.
  await page.goto('/');
  await page.waitForURL((url) => url.pathname === '/login');
  await expect(page).toHaveURL(/\/login$/);
});
