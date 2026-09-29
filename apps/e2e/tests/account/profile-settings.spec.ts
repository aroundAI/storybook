import { Page, expect, test } from '@playwright/test';

import { seedTeamAccount, seedUser } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * KB-100. With personal accounts off, as every deploy runs (KB-99), the
 * `(user)` layout sends every personal page to the person's team, and
 * `/home/settings` went with them: nobody could change their password, email,
 * MFA, name or avatar, or delete their account. The user menu had no link.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function captureIfAsked(page: Page, name: string) {
  if (process.env.CAPTURE_EVIDENCE) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
}

function userMenu(page: Page) {
  return byTest(page, 'account-dropdown-trigger');
}

test.describe('Profile settings with team accounts only (KB-100)', () => {
  test('a team member opens Profile settings from the user menu and saves their name twice', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb100' });

    await signInAs(page, team);
    await expect(page).toHaveURL(`/home/${team.slug}`);

    await userMenu(page).click();
    const item = byTest(page, 'account-dropdown-settings');
    await expect(item).toHaveText('Profile settings');
    await captureIfAsked(page, 'kb100-01-user-menu');

    await item.click();
    await page.waitForURL('**/home/settings');
    await expect(byTest(page, 'update-account-name-form')).toBeVisible();

    const nameInput = page.locator(
      '[data-test="update-account-name-form"] input',
    );
    const save = visible(page, '[data-test="update-account-name-form"] button');

    await nameInput.fill('First Name');
    await save.click();
    await expect(byTest(page, 'account-dropdown-display-name')).toHaveText(
      'First Name',
    );

    // The second save is where form state and the DOM part company.
    await nameInput.fill('Second Name');
    await save.click();
    await expect(byTest(page, 'account-dropdown-display-name')).toHaveText(
      'Second Name',
    );
    await captureIfAsked(page, 'kb100-02-after-second-save');

    await page.reload();
    expect(new URL(page.url()).pathname).toBe('/home/settings');
    await expect(nameInput).toHaveValue('Second Name');
  });

  test('the personal pages send a team member to their team, and settings stay put', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb99-routes' });

    await signInAs(page, team);

    for (const path of ['/home', '/home/projects', '/home/billing']) {
      await page.goto(path);
      await page.waitForURL(`**/home/${team.slug}`);
    }

    await page.goto('/home/settings');
    expect(new URL(page.url()).pathname).toBe('/home/settings');
    await expect(byTest(page, 'update-account-name-form')).toBeVisible();
  });

  test('someone with no team is sent to create one, and can still reach their settings', async ({
    page,
  }) => {
    const user = await seedUser('kb99-solo');

    await signInAs(page, user);
    await expect(page).toHaveURL('/home/teams/create');
    await captureIfAsked(page, 'kb99-03-no-team-lands-on-create');

    // The create-team dialog opens on arrival; closing it is the person's
    // first move if they came for something else.
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await userMenu(page).click();
    await byTest(page, 'account-dropdown-settings').click();
    await page.waitForURL('**/home/settings');
    await expect(byTest(page, 'update-account-name-form')).toBeVisible();
  });
});
