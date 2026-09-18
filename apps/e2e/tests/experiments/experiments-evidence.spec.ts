import { expect, test } from '@playwright/test';

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

/**
 * Writes rows straight into ClickHouse over HTTP, as
 * `deep-dive/subscriber-evidence.spec.ts` does.
 */
async function insertClickHouse(table: string, rows: object[]) {
  const host = process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123';
  const auth = Buffer.from(
    `${process.env.CLICKHOUSE_USER ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`,
  ).toString('base64');

  const response = await fetch(
    `${host}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: rows.map((row) => JSON.stringify(row)).join('\n'),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ClickHouse insert into ${table} failed: ${await response.text()}`,
    );
  }
}

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
    await page.getByRole('button', { name: 'Start experiment' }).click();
    await expect(
      page.locator('[data-test="experiment-watched-baseline-unmeasured"]'),
    ).toBeVisible();

    await page.screenshot({
      path: `${OUT}/03-started-watched-unmeasured.png`,
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
        project_id: team.accountId,
        video_id: first,
        platform: 'youtube',
        metric_date: metricDate,
        impressions: 1000,
        impressions_ctr: 0.1,
        engaged_views: 0,
      },
      {
        project_id: team.accountId,
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
    await page.getByRole('button', { name: 'Start experiment' }).click();

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
  });
});
