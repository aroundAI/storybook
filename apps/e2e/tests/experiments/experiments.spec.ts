import { expect, test } from '@playwright/test';

import {
  readRows,
  seedExperiment,
  seedRunningExperiment,
  seedTeamAccount,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { ExperimentsPageObject } from './experiments.po';

interface ExperimentRow {
  id: string;
  title: string;
  category: string | null;
  metric_watched: string | null;
  review_window_days: number;
  notes: string | null;
  connection_id: string | null;
}

const EXPERIMENT_COLUMNS =
  'id,title,category,metric_watched,review_window_days,notes,connection_id';

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

test.describe('Experiment log (FILM-1610)', () => {
  test("the second experiment saves its own values, not the first one's", async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [firstVideo, secondVideo] = team.publishIds;

    // First: every new field set.
    await log.field('experiment-title').fill('First experiment');
    await log.field('experiment-change').fill('Faces on thumbnails');
    await log.choose(
      'experiment-category',
      'experiment-category-option-packaging',
    );
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(firstVideo);
    await log.chooseChannel(team.connectionId);
    await log.field('experiment-review-window').fill('30');
    await log.field('experiment-notes').fill('first notes');
    await log.submitAndWaitForReset();

    // After the reset, every field must *look* empty too. An uncontrolled
    // Radix select keeps its label across reset() while form state clears.
    await expect(log.field('experiment-category')).toHaveText('No category');
    await expect(log.field('experiment-metric')).toHaveText(
      'No specific metric',
    );
    await expect(log.field('video-picker-trigger')).toHaveText('Choose videos');
    await expect(
      log
        .field('experiment-channel')
        .locator('[data-test="channel-filter-trigger"]'),
    ).toHaveText('No specific channel');
    await expect(log.field('experiment-review-window')).toHaveValue('60');
    await expect(log.field('experiment-notes')).toHaveValue('');

    // Second: different values everywhere, the channel deliberately left
    // unset — the case where stale state from the first save would leak in.
    await log.field('experiment-title').fill('Second experiment');
    await log.field('experiment-change').fill('Shorter hook');
    await log.choose('experiment-category', 'experiment-category-option-hook');
    await log.choose(
      'experiment-metric',
      'experiment-metric-option-search_share',
    );
    await log.linkVideo(secondVideo);
    await log.field('experiment-review-window').fill('14');
    await log.field('experiment-notes').fill('second notes');
    await log.submitAndWaitForReset();

    const rows = await readRows<ExperimentRow>(
      'analytics_experiments',
      `select=${EXPERIMENT_COLUMNS}&account_id=eq.${team.accountId}&order=created_at.asc`,
    );

    expect(rows.map(({ id: _id, ...row }) => row)).toEqual([
      {
        title: 'First experiment',
        category: 'packaging',
        metric_watched: 'ctr',
        review_window_days: 30,
        notes: 'first notes',
        connection_id: team.connectionId,
      },
      {
        title: 'Second experiment',
        category: 'hook',
        metric_watched: 'search_share',
        review_window_days: 14,
        notes: 'second notes',
        connection_id: null,
      },
    ]);

    // Each experiment is linked to its own video, and only that one.
    for (const [row, video] of [
      [rows[0]!, firstVideo],
      [rows[1]!, secondVideo],
    ] as const) {
      const links = await readRows<{ publish_id: string }>(
        'experiment_publishes',
        `select=publish_id&experiment_id=eq.${row.id}`,
      );

      expect(links.map((link) => link.publish_id)).toEqual([video]);
    }
  });

  test('a blank review window is refused rather than saved as 60', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();

    await log.field('experiment-title').fill('No window');
    await log.field('experiment-change').fill('Anything');
    await log.field('experiment-review-window').fill('');
    await log.submit();

    await expect(log.form().getByText('Enter a number of days')).toBeVisible();

    const rows = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );

    expect(rows).toHaveLength(0);
  });

  test('lists only running experiments past their review date', async ({
    page,
  }) => {
    const team = await seedTeamAccount();

    // Started 90 days ago on a 30-day window: due 60 days ago.
    const due = await seedRunningExperiment(team.accountId, {
      title: 'Overdue experiment',
      startedAt: isoDaysAgo(90),
      reviewWindowDays: 30,
    });
    // Started yesterday on a 60-day window: not due for two months.
    const notDue = await seedRunningExperiment(team.accountId, {
      title: 'Fresh experiment',
      startedAt: isoDaysAgo(1),
      reviewWindowDays: 60,
    });

    await signInAs(page, team);

    const log = new ExperimentsPageObject(page);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    await expect(log.form()).toBeVisible();

    await expect(
      page.locator(`[data-test="experiment-due-${due}"]:visible`),
    ).toContainText('Overdue experiment');
    await expect(
      page.locator(`[data-test="experiment-due-${notDue}"]`),
    ).toHaveCount(0);
  });

  test('a watched metric with no data says why instead of showing zero', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();

    await log.field('experiment-title').fill('CTR test');
    await log.field('experiment-change').fill('New thumbnail');
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(team.publishIds[0]);
    await log.submitAndWaitForReset();

    const [row] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );

    await page
      .locator(`[data-test="experiment-row-${row!.id}"]:visible`)
      .click();
    await page.getByRole('button', { name: 'Start experiment' }).click();

    // ClickHouse is off here, so the linked video has no reach data: the
    // baseline must name that, and must not render a 0.0%.
    const baseline = page.locator(
      '[data-test="experiment-watched-baseline-unmeasured"]',
    );
    await expect(baseline).toHaveAttribute('data-reason', 'no_data');
    await expect(
      page.locator('[data-test="experiment-watched-baseline-value"]'),
    ).toHaveCount(0);
  });
});

test.describe("Experiment dates are the user's own (FILM-1610 review, E1)", () => {
  // 00:30 on 2 March in Kolkata is still 1 March in UTC. A date taken from
  // the server's UTC clock records the start a day early for anyone east of
  // it. The fixed date is far from today on purpose: the old server-side
  // date cannot match it by coincidence.
  test.use({ timezoneId: 'Asia/Kolkata' });

  test('a start just after local midnight is recorded on the local date', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, {
      title: 'Midnight start',
    });

    await signInAs(page, team);
    await page.clock.setFixedTime(new Date('2026-03-01T19:00:00Z'));
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();
    await page.getByRole('button', { name: 'Start experiment' }).click();
    await expect(page.getByText('Experiment started')).toBeVisible();

    const [row] = await readRows<{ started_at: string }>(
      'analytics_experiments',
      `select=started_at&id=eq.${id}`,
    );

    expect(row!.started_at).toBe('2026-03-02');
  });
});
