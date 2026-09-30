import { expect, test } from '@playwright/test';

import { seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-901. The studio sidebar marks the page you are on. Characters and
 * Locations are one page with two tabs (`assets?tab=`), and the pathname has
 * no query string, so they were tested for the words "character" and
 * "location" in the path and never lit. The link for the tab in view now
 * carries `aria-current="page"`, and no other link does.
 */
test.describe('Studio sidebar: the current page', () => {
  test('lights the link for the tab in view, and only that one', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sidebar' });
    const project = await seedProject(team);
    const base = `/home/${team.slug}/studio/${project.slug}`;

    await signInAs(page, team);

    const current = () =>
      page.locator('[data-test^="studio-nav-"][aria-current="page"]');

    await page.goto(`${base}/assets?tab=character`);
    await expect(current()).toHaveCount(1);
    await expect(byTest(page, 'studio-nav-characters')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goto(`${base}/assets?tab=location`);
    await expect(current()).toHaveCount(1);
    await expect(byTest(page, 'studio-nav-locations')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The second look is the one that matters: from the location tab, go to
    // the character tab and the lit link must move with it. (By address, not
    // by clicking the link: a client-side navigation stalls about one time in
    // six on this route, which is KB-117 and not this test's subject.)
    await page.goto(`${base}/assets?tab=character`);
    await expect(byTest(page, 'studio-nav-characters')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(byTest(page, 'studio-nav-locations')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // With no tab in the address the page shows Characters, and so does the sidebar.
    await page.goto(`${base}/assets`);
    await expect(byTest(page, 'studio-nav-characters')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('lights the section you are in and not the overview', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sidebar' });
    const project = await seedProject(team);
    const base = `/home/${team.slug}/studio/${project.slug}`;

    await signInAs(page, team);

    await page.goto(`${base}/episodes`);
    await expect(byTest(page, 'studio-nav-episodes')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(byTest(page, 'studio-nav-overview')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goto(base);
    await expect(byTest(page, 'studio-nav-overview')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(byTest(page, 'studio-nav-episodes')).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
