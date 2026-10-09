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
 * FILM-2206: Make a follow-up on an episode's analytics page opens the new
 * episode dialog on the idea tile, in the same season, with what worked;
 * the new episode stores the frozen snapshot in metadata.follow_up.
 */
test('Make a follow-up starts the next episode from what worked', async ({
  page,
}) => {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id, 1);
  const slug = `gate-${uniqueStamp()}`;

  const source = await insertRow<{ id: string }>(
    'episodes',
    {
      project_id: project.id,
      season_id: seasonId,
      number: 1,
      title: 'The Gate',
      slug,
      story_data: { viralStructure: { openingHook: 'A door opens itself.' } },
    },
    serviceRoleAuth(),
  );

  await signInAs(page, team);
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/analytics`,
  );

  await byTest(page, 'make-follow-up').click();

  await expect(byTest(page, 'create-episode-title')).toHaveValue(
    'Follow-up to The Gate',
  );
  await expect(byTest(page, 'start-from-idea')).toHaveAttribute(
    'data-state',
    'checked',
  );
  await expect(byTest(page, 'create-episode-season')).toContainText('Season 1');
  const card = byTest(page, 'follow-up-card');
  await expect(card).toContainText('From Episode 1, “The Gate”');
  await expect(card).toContainText('Hook: “A door opens itself.”');

  if (process.env.CAPTURE_EVIDENCE) {
    await page.screenshot({
      path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/2206-follow-up-dialog.png`,
      fullPage: true,
    });
  }

  await byTest(page, 'create-episode-submit').click();
  await expect(page).toHaveURL(/\/episodes\/[^/]+$/);

  const rows = await readRows<{
    title: string;
    season_id: string | null;
    metadata: { follow_up?: { episode_id: string } };
  }>(
    'episodes',
    `project_id=eq.${project.id}&number=eq.2&select=title,season_id,metadata`,
  );
  expect(rows).toEqual([
    expect.objectContaining({
      title: 'Follow-up to The Gate',
      season_id: seasonId,
      metadata: expect.objectContaining({
        follow_up: expect.objectContaining({ episode_id: source.id }),
      }),
    }),
  ]);
});
