import { expect, test } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';
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

  test('every section of the sidebar opens the page it names', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sidebar' });
    const project = await seedProject(team);
    const base = `/home/${team.slug}/studio/${project.slug}`;

    await signInAs(page, team);
    await page.goto(base);

    const sections = [
      { link: 'studio-nav-episodes', path: `${base}/episodes`, search: '' },
      { link: 'studio-nav-narrative-arcs', path: `${base}/canon`, search: '' },
      {
        link: 'studio-nav-characters',
        path: `${base}/assets`,
        search: '?tab=character',
      },
      {
        link: 'studio-nav-locations',
        path: `${base}/assets`,
        search: '?tab=location',
      },
      {
        link: 'studio-nav-audio-library',
        path: `${base}/audio-library`,
        search: '',
      },
      { link: 'studio-nav-research-hub', path: `${base}/research`, search: '' },
      { link: 'studio-nav-analytics', path: `${base}/analytics`, search: '' },
      { link: 'studio-nav-platforms', path: `${base}/platforms`, search: '' },
      {
        link: 'studio-nav-project-settings',
        path: `${base}/settings`,
        search: '',
      },
      { link: 'studio-nav-overview', path: base, search: '' },
    ];

    for (const section of sections) {
      await byTest(page, section.link).click();
      await page.waitForURL(
        (url) => url.pathname === section.path && url.search === section.search,
      );
      await expect(byTest(page, section.link)).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(
        page.locator('[data-test^="studio-nav-"][aria-current="page"]'),
      ).toHaveCount(1);
    }
  });

  test('the Platforms link counts the project’s pending publishes, and hides at none', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sidebar' });
    const project = await seedProject(team);
    const base = `/home/${team.slug}/studio/${project.slug}`;
    const connectionId = await seedYouTubeConnection(team.accountId, 'Acme');
    const { episodeId } = await seedPublishedEpisode(project.id, connectionId);

    await signInAs(page, team);
    await page.goto(base);
    await expect(byTest(page, 'studio-nav-platforms')).toBeVisible();
    await expect(byTest(page, 'studio-nav-platforms-badge')).toHaveCount(0);

    // A published publish is not pending; the other four states are, and a
    // failed one is not.
    for (const status of [
      'draft',
      'scheduled',
      'queued',
      'publishing',
      'failed',
    ]) {
      await insertRow(
        'publishes',
        {
          episode_id: episodeId,
          platform_connection_id: connectionId,
          platform: 'youtube',
          status,
          title: `A ${status} publish`,
        },
        serviceRoleAuth(),
      );
    }

    await page.goto(base);
    await expect(byTest(page, 'studio-nav-platforms-badge')).toHaveText('4');
    await expect(byTest(page, 'studio-nav-platforms')).toHaveAttribute(
      'aria-label',
      'Platforms, 4 pending publishes',
    );

    // Another project's pending publish is not counted here.
    const other = await seedProject(team, { name: 'Other project' });
    const otherEpisode = await seedPublishedEpisode(other.id, connectionId);

    await insertRow(
      'publishes',
      {
        episode_id: otherEpisode.episodeId,
        platform_connection_id: connectionId,
        platform: 'youtube',
        status: 'queued',
        title: 'Elsewhere',
      },
      serviceRoleAuth(),
    );

    await page.goto(base);
    await expect(byTest(page, 'studio-nav-platforms-badge')).toHaveText('4');
  });
});
