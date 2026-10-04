import { expect, test } from '@playwright/test';

import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';

// KB-176: auth-js on the browser client read `error_description` in any page
// URL as a failed login and cleared the session cookie.
test.describe('error_description in a page URL', () => {
  async function authCookie(page: import('@playwright/test').Page) {
    const cookies = await page.context().cookies();

    return cookies.filter((cookie) => /^sb-.*-auth-token/.test(cookie.name));
  }

  test('does not sign a signed-in user out', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb176' });
    const settings = `/home/${team.slug}/settings`;

    await signInAs(page, team);
    expect(await authCookie(page)).not.toHaveLength(0);

    await page.goto(
      `${settings}?error=access_denied&error_description=The+user+denied+the+request`,
    );
    await page.waitForLoadState('networkidle');

    expect(await authCookie(page)).not.toHaveLength(0);

    await page.goto(settings);
    await expect(page).toHaveURL(new RegExp(`${settings}$`));

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${settings}$`));
  });

  test('does not sign a user out on a 404 page either', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb176' });
    const settings = `/home/${team.slug}/settings`;

    await signInAs(page, team);

    await page.goto('/this-page-does-not-exist?error=x&error_description=y');
    await page.waitForLoadState('networkidle');

    expect(await authCookie(page)).not.toHaveLength(0);

    await page.goto(settings);
    await expect(page).toHaveURL(new RegExp(`${settings}$`));
  });

  test('a real auth-callback error still shows its message', async ({
    page,
  }) => {
    await page.goto(
      '/auth/callback?error=access_denied&error_description=User+cancelled+login',
    );

    await expect(page).toHaveURL(/\/auth\/callback\/error/);
    await expect(
      page.locator('[data-test="auth-callback-error"]'),
    ).toBeVisible();
  });
});
