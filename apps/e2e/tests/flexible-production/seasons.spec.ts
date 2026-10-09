import { expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedProject,
  seedSeason,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-2203: seasons first. A season can be created with only a name and
 * shows while empty; seasons reorder; an episode moves between seasons
 * without being renumbered; deleting a season can keep its episodes.
 *
 * Red against main: groupEpisodesBySeason dropped every season without
 * episodes, and the only season delete deleted its episodes too.
 */
test.describe('Seasons', () => {
  async function seeded(
    options: { seasons?: number; episodeInSeason?: boolean } = {},
  ) {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const seasons = [];

    for (let number = 1; number <= (options.seasons ?? 0); number++) {
      seasons.push((await seedSeason(project.id, number)).seasonId);
    }

    let episodeId: string | null = null;

    if (options.episodeInSeason) {
      const episode = await insertRow<{ id: string }>(
        'episodes',
        {
          project_id: project.id,
          season_id: seasons[0],
          number: 1,
          title: 'Pilot',
          slug: `pilot-${uniqueStamp()}`,
        },
        serviceRoleAuth(),
      );
      episodeId = episode.id;
    }

    return {
      team,
      project,
      seasons,
      episodeId,
      url: `/home/${team.slug}/studio/${project.slug}/episodes`,
    };
  }

  test('a season with only a name shows, empty, with a place to start', async ({
    page,
  }) => {
    const { team, url } = await seeded();

    await signInAs(page, team);
    await page.goto(url);

    await expect(byTest(page, 'zero-start-season')).toBeVisible();
    await byTest(page, 'zero-start-season-button').click();
    await byTest(page, 'create-season-name').fill('Origins');
    await byTest(page, 'create-season-submit').click();

    const section = byTest(page, 'season-section-1');
    await expect(section).toContainText('Origins');
    await expect(byTest(section, 'empty-season-slot')).toBeVisible();

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2203-empty-season.png`,
        fullPage: true,
      });
    }

    // The second submission: the dialog again, after the first landed
    await byTest(page, 'create-season-trigger').click();
    await expect(byTest(page, 'create-season-name')).toHaveValue('');
    await byTest(page, 'create-season-name').fill('Ashes');
    await byTest(page, 'create-season-submit').click();
    await expect(byTest(page, 'season-section-2')).toContainText('Ashes');
  });

  test('a season moves down, and the numbers follow', async ({ page }) => {
    const { team, url, project } = await seeded({ seasons: 2 });

    await signInAs(page, team);
    await page.goto(url);

    await byTest(page, 'season-menu-1').click();
    await byTest(page, 'season-move-down').click();

    await expect
      .poll(async () =>
        (
          await readRows<{ name: string; number: number }>(
            'seasons',
            `project_id=eq.${project.id}&deleted_at=is.null&select=name,number&order=number`,
          )
        ).map((season) => season.name),
      )
      .toEqual(['Season 2', 'Season 1']);
  });

  test('an episode moves to another season and keeps its number', async ({
    page,
  }) => {
    const { team, url, episodeId } = await seeded({
      seasons: 2,
      episodeInSeason: true,
    });

    await signInAs(page, team);
    await page.goto(url);

    await expect(byTest(page, 'episode-label')).toHaveText('S1 · E1');

    await byTest(page, 'episode-actions').click();
    await byTest(page, 'move-to-season-2').click();

    await expect(byTest(page, 'episode-label')).toHaveText('S2 · E1');
    const [row] = await readRows<{ number: number }>(
      'episodes',
      `id=eq.${episodeId}&select=number`,
    );
    expect(row?.number).toBe(1);
  });

  test('deleting a season can keep its episodes, which move to Unsorted', async ({
    page,
  }) => {
    const { team, url, episodeId } = await seeded({
      seasons: 1,
      episodeInSeason: true,
    });

    await signInAs(page, team);
    await page.goto(url);

    await byTest(page, 'season-menu-1').click();
    await byTest(page, 'season-delete-keep-episodes').click();
    await byTest(page, 'season-delete-keep-episodes-confirm').click();

    await expect(byTest(page, 'unsorted-section')).toContainText('Pilot');
    await expect(byTest(page, 'episode-label')).toHaveText('#1');

    const [row] = await readRows<{
      season_id: string | null;
      deleted_at: string | null;
    }>('episodes', `id=eq.${episodeId}&select=season_id,deleted_at`);
    expect(row).toEqual({ season_id: null, deleted_at: null });

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2203-after-delete.png`,
        fullPage: true,
      });
    }
  });
});
