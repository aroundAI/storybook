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
    await log.choose('experiment-metric', 'experiment-metric-option-avg_view_percentage');
    await log.linkVideo(team.publishIds[0]);
    await log.chooseChannel(team.connectionId);
    await log.field('experiment-review-window').fill('30');

    await page.screenshot({ path: `${OUT}/01-form-filled.png`, fullPage: true });

    await log.submitAndWaitForReset();

    // Second save with different values; then the reset form.
    await log.field('experiment-title').fill('Search-first titles');
    await log.field('experiment-change').fill('Lead titles with the search term');
    await log.choose('experiment-category', 'experiment-category-option-packaging');
    await log.choose('experiment-metric', 'experiment-metric-option-search_share');
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
    await page.locator(`[data-test="experiment-row-${first!.id}"]:visible`).click();
    await page.getByRole('button', { name: 'Start experiment' }).click();
    await expect(
      page.locator('[data-test="experiment-watched-baseline-unmeasured"]'),
    ).toBeVisible();

    await page.screenshot({
      path: `${OUT}/03-started-watched-unmeasured.png`,
      fullPage: true,
    });
  });
});
