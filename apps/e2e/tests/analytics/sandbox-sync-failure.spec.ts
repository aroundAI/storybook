import { type Page, expect, test } from '@playwright/test';

import {
  connectThroughSandbox,
  connectionById,
  failNext,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import {
  type SyncedVideo,
  makeDue,
  publishedVideo,
  runSync,
  syncMeta,
} from '../utils/sandbox-sync';
import { type SeededTeam, seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * KB-150: a failed analytics sync is shown where the figures are read.
 *
 * The sync recorded every failure on the publish and nothing read it, so a
 * rate limit, a refused token or a 5xx left a creator's figures frozen with
 * no word of why. Each test here makes TikTok fail the sync the way TikTok
 * fails it (the sandbox's `/__sandbox/fail`, shaped as TikTok's own error
 * envelope), then reads the episode analytics page and the Video Log as the
 * creator would — and then lets a later sync succeed and checks that the
 * failure is gone and the refresh time moved.
 *
 * Reads ClickHouse (the Video Log lists synced videos), so it runs with an
 * app started with local.env (apps/e2e/README.md, "Sandbox-backed flows").
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

interface Scene {
  team: SeededTeam;
  projectSlug: string;
  video: SyncedVideo;
  title: string;
  connectionId: string;
}

/** A connected TikTok channel with one video, synced once successfully. */
async function syncedOnce(page: Page, prefix: string, title: string) {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  await signInAs(page, team);
  await connectThroughSandbox(page, team.slug, 'tiktok');
  const [connection] = await storedConnections(team.accountId, 'tiktok');
  const project = await seedProject(team);
  const video = await publishedVideo(
    project.id,
    connection!.id,
    'tiktok',
    title,
  );

  await runSync(page);
  expect((await syncMeta(video.publishId)).last_sync_status).toBe('success');

  return {
    team,
    projectSlug: project.slug,
    video,
    title,
    connectionId: connection!.id,
  } satisfies Scene;
}

/**
 * The sync, with TikTok answering `status` to every video query. The sync
 * asks about every due publish on the stack at once, so the refusal covers
 * more calls than this video's, and what is left of it is drained before
 * TikTok is meant to answer again.
 */
async function failedSync(page: Page, scene: Scene, status: number) {
  await makeDue(scene.video.publishId);
  await failNext({
    vendor: 'tiktok',
    status,
    pathIncludes: '/v2/video/query/',
    count: 25,
  });
  await runSync(page);
  for (let i = 0; i < 25; i++) {
    const drain = await fetch('http://127.0.0.1:4102/v2/video/query/', {
      method: 'POST',
    });
    if (drain.status !== status) break;
  }

  return syncMeta(scene.video.publishId);
}

async function openEpisodeAnalytics(page: Page, scene: Scene) {
  await page.goto(
    `/home/${scene.team.slug}/studio/${scene.projectSlug}/episodes/${scene.video.episodeSlug}/analytics`,
  );
  const row = visible(
    page,
    '[data-test="sync-status-row"][data-platform="tiktok"]',
  );
  await expect(row).toBeVisible({ timeout: 30_000 });

  return row;
}

async function videoLogRow(page: Page, scene: Scene) {
  await page.goto(
    `/home/${scene.team.slug}/studio/${scene.projectSlug}/analytics`,
  );
  await byTest(page, 'analytics-tab-video-log').click();
  await expect(byTest(page, 'video-log-tab')).toBeVisible();
  const row = byTest(page, 'video-log-row').filter({ hasText: scene.title });
  await expect(row).toBeVisible({ timeout: 30_000 });

  return row;
}

async function shootBothThemes(page: Page, name: string) {
  if (!shoot) return;

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(byTest(page, 'sync-status')).toBeVisible({ timeout: 30_000 });
    // The figures beside it too, not their loading skeleton.
    await expect(byTest(page, 'platform-breakdown-row')).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
  }
}

/** The failure as the episode page and the Video Log say it. */
async function expectFailureShown(
  page: Page,
  scene: Scene,
  failure: {
    shot: string;
    problem: string;
    reason: string;
    next: string | RegExp;
    lastSyncedAt: string;
  },
) {
  const row = await openEpisodeAnalytics(page, scene);
  await expect(row).toHaveAttribute('data-state', 'failed');
  await expect(byTest(row, 'sync-status-problem')).toHaveText(failure.problem);
  await expect(byTest(row, 'sync-status-reason')).toHaveText(
    `Details: ${failure.reason}`,
  );
  await expect(byTest(row, 'sync-status-next')).toHaveText(failure.next);
  // The last good refresh, exactly as recorded — not the failed attempt's time.
  await expect(byTest(row, 'sync-status-last-synced')).toHaveAttribute(
    'data-synced-at',
    failure.lastSyncedAt,
  );
  await shootBothThemes(page, `${failure.shot}-episode`);

  const logRow = await videoLogRow(page, scene);
  const badge = byTest(logRow, 'video-log-sync-problem');
  await expect(badge).toHaveText('Sync failed');
  await expect(badge).toHaveAttribute(
    'aria-label',
    new RegExp(escape(failure.problem)),
  );
  if (shoot)
    await page.screenshot({ path: `${OUT}/${failure.shot}-video-log.png` });
}

/** A later successful sync clears it, and the refresh time moves on. */
async function expectRecovered(page: Page, scene: Scene, shot: string) {
  await makeDue(scene.video.publishId);
  await runSync(page);
  const meta = await syncMeta(scene.video.publishId);
  expect(meta.last_sync_status).toBe('success');

  const row = await openEpisodeAnalytics(page, scene);
  await expect(row).toHaveAttribute('data-state', 'synced');
  await expect(byTest(row, 'sync-status-failure')).toHaveCount(0);
  await expect(byTest(row, 'sync-status-last-synced')).toHaveAttribute(
    'data-synced-at',
    meta.last_synced_at!,
  );
  await shootBothThemes(page, `${shot}-recovered-episode`);

  const logRow = await videoLogRow(page, scene);
  await expect(byTest(logRow, 'video-log-sync-problem')).toHaveCount(0);
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('A failed analytics sync is shown, and cleared by the next one (KB-150)', () => {
  sandboxRun();
  test.describe.configure({ timeout: 300_000 });
  test.use({ viewport: { width: 1440, height: 1100 } });

  test('429: TikTok rate-limits the sync', async ({ page }) => {
    const scene = await syncedOnce(
      page,
      'sbx-kb150-429',
      'Rain on the Night Ferry',
    );

    const refused = await failedSync(page, scene, 429);
    expect(refused.last_sync_status).toBe('rate_limited');

    await expectFailureShown(page, scene, {
      shot: 'kb150-1-rate-limited',
      problem:
        'TikTok rate-limited the latest sync, so these figures were not refreshed.',
      reason: 'rate_limit_exceeded: Too many requests.',
      next: 'It is tried again on the next scheduled sync.',
      lastSyncedAt: refused.last_synced_at!,
    });

    await expectRecovered(page, scene, 'kb150-1-rate-limited');
  });

  test('5xx: TikTok fails with a server error', async ({ page }) => {
    const scene = await syncedOnce(
      page,
      'sbx-kb150-5xx',
      'The Lighthouse Keeper’s Ledger',
    );

    const refused = await failedSync(page, scene, 503);
    expect(refused.last_sync_status).toBe('failed');

    await expectFailureShown(page, scene, {
      shot: 'kb150-2-server-error',
      problem:
        'The latest sync from TikTok failed, so these figures were not refreshed.',
      reason: 'internal_error: The service encountered an unexpected error.',
      next: 'It is tried again on the next scheduled sync.',
      lastSyncedAt: refused.last_synced_at!,
    });

    await expectRecovered(page, scene, 'kb150-2-server-error');
  });

  test('401: TikTok refuses the token, syncing pauses until a reconnect', async ({
    page,
  }) => {
    const scene = await syncedOnce(
      page,
      'sbx-kb150-401',
      'Second Helpings at Marlow’s',
    );

    const refused = await failedSync(page, scene, 401);
    expect(refused.last_sync_status).toBe('scope_error');
    expect(refused.requires_reauth).toBe(true);

    await expectFailureShown(page, scene, {
      shot: 'kb150-3-token-refused',
      problem:
        "TikTok refused the latest sync: it no longer accepts this channel's access.",
      reason:
        'access_token_invalid: The access token is invalid or not found in the request.',
      next: 'Syncing is paused until the TikTok channel is reconnected. Reconnect it in Settings → Platforms.',
      lastSyncedAt: refused.last_synced_at!,
    });

    // Paused is paused: a scheduled sync now leaves it alone.
    await makeDue(scene.video.publishId);
    await runSync(page);
    expect((await syncMeta(scene.video.publishId)).last_failed_at).toBe(
      refused.last_failed_at,
    );

    // The creator reconnects: disconnect, then a fresh grant into the same row.
    await page.goto(`/home/${scene.team.slug}/settings/platforms`);
    const connection = connectionById(page, scene.connectionId);
    await byTest(connection, 'disconnect-connection').click();
    await byTest(page, 'confirm-disconnect').click();
    await expect(connection).toHaveAttribute('data-status', 'disconnected');

    const disconnected = await openEpisodeAnalytics(page, scene);
    await expect(disconnected).toHaveAttribute('data-state', 'disconnected');

    await page.goto(`/home/${scene.team.slug}/settings/platforms`);
    await byTest(
      connectionById(page, scene.connectionId),
      'reconnect-connection',
    ).click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(
      new RegExp(`/home/${scene.team.slug}/settings/platforms`),
    );
    await expect(connectionById(page, scene.connectionId)).toHaveAttribute(
      'data-status',
      'active',
    );

    // Reconnected after the failure: the schedule will try again, and says so.
    const reconnected = await openEpisodeAnalytics(page, scene);
    await expect(byTest(reconnected, 'sync-status-next')).toHaveText(
      'It is tried again on the next scheduled sync.',
    );

    await expectRecovered(page, scene, 'kb150-3-token-refused');
  });
});
