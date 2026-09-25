import { expect, test } from '@playwright/test';

import { insertClickHouse } from '../utils/clickhouse';
import {
  insertRow,
  readRows,
  seedExperiment,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { ExperimentsPageObject } from './experiments.po';

/**
 * Screenshots for the KB-7 / KB-8 / KB-93 PR, and KB-8 measured end to end.
 *
 * Not the guards — `experiments-manage.spec.ts` holds those. These are the
 * states after each action, and the one figure only a real ClickHouse can
 * produce: the baseline window measured again at conclusion, once the days
 * that had not arrived at the start have.
 *
 * Skipped unless CAPTURE_EVIDENCE is set; the ClickHouse half also needs
 * CLICKHOUSE_EVIDENCE and a server reading the local ClickHouse.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

test.describe('Change log management — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures edit, abandon, delete, filter and tags', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const tag = await insertRow<{ id: string }>(
      'content_tags',
      {
        account_id: team.accountId,
        dimension: 'thumbnail_style',
        slug: `face-${uniqueStamp()}`,
        label: 'Face close-up',
      },
      serviceRoleAuth(),
    );

    // The page read the tag vocabulary before the tag existed.
    await page.reload();
    await expect(log.field('video-picker-trigger')).toBeVisible();

    // Logged with a tag through the page.
    await log.field('experiment-title').fill('Faces on thumbnails');
    await log.field('experiment-change').fill('A face instead of text');
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(team.publishIds[0]);
    await log.linkTag(tag.id);
    await log.submitAndWaitForReset();

    const [logged] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );
    const planned = logged!.id;

    await log.edit(planned);
    await log.editField('experiment-title').fill('Faces on thumbnails, v2');
    await page.screenshot({
      path: `${OUT}/01-edit-planned.png`,
      fullPage: true,
    });
    await log.saveEdit();
    await page.screenshot({
      path: `${OUT}/02-after-edit-detail-with-tag.png`,
      fullPage: true,
    });
    await log.closeDialog();

    // A started change: what its baseline measured is locked.
    const running = await seedExperiment(team.accountId, {
      title: 'New titles',
      status: 'running',
      startedAt: daysAgo(4),
      metricWatched: 'search_share',
    });
    await page.reload();
    await log.edit(running);
    await page.screenshot({
      path: `${OUT}/03-edit-running-locked.png`,
      fullPage: true,
    });
    await log.editField('experiment-edit-cancel').click();

    // Abandon, with a reason.
    await log.dialogButton('experiment-abandon').click();
    await page
      .locator('[data-test="experiment-abandon-reason"]')
      .fill('Channel paused for a month');
    await page.screenshot({ path: `${OUT}/04-abandon-dialog.png` });
    await page.locator('[data-test="experiment-abandon-confirm"]').click();
    await expect(
      page.locator('[data-test="experiment-abandon-dialog"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[role="dialog"]').getByText('abandoned', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/05-after-abandon.png` });
    await log.closeDialog();

    // Delete, confirmed.
    await log.open(planned);
    await log.dialogButton('experiment-delete').click();
    await page.screenshot({ path: `${OUT}/06-delete-dialog.png` });
    await page.locator('[data-test="experiment-delete-cancel"]').click();

    // Delete refused: the change was started in another tab meanwhile.
    await log.dialogButton('experiment-delete').click();
    await updateRows('analytics_experiments', `id=eq.${planned}`, {
      status: 'running',
      started_at: daysAgo(0),
    });
    await page.locator('[data-test="experiment-delete-confirm"]').click();
    await expect(
      page.locator('[data-test="experiment-confirm-error"]'),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/07-delete-refused.png` });
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[data-test="experiment-delete-dialog"]'),
    ).toHaveCount(0);
    // The dialog re-read the change: it is running now, with no Delete.
    await expect(
      page.locator('[role="dialog"]').getByText('running', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/07b-after-refusal-reread.png` });
    await log.closeDialog();

    // Filter.
    await page.locator('[data-test="experiment-status-filter"]').click();
    await page
      .locator('[data-test="experiment-status-option-abandoned"]')
      .click();
    await expect(page).toHaveURL(/status=abandoned/);
    await page.screenshot({
      path: `${OUT}/08-filter-abandoned.png`,
      fullPage: true,
    });
    await page.locator('[data-test="experiment-status-filter"]').click();
    await page
      .locator('[data-test="experiment-status-option-concluded"]')
      .click();
    await expect(
      page.locator('[data-test="experiment-list-filtered-empty"]'),
    ).toBeVisible();
    await page.screenshot({
      path: `${OUT}/09-filter-empty.png`,
      fullPage: true,
    });
  });

  /**
   * KB-8 against the local ClickHouse. One linked video, CTR over a 30-day
   * baseline window. At the start, two days hold data:
   *   day −10: 1,000 impressions at 10%  → 100 clicks
   *   day −9:  1,000 impressions at 2%   →  20 clicks
   *   baseline at start = 120 / 2,000 = 6.0%, data on 2 of 30 days
   * Then day −2 "arrives": 2,000 impressions at 3% → 60 clicks
   *   re-measured at conclusion = 180 / 4,000 = 4.5%, data on 3 of 30 days
   * Result, the start day: 1,000 at 5% → 5.0%.
   */
  test('measures the baseline again at conclusion, against real ClickHouse rows', async ({
    page,
  }) => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [video] = team.publishIds;
    const reach = (metricDate: string, impressions: number, ctr: number) => ({
      project_id: team.projectId,
      video_id: video,
      platform: 'youtube',
      metric_date: metricDate,
      impressions,
      impressions_ctr: ctr,
    });

    await insertClickHouse('video_reach_daily', [
      reach(daysAgo(10), 1000, 0.1),
      reach(daysAgo(9), 1000, 0.02),
    ]);

    await log.field('experiment-title').fill('Late days');
    await log.field('experiment-change').fill('New thumbnail');
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(video);
    await log.field('experiment-review-window').fill('30');
    await log.submitAndWaitForReset();

    const [row] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );
    await log.open(row!.id);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(
      page.locator('[data-test="experiment-watched-baseline-value"]'),
    ).toHaveText('6.0%');

    const [started] = await readRows<{ started_at: string }>(
      'analytics_experiments',
      `select=started_at&id=eq.${row!.id}`,
    );

    // The late day arrives, and the start day's result.
    await insertClickHouse('video_reach_daily', [
      reach(daysAgo(2), 2000, 0.03),
      reach(started!.started_at, 1000, 0.05),
    ]);

    await page.getByLabel('What actually happened?').fill('CTR fell to 5%');
    await page.getByRole('button', { name: 'inconclusive' }).click();
    await expect(
      page.locator('[data-test="experiment-watched-baseline-remeasured"]'),
    ).toBeVisible();

    const atStart = page.locator('[data-test="experiment-watched-baseline"]');
    const again = page.locator(
      '[data-test="experiment-watched-baseline-remeasured"]',
    );
    await expect(
      page.locator('[data-test="experiment-watched-baseline-value"]'),
    ).toHaveText('6.0%');
    await expect(atStart).toContainText('data on 2 of 30 days');
    await expect(
      page.locator(
        '[data-test="experiment-watched-baseline-remeasured-value"]',
      ),
    ).toHaveText('4.5%');
    await expect(again).toContainText('data on 3 of 30 days');
    await expect(
      page.locator('[data-test="experiment-watched-result-value"]'),
    ).toHaveText('5.0%');

    const [stored] = await readRows<{
      baseline_metrics: { watched: Record<string, unknown> };
      result_metrics: { baselineRemeasured: Record<string, unknown> };
    }>(
      'analytics_experiments',
      `select=baseline_metrics,result_metrics&id=eq.${row!.id}`,
    );
    console.log(
      'KB8_MEASURED',
      JSON.stringify({
        atStart: await atStart.textContent(),
        remeasured: await again.textContent(),
        stored: {
          baseline: stored!.baseline_metrics.watched,
          remeasured: stored!.result_metrics.baselineRemeasured,
        },
      }),
    );
    // The start's baseline is untouched by the conclusion.
    expect(stored!.baseline_metrics.watched).toMatchObject({
      daysWithData: 2,
      windowDays: 30,
    });
    expect(stored!.baseline_metrics.watched.value).toBeCloseTo(0.06, 6);
    expect(stored!.result_metrics.baselineRemeasured).toMatchObject({
      status: 'measured',
      metric: 'ctr',
      daysWithData: 3,
      windowDays: 30,
    });
    expect(stored!.result_metrics.baselineRemeasured.value).toBeCloseTo(
      0.045,
      6,
    );

    await page.screenshot({
      path: `${OUT}/10-kb8-both-baselines.png`,
      fullPage: true,
    });
  });
});
