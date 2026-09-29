import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedRetentionCurve,
  seedVideoDim,
  seedVideoMetrics,
  seedVideoReach,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * The published clip's own duration, where a person reads it (FILM-1710).
 *
 * The retention drill-down is the first thing to read an asset duration: it
 * turns the cliff's position into a timestamp. Both videos here are Shorts
 * cut from the same 22-minute episode, with the same curve — a cliff that
 * starts 10% through. They differ only in whether the platform has reported
 * the clip's length:
 *
 *   known, 45s   →  0.10 × 45   = 4.5s  →  "around 0:05"
 *   unknown      →  no timestamp at all
 *   the old bug  →  0.10 × 1320 = 132s  →  "around 2:12", past the end of
 *                   a 45-second clip
 *
 * So the page says which implementation shipped. What the dim sync writes to
 * ClickHouse is a separate question this page cannot answer — the chart reads
 * the duration from Postgres — and `dim-sync.local-stack.test.ts` in
 * `@kit/content-analytics` answers it against the real reconcile.
 *
 * Needs a ClickHouse container and a server that reads it, so it is gated
 * like the other evidence specs: the 🧬 E2E evidence job runs it, ⚫️ Test
 * does not.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const EPISODE_SECONDS = 1320;
const SHORT_SECONDS = 45;

// Holds, then falls 0.90 → 0.45 between 10% and 15% through: inside
// `detectRetentionCliff`'s early window and well past its 0.15 threshold.
const CURVE = [
  { elapsedRatio: 0, audienceWatchRatio: 1 },
  { elapsedRatio: 0.05, audienceWatchRatio: 0.95 },
  { elapsedRatio: 0.1, audienceWatchRatio: 0.9 },
  { elapsedRatio: 0.15, audienceWatchRatio: 0.45 },
  { elapsedRatio: 0.5, audienceWatchRatio: 0.35 },
  { elapsedRatio: 1, audienceWatchRatio: 0.2 },
];

test.describe('FILM-1710 — the clip, not its episode', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 240_000 });

  test('times the cliff against the asset, and says nothing when it cannot', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    const measured = await seedPublishedEpisode(project.id, connection, {
      number: 1,
      title: 'Short with a known length',
      contentType: 'short',
      episodeDurationSeconds: EPISODE_SECONDS,
      assetDurationSeconds: SHORT_SECONDS,
    });

    const unmeasured = await seedPublishedEpisode(project.id, connection, {
      number: 2,
      title: 'Short nobody has measured',
      contentType: 'short',
      episodeDurationSeconds: EPISODE_SECONDS,
    });

    const video = (videoId: string, title: string): SeededVideo => ({
      videoId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title,
      publishedAt: daysAgo(2),
    });

    for (const seeded of [
      video(measured.publishId, 'Short with a known length'),
      video(unmeasured.publishId, 'Short nobody has measured'),
    ]) {
      await seedVideoDim(seeded);
      await seedVideoMetrics(seeded, [{ ageDays: 1, views: 500 }]);
      await seedVideoReach(seeded, [
        { ageDays: 1, impressions: 10_000, ctr: 0.05 },
      ]);
      await seedRetentionCurve(seeded, CURVE);
    }

    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics?tab=deep-dive`,
    );

    await byTest(page, 'analytics-tab-deep-dive').click();

    const rows = byTest(page, 'diagnostic-row');

    await expect(rows).toHaveCount(2);

    const caption = visible(page, '[data-test="retention-drilldown"] p');
    const curve = page.getByRole('img', { name: 'Audience retention curve' });

    // --- The Short whose length the platform reported ---------------------
    await rows.filter({ hasText: 'Short with a known length' }).first().click();
    await expect(curve).toBeVisible();

    // 0.10 × 45s = 4.5s. Against the episode it would read 2:12.
    await expect(caption).toContainText('Sharp drop of 45 points around 0:05');
    await expect(caption).not.toContainText('2:12');

    // eslint-disable-next-line no-console
    console.log('MEASURED_KNOWN', await caption.innerText());

    await page
      .locator('[data-test="weekly-diagnostics-section"]')
      .screenshot({ path: `${OUT}/01-cliff-timed-against-the-clip.png` });

    // --- The same curve, on a Short with no reported length ---------------
    // The second drill-down, not a fresh page: the panel is reused, and a
    // timestamp left over from the first video is the bug worth catching.
    await byTest(page, 'retention-drilldown-close').click();
    await rows.filter({ hasText: 'Short nobody has measured' }).first().click();
    await expect(curve).toBeVisible();

    await expect(caption).toContainText('Sharp drop of 45 points —');
    await expect(caption).not.toContainText('around');

    // eslint-disable-next-line no-console
    console.log('MEASURED_UNKNOWN', await caption.innerText());

    await page
      .locator('[data-test="weekly-diagnostics-section"]')
      .screenshot({ path: `${OUT}/02-duration-unknown-no-timestamp.png` });

    // --- The other surface that draws this chart: the episode page --------
    // It resolves its own publish and calls the same action, so the same
    // two answers must come out of it.
    const episodeRetention = byTest(page, 'episode-retention');
    const episodeUrl = (episodeSlug: string) =>
      `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/analytics`;

    await page.goto(episodeUrl(measured.episodeSlug));
    await expect(episodeRetention.getByRole('img')).toBeVisible();
    await expect(episodeRetention).toContainText(
      'Sharp drop of 45 points around 0:05',
    );

    await episodeRetention.screenshot({
      path: `${OUT}/03-episode-page-known.png`,
    });

    await page.goto(episodeUrl(unmeasured.episodeSlug));
    await expect(episodeRetention.getByRole('img')).toBeVisible();
    await expect(episodeRetention).toContainText('Sharp drop of 45 points —');
    await expect(episodeRetention).not.toContainText('around');

    await episodeRetention.screenshot({
      path: `${OUT}/04-episode-page-unknown.png`,
    });
  });
});
