import { expect, test } from '@playwright/test';

import { insertClickHouse } from '../utils/clickhouse';
import { readRows, seedRunningExperiment } from '../utils/seed';
import { ExperimentsPageObject } from './experiments.po';

/**
 * Screenshots for the FILM-1610 PR.
 *
 * Not a guard — `experiments.spec.ts` holds those. The states worth seeing
 * are the ones after an action: the form after its *second* save, and a
 * started experiment whose watched metric has no data yet.
 *
 * Skipped unless CAPTURE_EVIDENCE is set, so CI pays nothing for it.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Experiment log — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the experiment log states', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();

    const overdue = new Date();
    overdue.setUTCDate(overdue.getUTCDate() - 75);
    await seedRunningExperiment(team.accountId, {
      title: 'Faces on thumbnails (seeded, overdue)',
      startedAt: overdue.toISOString().slice(0, 10),
      reviewWindowDays: 60,
    });
    await log.goTo(team.slug);

    // First experiment, fully filled, before saving.
    await log.field('experiment-title').fill('Shorter cold open');
    await log.field('experiment-change').fill('Cut the intro from 20s to 5s');
    await log.choose('experiment-category', 'experiment-category-option-hook');
    await log.choose(
      'experiment-metric',
      'experiment-metric-option-avg_view_percentage',
    );
    await log.linkVideo(team.publishIds[0]);
    await log.chooseChannel(team.connectionId);
    await log.field('experiment-review-window').fill('30');

    await page.screenshot({
      path: `${OUT}/01-form-filled.png`,
      fullPage: true,
    });

    await log.submitAndWaitForReset();

    // Second save with different values; then the reset form.
    await log.field('experiment-title').fill('Search-first titles');
    await log
      .field('experiment-change')
      .fill('Lead titles with the search term');
    await log.choose(
      'experiment-category',
      'experiment-category-option-packaging',
    );
    await log.choose(
      'experiment-metric',
      'experiment-metric-option-search_share',
    );
    await log.linkVideo(team.publishIds[1]);
    await log.field('experiment-review-window').fill('14');
    await log.submitAndWaitForReset();

    await page.screenshot({
      path: `${OUT}/02-after-second-save.png`,
      fullPage: true,
    });

    // DOM readings for the PR comment: what the reset form shows.
    const readings = {
      category: await log.field('experiment-category').textContent(),
      metric: await log.field('experiment-metric').textContent(),
      videos: await log.field('video-picker-trigger').textContent(),
      reviewWindow: await log.field('experiment-review-window').inputValue(),
    };
    console.log('RESET_FORM_READINGS', JSON.stringify(readings));

    const saved = await readRows(
      'analytics_experiments',
      `select=title,category,metric_watched,review_window_days,connection_id&account_id=eq.${team.accountId}&order=created_at.asc`,
    );
    console.log('SAVED_ROWS', JSON.stringify(saved));

    // Start the first experiment and open its detail.
    const [first] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}&title=eq.Shorter%20cold%20open`,
    );
    await page
      .locator(`[data-test="experiment-row-${first!.id}"]:visible`)
      .click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(
      page.locator('[data-test="experiment-watched-baseline-unmeasured"]'),
    ).toBeVisible();

    await page.screenshot({
      path: `${OUT}/03-started-watched-unmeasured.png`,
      fullPage: true,
    });

    // Review 4 (G8, G9): the conclusion, typed into its labelled field.
    await page
      .getByLabel('What actually happened?')
      .fill('Average percentage viewed held at 41%');
    await page.screenshot({
      path: `${OUT}/03b-conclude-labelled.png`,
      fullPage: true,
    });

    await page.getByRole('button', { name: 'inconclusive' }).click();
    await expect(page.getByText('Concluded', { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-test="experiment-result-after-days"]'),
    ).toBeVisible();

    await page.screenshot({
      path: `${OUT}/03c-concluded.png`,
      fullPage: true,
    });
  });

  /**
   * A measured value, end to end, against the local ClickHouse
   * (`./scripts/local-env.sh up`). Needs a server started with
   * `deployment/config/local.env` loaded, so it reads ClickHouse too.
   *
   * Two videos with known reach in the baseline window: 1,000 impressions
   * at 10% and 9,000 at 2%. Pooled by impressions that is 280 clicks in
   * 10,000 — 2.8%. A plain mean of the two rates would say 6.0%, so the
   * figure on screen shows which weighting reached the page.
   */
  test('measures the watched metric against real ClickHouse rows', async ({
    page,
  }) => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [first, second] = team.publishIds;

    // Five days ago: inside the 30-day baseline window before today's start.
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 5);
    const metricDate = day.toISOString().slice(0, 10);

    await insertClickHouse('video_reach_daily', [
      {
        project_id: team.projectId,
        video_id: first,
        platform: 'youtube',
        metric_date: metricDate,
        impressions: 1000,
        impressions_ctr: 0.1,
        engaged_views: 0,
      },
      {
        project_id: team.projectId,
        video_id: second,
        platform: 'youtube',
        metric_date: metricDate,
        impressions: 9000,
        impressions_ctr: 0.02,
        engaged_views: 0,
      },
    ]);

    await log.field('experiment-title').fill('Thumbnail faces');
    await log.field('experiment-change').fill('Faces on both thumbnails');
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(first);
    await log.linkVideo(second);
    await log.field('experiment-review-window').fill('30');
    await log.submitAndWaitForReset();

    const [row] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );
    await page
      .locator(`[data-test="experiment-row-${row!.id}"]:visible`)
      .click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const value = page.locator(
      '[data-test="experiment-watched-baseline-value"]',
    );
    await expect(value).toHaveText('2.8%');

    const coverage = await page
      .locator('[data-test="experiment-watched-baseline"]')
      .textContent();
    console.log(
      'MEASURED_BASELINE',
      JSON.stringify({ value: await value.textContent(), coverage }),
    );

    await page.screenshot({
      path: `${OUT}/04-measured-against-clickhouse.png`,
      fullPage: true,
    });

    // Round 5, pass 9: conclude with data in the result window, then check
    // §8 against what was stored and what the page shows — not the code.
    const [started] = await readRows<{ started_at: string }>(
      'analytics_experiments',
      `select=started_at&id=eq.${row!.id}`,
    );
    await insertClickHouse('video_reach_daily', [
      {
        project_id: team.projectId,
        video_id: first,
        platform: 'youtube',
        metric_date: started!.started_at,
        impressions: 4000,
        impressions_ctr: 0.05,
        engaged_views: 0,
      },
    ]);

    await page.getByLabel('What actually happened?').fill('CTR rose to 5%');
    await page.getByRole('button', { name: 'confirmed' }).click();
    await expect(page.getByText('Concluded', { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-test="experiment-watched-result-value"]'),
    ).toHaveText('5.0%');

    const [stored] = await readRows<{
      status: string;
      started_at: string;
      ended_at: string;
      review_due_at: string;
      baseline_metrics: Record<string, unknown> & {
        totals: Record<string, number>;
        watched: Record<string, unknown>;
      };
      result_metrics: Record<string, unknown> & {
        totals: Record<string, number>;
        watched: Record<string, unknown>;
        resultAfterDays: number;
      };
    }>(
      'analytics_experiments',
      `select=status,started_at,ended_at,review_due_at,baseline_metrics,result_metrics&id=eq.${row!.id}`,
    );
    console.log('STORED_SNAPSHOTS', JSON.stringify(stored));

    const addDays = (date: string, days: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const start = stored!.started_at;

    // §8: the totals block is the six fields that shipped before — no more,
    // no fewer. As a set: jsonb stores keys in its own order, so the order
    // the action wrote is not observable here (experiment-snapshot.test.ts
    // pins the object the action writes, byte for byte).
    const TOTALS = [
      'comments',
      'likes',
      'revenueCents',
      'shares',
      'views',
      'watchTimeSeconds',
    ];
    expect(Object.keys(stored!.baseline_metrics.totals).sort()).toEqual(TOTALS);
    expect(Object.keys(stored!.result_metrics.totals).sort()).toEqual(TOTALS);

    // §8: a recognised metric carries a watched value with its unit; the
    // baseline covers the window *before* the start, the result start → end.
    expect(stored!.baseline_metrics.watched).toMatchObject({
      status: 'measured',
      metric: 'ctr',
      unit: 'ratio',
      window: { start: addDays(start, -30), end: addDays(start, -1) },
      coveredVideos: 2,
      totalVideos: 2,
      daysWithData: 1,
      windowDays: 30,
    });
    expect(stored!.baseline_metrics.watched.value).toBeCloseTo(0.028, 6);
    expect(stored!.result_metrics.watched).toMatchObject({
      status: 'measured',
      metric: 'ctr',
      unit: 'ratio',
      window: { start, end: stored!.ended_at },
      coveredVideos: 1,
      totalVideos: 2,
    });
    expect(stored!.result_metrics.watched.value).toBeCloseTo(0.05, 6);

    // §8: the days that elapsed, and the review date from the window.
    expect(stored!.result_metrics.resultAfterDays).toBe(0);
    expect(stored!.review_due_at).toBe(addDays(start, 30));
    expect(stored!.status).toBe('concluded');

    await page.screenshot({
      path: `${OUT}/04b-concluded-against-clickhouse.png`,
      fullPage: true,
    });
  });

  /**
   * Coverage, end to end against the local ClickHouse (FILM-1610 review, C).
   *
   * Two experiments on the same two videos:
   * - subscribers_net over a 30-day baseline where only 3 days have data:
   *   +15 in total, shown as data on 3 of 30 days and 5.0 per day.
   * - views_at_30d where one video's first 30 days closed before the
   *   channel's ingest began: it is left out, so the median is the other
   *   video's 100 views and 1 of 2 videos is covered.
   */
  test('states partial coverage and leaves out pre-ingest windows', async ({
    page,
  }) => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [recent, old] = team.publishIds;

    const daysAgo = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - days);
      return date.toISOString().slice(0, 10);
    };

    const dim = (videoId: string, publishedAt: string) => ({
      video_id: videoId,
      project_id: team.projectId,
      account_id: team.accountId,
      episode_id: '00000000-0000-4000-8000-000000000000',
      connection_id: team.connectionId,
      platform: 'youtube',
      content_type: 'full',
      language: 'en',
      title: videoId,
      published_at: `${publishedAt} 00:00:00`,
      episode_duration_seconds: 600,
      tags: [],
    });

    const metric = (
      videoId: string,
      date: string,
      views: number,
      gained: number,
    ) => ({
      project_id: team.projectId,
      video_id: videoId,
      platform: 'youtube',
      metric_date: date,
      views,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watch_time_seconds: 0,
      revenue_cents: 0,
      subscribers_gained: gained,
      subscribers_lost: 0,
      metric_source: 'analytics_api',
      extra_metrics: '{}',
    });

    // `recent` was published 60 days ago and measured from its first day, so
    // the channel's ingest starts then. `old` was published two years ago:
    // its first 30 days closed long before any metric was ingested.
    await insertClickHouse('video_dim', [
      dim(recent!, daysAgo(60)),
      dim(old!, daysAgo(730)),
    ]);
    await insertClickHouse('video_metrics', [
      metric(recent!, daysAgo(60), 100, 0),
      metric(old!, daysAgo(50), 3, 0),
      // Three days of subscriber data inside the 30-day baseline window.
      metric(recent!, daysAgo(20), 0, 5),
      metric(recent!, daysAgo(10), 0, 5),
      metric(recent!, daysAgo(5), 0, 5),
    ]);

    const readings: Record<string, string | null> = {};

    for (const [title, option] of [
      ['Subscriber push', 'experiment-metric-option-subscribers_net'],
      ['Thirty-day views', 'experiment-metric-option-views_at_30d'],
    ] as const) {
      await log.field('experiment-title').fill(title);
      await log.field('experiment-change').fill('Coverage evidence');
      await log.choose('experiment-metric', option);
      await log.linkVideo(recent!);
      await log.linkVideo(old!);
      await log.field('experiment-review-window').fill('30');
      await log.submitAndWaitForReset();

      const [row] = await readRows<{ id: string }>(
        'analytics_experiments',
        `select=id&account_id=eq.${team.accountId}&title=eq.${encodeURIComponent(title)}`,
      );
      await page
        .locator(`[data-test="experiment-row-${row!.id}"]:visible`)
        .click();
      await page.getByRole('button', { name: 'Start', exact: true }).click();

      const side = page.locator('[data-test="experiment-watched-baseline"]');
      await expect(
        page.locator('[data-test="experiment-watched-baseline-value"]'),
      ).toBeVisible();
      readings[title] = await side.textContent();

      await page.screenshot({
        path: `${OUT}/${title === 'Subscriber push' ? '05-partial-coverage' : '06-predates-ingest-excluded'}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
    }

    console.log('COVERAGE_READINGS', JSON.stringify(readings));

    expect(readings['Subscriber push']).toContain('+15');
    expect(readings['Subscriber push']).toContain('data on 3 of 30 days');
    expect(readings['Subscriber push']).toContain('5.0 per day');
    expect(readings['Thirty-day views']).toContain('100');
    expect(readings['Thirty-day views']).toContain('1 of 2 videos had data');
  });
});
