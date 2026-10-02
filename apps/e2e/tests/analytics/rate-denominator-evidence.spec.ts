import { type Page, expect, test } from '@playwright/test';

import {
  type SeededVideo,
  insertClickHouse,
  seedVideoDim,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Screenshots for the FILM-1732 PR: a rate beside the record of what its
 * views were, on a video whose days fall either side of YouTube's
 * 2026-08-27 change.
 *
 *   | day        | views | likes | comments | shares |
 *   |------------|-------|-------|----------|--------|
 *   | 2026-08-25 | 400   | 20    | 10       | 10     |
 *   | 2026-08-29 | 600   | 30    | 15       | 15     |
 *
 *   Engagement, shares included: 100 / 1000 = 10.0%.
 *   Likes and comments only (the project overview, KB-171): 75 / 1000 = 7.5%.
 *
 * Every record names 27 Aug 2026 as a change inside its window.
 *
 * Skipped unless CAPTURE_EVIDENCE and CLICKHOUSE_EVIDENCE are set: it needs
 * a server reading the local ClickHouse (`./scripts/local-env.sh up`).
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const PUBLISHED_AT = new Date('2026-08-20T00:00:00Z');

async function openRecord(page: Page, scope: ReturnType<typeof byTest>) {
  const trigger = byTest(scope, 'rate-denominator-trigger').first();

  await expect(trigger).toHaveAttribute('data-crosses', 'true');
  await trigger.click();

  const record = byTest(page, 'rate-denominator');

  await expect(record).toBeVisible();
  await expect(record).toContainText('changed what a view is on 27 Aug 2026');

  return record;
}

test.describe('FILM-1732 — rate denominator evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('each rate shows the views it divided by', async ({ page }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const title = 'Across the change';
    const { publishId, episodeSlug } = await seedPublishedEpisode(
      project.id,
      connection,
      { number: 1, title },
    );

    await updateRows('publishes', `id=eq.${publishId}`, {
      published_at: PUBLISHED_AT.toISOString(),
    });

    const video: SeededVideo = {
      videoId: publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title,
      publishedAt: PUBLISHED_AT,
    };

    await seedVideoDim(video);
    await insertClickHouse(
      'video_metrics',
      [
        ['2026-08-25', 400, 20, 10, 10],
        ['2026-08-29', 600, 30, 15, 15],
      ].map(([date, views, likes, comments, shares]) => ({
        project_id: project.id,
        video_id: publishId,
        platform: 'youtube',
        metric_date: date,
        views,
        likes,
        comments,
        shares,
        saves: 0,
        watch_time_seconds: 0,
        subscribers_gained: 0,
        dislikes: 0,
      })),
    );

    await signInAs(page, team);
    const readings: Record<string, unknown> = {};

    // The episode's own page.
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/analytics`,
    );
    const episodeRate = byTest(page, 'episode-engagement-rate');

    await expect(episodeRate).toContainText('10.00%');
    const episodeRecord = await openRecord(page, episodeRate);

    readings.episode = {
      figure: await episodeRate.innerText(),
      record: await episodeRecord.innerText(),
    };
    await page.screenshot({ path: `${OUT}/01-episode-rate-record.png` });
    await page.keyboard.press('Escape');

    // The project overview, which divides likes and comments only.
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);
    const overview = byTest(page, 'overview-engagement-rate');

    // Shown to the whole percent: 7.5% renders as 8%.
    await expect(overview).toContainText('8%');
    const overviewRecord = await openRecord(page, overview);

    readings.overview = {
      figure: await overview.innerText(),
      record: await overviewRecord.innerText(),
    };
    await page.screenshot({ path: `${OUT}/02-overview-rate-record.png` });
    await page.keyboard.press('Escape');

    // A row of the content table.
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    // The default 30 days ends after the video's days: widen to 90.
    await page.getByRole('button', { name: /\d{4} - / }).click();
    await page.getByRole('button', { name: 'Last 90 days' }).click();
    await page.keyboard.press('Escape');
    await byTest(page, 'analytics-tab-content').click();
    await byTest(page, 'content-view-table').click();
    const row = byTest(page, 'content-row');

    await expect(row).toHaveCount(1);
    const rowRecord = await openRecord(page, row);

    readings.contentRow = {
      row: await row.innerText(),
      record: await rowRecord.innerText(),
    };
    // The table and its open record only: the header tiles above are still
    // reloading for the widened range, which says nothing about this row.
    const table = await byTest(page, 'content-table').boundingBox();
    const open = await rowRecord.boundingBox();
    const x = Math.min(table!.x, open!.x);
    const y = Math.min(table!.y, open!.y);

    await page.screenshot({
      path: `${OUT}/03-content-row-record.png`,
      clip: {
        x,
        y,
        width: Math.max(table!.x + table!.width, open!.x + open!.width) - x,
        height: Math.max(table!.y + table!.height, open!.y + open!.height) - y,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      'MEASURED_RATE_DENOMINATORS',
      JSON.stringify(readings, null, 2),
    );
  });
});
