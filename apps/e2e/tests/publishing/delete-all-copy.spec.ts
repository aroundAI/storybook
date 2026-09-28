import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  insertRow,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-119. The "Delete All" dialog said videos already on platforms "will need
 * to be deleted manually". Confirming it queues a platform delete for every
 * publish, and the publish worker removes the video on YouTube and Facebook.
 * The dialog now says what happens, per platform.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-119-${name}.png` });
}

test('the Delete All dialog says the videos are deleted on YouTube and Facebook', async ({
  page,
}) => {
  const team = await seedTeamAccount({ emailPrefix: 'kb119' });
  const project = await seedProject(team);
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);
  const connectionId = await seedYouTubeConnection(
    team.accountId,
    'KB-119 channel',
    { platformAccountId: `UC-kb119-${randomUUID()}` },
  );

  await insertRow(
    'publishes',
    {
      episode_id: episodeId,
      platform_connection_id: connectionId,
      platform: 'youtube',
      status: 'published',
      title: 'KB-119 video',
      platform_content_id: 'kb119-video',
      published_at: new Date().toISOString(),
    },
    serviceRoleAuth(),
  );

  await signInAs(page, team);
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  );

  await page.getByTitle('Clear All').click();

  const copy = byTest(page, 'publish-delete-all-copy');

  await expect(copy).toContainText(
    "This deletes this episode's videos on YouTube and Facebook",
  );
  await expect(copy).toContainText(
    'Videos on TikTok, Instagram, X and LinkedIn stay up',
  );
  await expect(copy).not.toContainText('deleted manually');

  await capture(page, 'delete-all-dialog');
});
