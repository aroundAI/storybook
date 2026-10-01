import { type Page, expect, test } from '@playwright/test';

import { countClickHouse } from '../utils/clickhouse';
import {
  connectThroughSandbox,
  failNext,
  lastLedgerId,
  ledgerFor,
  sandboxRun,
  servedTotals,
  storedConnections,
} from '../utils/sandbox';
import {
  type SyncedVideo,
  publishedVideo,
  runSync,
  syncMeta,
} from '../utils/sandbox-sync';
import {
  type SeededTeam,
  seedProject,
  seedTeamAccount,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1804 §2 "Sync to dashboard" and §4's two regression flows: a channel
 * connected through the sandbox's consent screen, a video on it, the app's
 * own analytics sync (the cron route production calls), and the episode's
 * analytics page — whose figures must be exactly what the sandbox's ledger
 * says it served for that video. Nothing here writes a figure in advance:
 * the sandbox's data is random per run.
 *
 * The video is one the app already holds (a publish row with the vendor's
 * id), which the sandbox adopts on first sight (FILM-1802 §4); publishing
 * itself is `sandbox-publish.spec.ts`'s subject.
 *
 * Reads ClickHouse, so it runs on lane A with an app started with
 * local.env (apps/e2e/README.md, "Sandbox-backed flows").
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

/** The episode page's figures for one platform, as numbers. */
async function breakdownOn(
  page: Page,
  team: SeededTeam,
  projectSlug: string,
  video: SyncedVideo,
  platform: string,
) {
  await page.goto(
    `/home/${team.slug}/studio/${projectSlug}/episodes/${video.episodeSlug}/analytics`,
  );
  const row = page.locator(
    `[data-test="platform-breakdown-row"][data-platform="${platform}"]`,
  );
  await expect(row).toBeVisible({ timeout: 30_000 });

  const read = async (id: string) =>
    Number((await byTest(row, id).innerText()).replace(/[^\d]/g, ''));

  return {
    views: await read('platform-views'),
    likes: await read('platform-likes'),
    comments: await read('platform-comments'),
    shares: await read('platform-shares'),
  };
}

test.describe('Sync to dashboard, against the sandbox (FILM-1804)', () => {
  sandboxRun();
  test.describe.configure({ timeout: 240_000 });

  test('TikTok: the sync records success, not the success envelope as an error, and the page shows what TikTok served (#279)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-sync-tiktok' });
    await signInAs(page, team);
    await connectThroughSandbox(page, team.slug, 'tiktok');
    const [connection] = await storedConnections(team.accountId, 'tiktok');
    const project = await seedProject(team);
    const video = await publishedVideo(
      project.id,
      connection!.id,
      'tiktok',
      'The Night Market Pop-Up',
    );

    const since = await lastLedgerId();
    await runSync(page);

    // #279: TikTok's success envelope carries `error: {code: "ok"}`. Read as
    // a failure, the sync records `failed` with an empty error and stores
    // nothing; read right, it records success.
    const meta = await syncMeta(video.publishId);
    expect(meta.last_error ?? null).toBeNull();
    expect(meta.last_sync_status).toBe('success');

    // What TikTok served for this video, read off the ledger.
    const served = await servedTotals('tiktok', video.videoId, since);

    // ...is exactly what the page shows.
    const shown = await breakdownOn(page, team, project.slug, video, 'tiktok');
    expect(shown).toEqual({
      views: served.views,
      likes: served.likes,
      comments: served.comments,
      shares: served.shares,
    });
    if (shoot)
      await page.screenshot({
        path: `${OUT}/sync-1-tiktok-episode.png`,
        fullPage: true,
      });

    // Zero against absent (FILM-1711, migration 014): TikTok's Display API
    // reports no saves and no watch time, so the stored row holds NULL for
    // both — not a 0 that would read as "nobody saved it".
    const row = `video_id = '${video.publishId}'`;
    expect(await countClickHouse('video_metrics FINAL', row)).toBeGreaterThan(
      0,
    );
    expect(
      await countClickHouse(
        'video_metrics FINAL',
        `${row} AND (saves IS NOT NULL OR watch_time_seconds IS NOT NULL)`,
      ),
    ).toBe(0);

    // Every TikTok call about the video succeeded.
    expect(
      (await ledgerFor(video.videoId, since)).map((entry) => entry.status),
    ).not.toContain(400);
  });

  test('Instagram: a Reel stores the shares Meta served, and no media-insights call asks for a breakdown (#278)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-sync-ig' });
    await signInAs(page, team);
    await connectThroughSandbox(page, team.slug, 'facebook');
    const [instagram] = await storedConnections(team.accountId, 'instagram');
    const project = await seedProject(team);
    const reel = await publishedVideo(
      project.id,
      instagram!.id,
      'instagram',
      'Behind the Counter at Harbor Lights',
    );

    const since = await lastLedgerId();
    await runSync(page);

    const meta = await syncMeta(reel.publishId);
    expect(meta.last_error ?? null).toBeNull();
    expect(meta.last_sync_status).toBe('success');

    const calls = await ledgerFor(reel.videoId, since);
    const insights = calls.filter((entry) => entry.path.endsWith('/insights'));
    expect(insights.length).toBeGreaterThan(0);
    // #278's second half: `follow_type` is account-level only, and Meta
    // answers a media-insights breakdown with an error (FILM-1802 §3).
    for (const call of insights) {
      expect(call.query ?? '').not.toContain('breakdown=');
      expect(call.status).toBe(200);
    }

    // #278: a Reel is `media_type: VIDEO`; `shares` was asked for only when
    // `media_type` was REELS, which Meta never sends — so it was never asked.
    const served = await servedTotals('instagram', reel.videoId, since);
    expect(
      served,
      'the app asked Meta for no `shares` on this Reel',
    ).toHaveProperty('shares');

    const shown = await breakdownOn(
      page,
      team,
      project.slug,
      reel,
      'instagram',
    );
    expect(shown).toEqual({
      views: served.views,
      likes: served.likes,
      comments: served.comments,
      shares: served.shares,
    });
    if (shoot)
      await page.screenshot({
        path: `${OUT}/sync-2-instagram-reel.png`,
        fullPage: true,
      });
  });

  test('TikTok rate-limits the sync: the publish records it, and the next sync recovers (what the creator sees: sandbox-sync-failure.spec.ts, KB-150)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-sync-429' });
    await signInAs(page, team);
    await connectThroughSandbox(page, team.slug, 'tiktok');
    const [connection] = await storedConnections(team.accountId, 'tiktok');
    const project = await seedProject(team);
    const video = await publishedVideo(
      project.id,
      connection!.id,
      'tiktok',
      'Last Orders at the Lantern',
    );

    // The sync asks about every due publish on the stack at once, so the
    // refusal covers more calls than this video's, and what is left of it
    // is drained before TikTok is meant to answer again.
    await failNext({
      vendor: 'tiktok',
      status: 429,
      pathIncludes: '/v2/video/query/',
      count: 25,
    });
    await runSync(page);
    for (let i = 0; i < 25; i++) {
      const drain = await fetch('http://127.0.0.1:4102/v2/video/query/', {
        method: 'POST',
      });
      if (drain.status !== 429) break;
    }
    const refused = await syncMeta(video.publishId);
    expect(refused.last_sync_status).toBe('rate_limited');
    expect(refused.last_error).toBeTruthy();

    // The second sync, once TikTok answers again. The schedule waits after
    // a failure, so the attempt is made due again, as time would.
    await updateRows('publishes', `id=eq.${video.publishId}`, {
      metadata: { sync: { ...refused, last_synced_at: null } },
    });
    const since = await lastLedgerId();
    await runSync(page);
    const recovered = await syncMeta(video.publishId);
    expect(recovered.last_sync_status).toBe('success');
    const served = await servedTotals('tiktok', video.videoId, since);
    const shown = await breakdownOn(page, team, project.slug, video, 'tiktok');
    expect(shown.views).toBe(served.views);
  });
});
