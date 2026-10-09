import { expect, test } from '@playwright/test';

import { headerOnlyMp4 } from '../utils/mp4';
import {
  insertRow,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-2202: publish what you have. An episode with no story, screenplay or
 * shots used to show "Publishing Locked" until Visual Studio had produced
 * shots; a finished video made anywhere else could not be published at all.
 *
 * Red against main: the shot-list tab is a locked <div>, and the publish page
 * renders the lock instead of the attach panel.
 */
test.describe('Publish what you have', () => {
  async function bareEpisode() {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const slug = `bare-${uniqueStamp()}`;

    // No story, screenplay, shot list or shots: a title and nothing else
    await insertRow(
      'episodes',
      { project_id: project.id, number: 1, title: 'Finished elsewhere', slug },
      serviceRoleAuth(),
    );

    return {
      team,
      url: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}`,
    };
  }

  test('no stage is locked, whatever came before it', async ({ page }) => {
    const { team, url } = await bareEpisode();

    await signInAs(page, team);
    await page.goto(`${url}/story`);

    for (const tab of ['screenplay', 'shot-list', 'audio', 'publish']) {
      const link = byTest(page, `episode-tab-${tab}`);

      await expect(link).toHaveAttribute('href', /\/episodes\//);
    }

    await expect(byTest(page, 'episode-tab-screenplay')).toHaveAttribute(
      'data-stage-state',
      'empty',
    );
  });

  test('an episode with nothing but a title publishes an uploaded video', async ({
    page,
  }) => {
    const { team, url } = await bareEpisode();

    await signInAs(page, team);
    await page.goto(`${url}/publish`);

    await expect(byTest(page, 'attach-video-panel')).toBeVisible();
    await expect(page.getByText('Publishing Locked')).toHaveCount(0);

    await page.locator('[data-test="attach-video-input"]').setInputFiles({
      name: 'finished.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from(
        headerOnlyMp4({ seconds: 4, width: 1920, height: 1080 }),
      ),
    });

    // The publish form replaces the panel once the episode has a video
    await expect(byTest(page, 'publish-all')).toBeVisible();
    await expect(byTest(page, 'attach-video-panel')).toHaveCount(0);

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2202-after-upload.png`,
        fullPage: true,
      });
    }
  });

  test('a link to a video already published counts as something to publish', async ({
    page,
  }) => {
    const { team, url } = await bareEpisode();

    await signInAs(page, team);
    await page.goto(`${url}/publish`);

    await byTest(page, 'link-published-video-url').fill(
      `https://www.youtube.com/watch?v=${uniqueStamp().slice(0, 11)}`,
    );
    await byTest(page, 'link-published-video-submit').click();

    await expect(byTest(page, 'attach-video-panel')).toHaveCount(0);
  });

  test('refuses a bad link inline and keeps the panel', async ({ page }) => {
    const { team, url } = await bareEpisode();

    await signInAs(page, team);
    await page.goto(`${url}/publish`);

    await byTest(page, 'link-published-video-url').fill('not a link');
    await byTest(page, 'link-published-video-submit').click();

    await expect(page.getByText('Please enter a valid URL')).toBeVisible();
    await expect(byTest(page, 'attach-video-panel')).toBeVisible();

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2202-bad-link.png`,
        fullPage: true,
      });
    }
  });
});
