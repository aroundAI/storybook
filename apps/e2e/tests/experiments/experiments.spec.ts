import { expect, test } from '@playwright/test';

import {
  readRows,
  seedExperiment,
  seedProject,
  seedPublishedVideos,
  seedRunningExperiment,
  seedTeamAccount,
  seedYouTubeConnection,
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

test.describe('An experiment runs its whole course (FILM-1610 review 4, G9)', () => {
  // Logging and starting had browser tests; concluding — the step the log
  // exists for — had none. This drives all three through the page, then
  // reads the row, so each step is shown to have written what it claims.
  test('logged, started and concluded through the page', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();

    await log.field('experiment-title').fill('Whole course');
    await log.field('experiment-change').fill('Faces on thumbnails');
    await log.choose('experiment-metric', 'experiment-metric-option-ctr');
    await log.linkVideo(team.publishIds[0]);
    await log.submitAndWaitForReset();

    const [created] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );

    await page
      .locator(`[data-test="experiment-row-${created!.id}"]:visible`)
      .click();
    await page.getByRole('button', { name: 'Start experiment' }).click();
    await expect(page.getByText('Experiment started')).toBeVisible();

    // Concluding needs what happened, typed into the labelled field (G8).
    const outcome = page.getByLabel('What actually happened?');
    const confirm = page.getByRole('button', { name: 'confirmed' });

    await expect(confirm).toBeDisabled();
    await outcome.fill('CTR held steady');
    await confirm.click();
    await expect(page.getByText('Experiment concluded')).toBeVisible();

    // Nothing left to press: a concluded experiment has no lifecycle step.
    await expect(outcome).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Start experiment' }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-test="experiment-result-after-days"]'),
    ).toHaveText(' · result after 0 days');
    await expect(
      page.locator('[data-test="experiment-watched-result-unmeasured"]'),
    ).toHaveAttribute('data-reason', 'no_data');

    const [row] = await readRows<{
      status: string;
      outcome_status: string;
      actual_outcome: string;
      started_at: string;
      ended_at: string;
      baseline_metrics: { watched?: { metric: string } };
      result_metrics: {
        resultAfterDays?: number;
        watched?: { metric: string };
      };
    }>(
      'analytics_experiments',
      `select=status,outcome_status,actual_outcome,started_at,ended_at,baseline_metrics,result_metrics&id=eq.${created!.id}`,
    );

    expect(row).toMatchObject({
      status: 'concluded',
      outcome_status: 'confirmed',
      actual_outcome: 'CTR held steady',
      ended_at: row!.started_at,
      baseline_metrics: { watched: { metric: 'ctr' } },
      result_metrics: { resultAfterDays: 0, watched: { metric: 'ctr' } },
    });
  });
});

test.describe("Experiment dates are the user's own (FILM-1610 review, E1)", () => {
  // 19:00 UTC is 00:30 the next day in Kolkata. A date taken from the
  // server's UTC clock records the start a day early for anyone east of it.
  //
  // Anchored on today's UTC date, not a fixed one: the server now refuses a
  // date that cannot be today in any time zone (review 4, G6), so the
  // browser's clock can move only within a day of the server's. Today's
  // 19:00 UTC is tomorrow in Kolkata, which the old server-side date could
  // not produce.
  test.use({ timezoneId: 'Asia/Kolkata' });

  test('a start just after local midnight is recorded on the local date', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const id = await seedExperiment(team.accountId, {
      title: 'Midnight start',
    });

    const utcToday = new Date().toISOString().slice(0, 10);
    const kolkataTomorrow = new Date(`${utcToday}T00:00:00Z`);
    kolkataTomorrow.setUTCDate(kolkataTomorrow.getUTCDate() + 1);

    await signInAs(page, team);
    await page.clock.setFixedTime(new Date(`${utcToday}T19:00:00Z`));
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    await page.locator(`[data-test="experiment-row-${id}"]:visible`).click();
    await page.getByRole('button', { name: 'Start experiment' }).click();
    await expect(page.getByText('Experiment started')).toBeVisible();

    const [row] = await readRows<{ started_at: string }>(
      'analytics_experiments',
      `select=started_at&id=eq.${id}`,
    );

    expect(row!.started_at).toBe(kolkataTomorrow.toISOString().slice(0, 10));
  });
});

test.describe('Video picker at scale, and labels (FILM-1610 review 3, F5 F6)', () => {
  test('finds a video beyond the newest 50 by searching, and links it', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const connectionId = await seedYouTubeConnection(team.accountId);
    const project = await seedProject(team);

    // 60 videos; the first is the oldest, so it is not in the newest 50.
    const titles = [
      'Needle in the haystack',
      ...Array.from({ length: 59 }, (_, index) => `Filler video ${index + 1}`),
    ];
    const [needle] = await seedPublishedVideos(
      project.id,
      connectionId,
      titles,
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    const log = new ExperimentsPageObject(page);
    await expect(log.field('video-picker-trigger')).toBeVisible();
    await log.field('video-picker-trigger').click();

    // Only a page is loaded, and the picker says so.
    await expect(
      page.locator('[data-test="video-picker-has-more"]'),
    ).toBeVisible();
    await expect(
      page.locator(`[data-test="video-picker-option-${needle}"]`),
    ).toHaveCount(0);

    await page.locator('[data-test="video-picker-search"]').fill('Needle');
    await page.locator(`[data-test="video-picker-option-${needle}"]`).click();
    await page.keyboard.press('Escape');

    await log.field('experiment-title').fill('Found by search');
    await log.field('experiment-change').fill('x');
    await log.submitAndWaitForReset();

    const [row] = await readRows<{ id: string }>(
      'analytics_experiments',
      `select=id&account_id=eq.${team.accountId}`,
    );
    const links = await readRows<{ publish_id: string }>(
      'experiment_publishes',
      `select=publish_id&experiment_id=eq.${row!.id}`,
    );

    expect(links.map((link) => link.publish_id)).toEqual([needle]);
  });

  test('the picker and the channel are named by their labels', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    await log.setup();

    // FormControl ties each label to its control, so assistive technology
    // can name it — and so can this locator.
    await expect(
      log.form().getByLabel('Videos this experiment runs on'),
    ).toHaveAttribute('data-test', 'video-picker-trigger');
    await expect(log.form().getByLabel('Channel (optional)')).toHaveAttribute(
      'data-test',
      'channel-filter-trigger',
    );
  });
});

test.describe('The due list follows the date (FILM-1610 review 3, F10)', () => {
  test('a tab left open past midnight shows what became due today', async ({
    page,
  }) => {
    const team = await seedTeamAccount();

    // Due on 2 March: started 1 February on a 29-day window.
    const id = await seedRunningExperiment(team.accountId, {
      title: 'Due tomorrow',
      startedAt: '2026-02-01',
      reviewWindowDays: 29,
    });

    await signInAs(page, team);
    await page.clock.setFixedTime(new Date('2026-03-01T12:00:00Z'));
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);

    await expect(
      page.locator('[data-test="experiments-due-empty"]:visible'),
    ).toBeVisible();

    // The next day, the tab regains focus. The cached list was for 1 March;
    // a key without the date would keep serving it.
    await page.clock.setFixedTime(new Date('2026-03-02T12:00:00Z'));
    await page.evaluate(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await expect(
      page.locator(`[data-test="experiment-due-${id}"]:visible`),
    ).toBeVisible();
  });
});
