import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-175: an episode number is unique per project. The Create Episode dialog
 * takes the project's next number, so back-to-back creates and two creates
 * submitted at the same moment each get their own.
 */
async function seedProjectWithEpisode() {
  const team: SeededTeam = await seedTeamAccount({ emailPrefix: 'kb175' });
  const project = await seedProject(team);

  await insertRow(
    'episodes',
    {
      project_id: project.id,
      number: 1,
      title: 'Pilot',
      slug: `kb175-pilot-${uniqueStamp().slice(0, 8)}`,
    },
    serviceRoleAuth(),
  );

  return {
    team,
    project,
    listUrl: `/home/${team.slug}/studio/${project.slug}/episodes`,
  };
}

async function openCreateDialog(page: Page, listUrl: string, title: string) {
  await page.goto(listUrl);
  await expect(async () => {
    await byTest(page, 'create-episode-trigger').click();
    await expect(byTest(page, 'create-episode-title')).toBeVisible({
      timeout: 3_000,
    });
  }).toPass();
  await byTest(page, 'create-episode-title').fill(title);
}

async function numbersOf(projectId: string) {
  const rows = await readRows<{ number: number }>(
    'episodes',
    `project_id=eq.${projectId}&deleted_at=is.null&select=number&order=number`,
  );

  return rows.map((row) => row.number);
}

test.describe('Episode numbers (KB-175)', () => {
  test('back-to-back creates take the next numbers', async ({ page }) => {
    const { team, project, listUrl } = await seedProjectWithEpisode();

    await signInAs(page, team);

    for (const title of ['Second', 'Third']) {
      await openCreateDialog(page, listUrl, title);
      await byTest(page, 'create-episode-submit').click();
      await expect(page).toHaveURL(/\/episodes\/[^/]+$/);
    }

    expect(await numbersOf(project.id)).toEqual([1, 2, 3]);
  });

  test('two creates submitted at once get distinct numbers', async ({
    browser,
  }) => {
    const { team, project, listUrl } = await seedProjectWithEpisode();

    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    try {
      await signInAs(first, team);

      await openCreateDialog(first, listUrl, 'Race A');
      await openCreateDialog(second, listUrl, 'Race B');

      await Promise.all([
        byTest(first, 'create-episode-submit').click(),
        byTest(second, 'create-episode-submit').click(),
      ]);

      await expect(first).toHaveURL(/\/episodes\/[^/]+$/);
      await expect(second).toHaveURL(/\/episodes\/[^/]+$/);

      // The second submission: the same dialog, again, after both landed
      await openCreateDialog(first, listUrl, 'After the race');
      await byTest(first, 'create-episode-submit').click();
      await expect(first).toHaveURL(/\/episodes\/[^/]+$/);

      expect(await numbersOf(project.id)).toEqual([1, 2, 3, 4]);
    } finally {
      await context.close();
    }
  });
});
