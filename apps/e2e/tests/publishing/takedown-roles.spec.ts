import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  insertRow,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-47. Taking a published video down from its platform is irreversible.
 * Owner decision (2026-09-25): only the project's owners and admins may. The
 * actions and the publish worker refuse everyone else; the Publish screen
 * shows the takedown controls only to those who may use them.
 *
 * Before: every member of the account saw "Delete from platform" and
 * "Clear All", and the actions queued the deletion for any of them.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  // The studio scrolls inside its own pane, so bring the card into view
  await page
    .getByRole('heading', { name: 'Published Content' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/kb-47-${name}.png` });
}

async function seedPublishedEpisode() {
  const team = await seedTeamAccount({ emailPrefix: 'kb47' });
  const project = await seedProject(team);
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);

  const connectionId = await seedYouTubeConnection(
    team.accountId,
    'KB-47 channel',
    {
      platformAccountId: `UC-kb47-${randomUUID()}`,
    },
  );

  await insertRow(
    'publishes',
    {
      episode_id: episodeId,
      platform_connection_id: connectionId,
      platform: 'youtube',
      status: 'published',
      title: 'KB-47 published video',
      platform_content_id: 'kb47-video',
      platform_url: 'https://www.youtube.com/watch?v=kb47-video',
      published_at: new Date().toISOString(),
    },
    serviceRoleAuth(),
  );

  return {
    team,
    project,
    publishUrl: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  };
}

test.describe('who sees the takedown controls (KB-47)', () => {
  test('a project member sees the published video but no way to take it down', async ({
    page,
  }) => {
    const { team, project, publishUrl } = await seedPublishedEpisode();
    const member = await seedUser('kb47-member');

    await seedMembership(member.userId, team.accountId);
    await seedProjectMember(project.id, member.userId, 'member');

    await signInAs(page, member);
    await page.goto(publishUrl);

    await expect(
      page.getByRole('heading', { name: 'Published Content' }),
    ).toBeVisible();
    await expect(byTest(page, 'publish-unpublish')).toHaveCount(0);
    await expect(byTest(page, 'publish-delete-all')).toHaveCount(0);

    await capture(page, 'member-no-takedown');
  });

  test('the project owner sees both takedown controls', async ({ page }) => {
    const { team, publishUrl } = await seedPublishedEpisode();

    await signInAs(page, team);
    await page.goto(publishUrl);

    await expect(
      page.getByRole('heading', { name: 'Published Content' }),
    ).toBeVisible();
    await expect(byTest(page, 'publish-unpublish')).toHaveCount(1);
    await expect(byTest(page, 'publish-delete-all')).toHaveCount(1);

    await capture(page, 'owner-takedown');
  });
});
