import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoAudience,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * The rolling 90-day and subscribed-share cards, with figures worked out by
 * hand (FILM-1511).
 *
 * One video published 120 days ago, 10 views on each of its days 1..119, so
 * the last row is yesterday. The trailing 90 days to today hold the 89 days
 * daysAgo(89)..daysAgo(1), 89 x 10 = 890 views. The window one window earlier
 * (to daysAgo(90)) holds the rows from daysAgo(119) to daysAgo(90): 30 x 10 =
 * 300. The proxy card reads 300 subscribed and 700 other views: 30%.
 *
 * Skipped unless CAPTURE_EVIDENCE is set, and needs ClickHouse.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1511 — rolling and returning-viewer cards', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('reads the hand-computed figures off both cards', async ({ page }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const { publishId } = await seedPublishedEpisode(project.id, connection, {
      number: 1,
      title: 'Long-running video',
    });
    const video: SeededVideo = {
      videoId: publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title: 'Long-running video',
      publishedAt: daysAgo(120),
    };

    await seedVideoDim(video);
    await seedVideoMetrics(
      video,
      Array.from({ length: 119 }, (_, index) => ({
        ageDays: index + 1,
        views: 10,
      })),
    );
    await seedVideoAudience([
      {
        video,
        rows: [
          { dimension: 'follower_status', key: 'subscribed', views: 300 },
          { dimension: 'follower_status', key: 'not_subscribed', views: 700 },
        ],
      },
    ]);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await byTest(page, 'analytics-tab-deep-dive').click();

    const rolling = byTest(page, 'deep-dive-rolling');
    const returning = byTest(page, 'deep-dive-returning-viewer');

    await expect(rolling.locator('[data-test="card-figure"]')).toHaveText(
      '890',
    );
    await expect(rolling.locator('[data-test="card-sentence"]')).toContainText(
      'against 300',
    );
    await expect(byTest(page, 'rolling-90-chart')).toBeVisible();
    await expect(byTest(page, 'rolling-error')).toHaveCount(0);

    await expect(returning.locator('[data-test="card-figure"]')).toHaveText(
      '30%',
    );
    await expect(
      returning.locator('[data-test="card-sentence"]'),
    ).toContainText('proxy');
    await expect(byTest(page, 'returning-viewer-split')).toContainText('300');
    await expect(byTest(page, 'returning-viewer-split')).toContainText('700');

    await rolling.screenshot({ path: `${OUT}/01-rolling-90.png` });
    await returning.screenshot({
      path: `${OUT}/02-returning-viewer-proxy.png`,
    });

    // eslint-disable-next-line no-console
    console.log(
      'MEASURED_CARDS',
      JSON.stringify({
        rolling: await rolling.innerText(),
        returning: await returning.innerText(),
      }),
    );
  });
});
