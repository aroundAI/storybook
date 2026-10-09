import { expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-2205: a new episode starts from an idea, a script or a finished
 * video; the workspace is a progress rail where a stage can be skipped.
 */
const SCRIPT = `INT. LIGHTHOUSE - NIGHT

Rain on the glass.

MARA
The tide is turning.
`;

test.describe('Start from what you have', () => {
  async function setup() {
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    return {
      team,
      project,
      list: `/home/${team.slug}/studio/${project.slug}/episodes`,
    };
  }

  test('from a script: the screenplay is stored and the episode opens on it', async ({
    page,
  }) => {
    const { team, project, list } = await setup();

    await signInAs(page, team);
    await page.goto(list);

    await page.locator('[data-test="create-episode-trigger"]').click();
    await page.locator('[data-test="create-episode-title"]').fill('The Gate');
    await page.locator('[data-test="start-from-script"]').click();
    await page.locator('[data-test="create-episode-script"]').fill(SCRIPT);
    await page.locator('[data-test="create-episode-submit"]').click();

    await expect(page).toHaveURL(/\/screenplay$/);
    await expect(
      page.locator('[data-test="episode-tab-screenplay"]'),
    ).toHaveAttribute('data-stage-state', 'done');
    await expect(
      page.locator('[data-test="episode-tab-story"]'),
    ).toHaveAttribute('data-stage-state', 'skipped');

    const [row] = await readRows<{
      entry_mode: string;
      skipped_stages: string[];
    }>(
      'episodes',
      `project_id=eq.${project.id}&select=entry_mode,skipped_stages`,
    );
    expect(row).toEqual({
      entry_mode: 'script',
      skipped_stages: ['ideation', 'story'],
    });

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2205-from-script.png`,
        fullPage: true,
      });
    }
  });

  test('from a finished video: the episode opens on Publish, every earlier stage skipped', async ({
    page,
  }) => {
    const { team, list } = await setup();

    await signInAs(page, team);
    await page.goto(list);

    await page.locator('[data-test="create-episode-trigger"]').click();
    await page.locator('[data-test="create-episode-title"]').fill('Finished');
    await page.locator('[data-test="start-from-video"]').click();
    await page.locator('[data-test="create-episode-submit"]').click();

    await expect(page).toHaveURL(/\/publish$/);
    await expect(
      page.locator('[data-test="attach-video-panel"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-test="episode-tab-shot-list"]'),
    ).toHaveAttribute('data-stage-state', 'skipped');
  });

  test('a script that reads as no scenes is refused, and the second try works after reset', async ({
    page,
  }) => {
    const { team, project, list } = await setup();

    await signInAs(page, team);
    await page.goto(list);

    await page.locator('[data-test="create-episode-trigger"]').click();
    await page.locator('[data-test="create-episode-title"]').fill('Empty');
    await page.locator('[data-test="start-from-script"]').click();
    await page.locator('[data-test="create-episode-submit"]').click();

    await expect(
      page.getByText('Paste the script, or choose a file'),
    ).toBeVisible();
    expect(
      await readRows('episodes', `project_id=eq.${project.id}&select=id`),
    ).toHaveLength(0);

    await page.locator('[data-test="create-episode-script"]').fill(SCRIPT);
    await page.locator('[data-test="create-episode-submit"]').click();
    await expect(page).toHaveURL(/\/screenplay$/);
  });

  test('an empty stage can be skipped and un-skipped from the rail', async ({
    page,
  }) => {
    const { team, project } = await setup();
    const slug = `skip-${uniqueStamp()}`;

    await insertRow(
      'episodes',
      { project_id: project.id, number: 1, title: 'Skip me', slug },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/screenplay`,
    );

    const banner = page.locator('[data-test="stage-banner"]');
    await expect(banner).toContainText('Generating it needs a story');

    await page.locator('[data-test="stage-banner-skip"]').click();
    await expect(
      page.locator('[data-test="episode-tab-screenplay"]'),
    ).toHaveAttribute('data-stage-state', 'skipped');

    await page.locator('[data-test="stage-banner-unskip"]').click();
    await expect(
      page.locator('[data-test="episode-tab-screenplay"]'),
    ).toHaveAttribute('data-stage-state', 'empty');
  });
});
