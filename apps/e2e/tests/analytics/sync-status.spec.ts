import { type Page, expect, test } from '@playwright/test';

import {
  type SeededTeam,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * KB-150 without the sandbox, so CI runs it: the sync record a failed sync
 * leaves on a publish (`publishes.metadata.sync`, exactly the shape
 * `analytics-sync-cron.ts` writes) is shown on the episode analytics page,
 * and the record a later success writes clears it.
 *
 * Needs no ClickHouse. A failed sync is not "no data": the page has to say
 * so whether or not there are figures to show, which is the state a
 * production server with ClickHouse off is in.
 *
 * The sandbox-backed flow that makes TikTok fail for real is
 * `sandbox-sync-failure.spec.ts`.
 */

const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.stats',
  'video.list',
  'video.upload',
  'video.publish',
];

async function tiktokVideo(team: SeededTeam) {
  const project = await seedProject(team);
  const connectionId = await seedYouTubeConnection(
    team.accountId,
    'Seeded TikTok',
    {
      platform: 'tiktok',
      scopes: TIKTOK_SCOPES,
    },
  );
  const episode = await seedPublishedEpisode(project.id, connectionId, {
    platform: 'tiktok',
  });

  return { projectSlug: project.slug, ...episode };
}

async function setSync(
  publishId: string,
  sync: Record<string, unknown> | null,
) {
  await updateRows('publishes', `id=eq.${publishId}`, {
    platform_content_id: `73${publishId.replace(/\D/g, '').slice(0, 16)}`,
    metadata: sync ? { sync } : {},
  });
}

async function syncRow(
  page: Page,
  team: SeededTeam,
  projectSlug: string,
  episodeSlug: string,
) {
  await page.goto(
    `/home/${team.slug}/studio/${projectSlug}/episodes/${episodeSlug}/analytics`,
  );
  const row = visible(
    page,
    '[data-test="sync-status-row"][data-platform="tiktok"]',
  );
  await expect(row).toBeVisible({ timeout: 30_000 });

  return row;
}

test.describe('Analytics sync status on the episode page (KB-150)', () => {
  test('a rate-limited sync is shown with TikTok’s reason, and a later success clears it', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb150-status' });
    const video = await tiktokVideo(team);
    const lastGood = '2026-09-30T08:15:00.000Z';

    await setSync(video.publishId, {
      last_synced_at: lastGood,
      last_sync_status: 'rate_limited',
      last_error: 'rate_limit_exceeded: Too many requests.',
      consecutive_failures: 1,
      requires_reauth: false,
      last_failed_at: '2026-09-30T09:15:00.000Z',
    });

    await signInAs(page, team);
    const failed = await syncRow(
      page,
      team,
      video.projectSlug,
      video.episodeSlug,
    );
    await expect(failed).toHaveAttribute('data-state', 'failed');
    await expect(byTest(failed, 'sync-status-problem')).toHaveText(
      'TikTok rate-limited the latest sync, so these figures were not refreshed.',
    );
    await expect(byTest(failed, 'sync-status-reason')).toHaveText(
      'Details: rate_limit_exceeded: Too many requests.',
    );
    await expect(byTest(failed, 'sync-status-next')).toHaveText(
      'It is tried again on the next scheduled sync.',
    );
    await expect(byTest(failed, 'sync-status-last-synced')).toHaveAttribute(
      'data-synced-at',
      lastGood,
    );

    // What the sync writes on the next success, over the failure.
    const recoveredAt = '2026-09-30T10:15:00.000Z';
    await setSync(video.publishId, {
      last_synced_at: recoveredAt,
      last_sync_status: 'success',
      consecutive_failures: 0,
      requires_reauth: false,
      last_failed_at: '2026-09-30T09:15:00.000Z',
    });

    const recovered = await syncRow(
      page,
      team,
      video.projectSlug,
      video.episodeSlug,
    );
    await expect(recovered).toHaveAttribute('data-state', 'synced');
    await expect(byTest(recovered, 'sync-status-failure')).toHaveCount(0);
    await expect(byTest(recovered, 'sync-status-last-synced')).toHaveAttribute(
      'data-synced-at',
      recoveredAt,
    );
  });

  test('a video never synced says so, and invents no refresh time', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb150-never' });
    const video = await tiktokVideo(team);
    await setSync(video.publishId, null);

    await signInAs(page, team);
    const row = await syncRow(page, team, video.projectSlug, video.episodeSlug);
    await expect(row).toHaveAttribute('data-state', 'not_synced_yet');
    await expect(byTest(row, 'sync-status-last-synced')).toHaveText(
      'Not synced yet',
    );
    await expect(byTest(row, 'sync-status-last-synced')).not.toHaveAttribute(
      'data-synced-at',
      /.+/,
    );
  });
});
