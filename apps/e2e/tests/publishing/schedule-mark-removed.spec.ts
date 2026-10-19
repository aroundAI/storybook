import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  addProjectChannels,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * KB-207. A video taken down on its platform is marked removed from the
 * Schedule page, and stops holding its channel's posting rules. A deleted
 * episode's posts are hidden until asked for. Seeded through the API
 * against the real database; nothing reaches a platform.
 */

test.use({
  timezoneId: 'Asia/Kolkata',
  viewport: { width: 1440, height: 1100 },
});

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const HOUR = 3600 * 1000;

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/kb207-${name}.png` });
}

const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

test('marks a published video removed, and shows a deleted episode’s posts only when asked', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const team = await seedTeamAccount({ emailPrefix: 'kb207' });
  const yt = await seedYouTubeConnection(team.accountId, 'Story YT', {
    platformAccountId: `yt-kb207-${team.accountId.slice(0, 8)}`,
  });
  const project = await seedProject(team, { name: 'Removed videos' });
  await addProjectChannels(project.id, [yt]);

  const live = await seedEpisodeWithShot(project.id, { number: 1 });
  const gone = await seedEpisodeWithShot(project.id, { number: 2 });

  const publish = (episodeId: string, title: string, hours: number) =>
    insertRow<{ id: string }>(
      'publishes',
      {
        episode_id: episodeId,
        platform_connection_id: yt,
        platform: 'youtube',
        content_type: 'full',
        status: 'published',
        title,
        published_at: ago(hours),
        platform_url: `https://www.youtube.com/watch?v=${hours}`,
      },
      serviceRoleAuth(),
    );

  const first = await publish(live.episodeId, 'Live episode, first', 48);
  const second = await publish(live.episodeId, 'Live episode, second', 24);
  const ofDeleted = await publish(gone.episodeId, 'Deleted episode', 30);
  await updateRows('episodes', `id=eq.${gone.episodeId}`, {
    deleted_at: new Date().toISOString(),
  });

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/schedule`);
  await expect(byTest(page, 'schedule-table')).toBeVisible({ timeout: 60_000 });

  const rows = byTest(page, 'schedule-row');
  const row = (id: string) =>
    visible(page, `[data-test="schedule-row"][data-publish-id="${id}"]`);

  // The deleted episode's post is hidden, and the page says so
  await expect(rows).toHaveCount(2);
  await expect(row(ofDeleted.id)).toHaveCount(0);
  await expect(byTest(page, 'schedule-hidden-deleted')).toHaveText(
    '(1 hidden)',
  );
  await capture(page, '01-before');

  const markRemoved = async (id: string) => {
    await byTest(row(id), 'schedule-row-remove').click();
    await expect(byTest(page, 'schedule-confirm')).toContainText(
      'Mark this video as removed?',
    );
    const confirm = byTest(page, 'schedule-confirm-action');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(row(id)).toHaveAttribute('data-status', 'deleted', {
      timeout: 15_000,
    });
  };

  // --- Mark the first removed
  await byTest(row(first.id), 'schedule-row-remove').click();
  await capture(page, '02-confirm');
  await byTest(page, 'schedule-confirm-action').click();
  await expect(row(first.id)).toHaveAttribute('data-status', 'deleted', {
    timeout: 15_000,
  });
  await expect(byTest(row(first.id), 'schedule-row-status')).toHaveText(
    'Removed',
  );
  await expect(byTest(row(first.id), 'schedule-row-reason')).toHaveText(
    'Removed: marked as removed in StoryBook',
  );
  await expect(byTest(row(first.id), 'schedule-row-remove')).toHaveCount(0);

  // The other published row is untouched, and can be marked in turn
  await expect(row(second.id)).toHaveAttribute('data-status', 'published');
  await markRemoved(second.id);
  await capture(page, '03-after-two-marked');

  const stored = await readRows<{
    id: string;
    status: string;
    metadata: { removedReason?: string; removedAt?: string };
  }>(
    'publishes',
    `id=in.(${first.id},${second.id},${ofDeleted.id})&select=id,status,metadata&order=id`,
  );
  const byId = new Map(stored.map((r) => [r.id, r]));
  for (const id of [first.id, second.id]) {
    expect(byId.get(id)).toMatchObject({
      status: 'deleted',
      metadata: {
        removedReason: 'marked as removed in StoryBook',
        removedAt: expect.any(String),
      },
    });
  }
  expect(byId.get(ofDeleted.id)!.status).toBe('published');

  // --- Show the deleted episode's posts
  await byTest(page, 'schedule-show-deleted').click();
  await page.waitForURL(/[?&]deleted=1/);
  await expect(rows).toHaveCount(3);
  await expect(
    byTest(row(ofDeleted.id), 'schedule-row-episode-deleted'),
  ).toHaveText('Deleted');
  await capture(page, '04-deleted-episodes-shown');
});
