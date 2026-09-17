import { Page, expect, test } from '@playwright/test';

import { RevenuePageObject } from '../revenue/revenue.po';
import { DeepDivePageObject } from './deep-dive.po';

/**
 * A read that failed must say so, not render as a measured absence.
 *
 * Both surfaces below take their emptiness from data: the YPP cards are
 * narrowed to the project's channels, and the revenue mix reads a summary. A
 * failed read leaves each of them holding nothing, which is indistinguishable
 * from "there is nothing" unless the failure is stated.
 *
 * The failure is produced by aborting one server action and leaving the rest
 * of the page alone. Server action bodies are the serialized argument list,
 * which is how one action is told from another here.
 *
 * The error states carry an explicit timeout: React Query retries three times
 * with backoff before a query reports failure, so the state under assertion
 * lands several seconds after the abort — too close to the 10s default to
 * leave to chance on a loaded runner.
 */
const ERROR_STATE = { timeout: 20_000 };

/** One request plus React Query's three default retries. */
const RETRIED_ATTEMPTS = 4;
async function abortActionMatching(
  page: Page,
  matches: (body: string) => boolean,
) {
  await page.route('**/*', async (route) => {
    const request = route.request();

    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      matches(request.postData() ?? '')
    ) {
      await route.abort('failed');
      return;
    }

    await route.continue();
  });
}

test.describe('Failed reads', () => {
  test('a failed channel list is reported, not shown as a project with no channels', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // `listChannelsAction` is the only call whose argument is a bare project.
    await abortActionMatching(page, (body) => {
      try {
        const [args] = JSON.parse(body) as Array<Record<string, unknown>>;
        return Object.keys(args ?? {}).join() === 'projectId';
      } catch {
        return false;
      }
    });

    await deepDive.goToDeepDive(fixture.team.slug, fixture.project.slug);

    await expect(
      page.locator('[data-test="channel-filter-error"]:visible'),
    ).toBeVisible(ERROR_STATE);

    await expect(page.locator('[data-test="ypp-error"]:visible')).toBeVisible(
      ERROR_STATE,
    );

    // The claim that must not be made: the channels are unknown, not absent.
    await expect(page.locator('[data-test="ypp-no-channels"]')).toHaveCount(0);
  });

  test('a failed revenue summary is reported, not shown as no revenue', async ({
    page,
  }) => {
    const revenue = new RevenuePageObject(page);
    const account = await revenue.setup();

    await abortActionMatching(page, (body) => body.includes('"startDate"'));

    await page.goto(`/home/${account.slug}/studio/analytics`);
    await page.locator('[data-test="revenue-tab-overview"]').click();

    const mix = page.locator('[data-test="revenue-mix-card"]:visible');

    await expect(mix.locator('[data-test="revenue-mix-error"]')).toBeVisible(
      ERROR_STATE,
    );
    await expect(mix).not.toContainText('No revenue recorded for this period.');

    // The tiles above the mix read the same summary. Reporting a figure
    // beside an admission that the read never landed is the same false claim
    // the mix card was fixed for, one card up the page.
    //
    // `$0`, not `$0.00`: `formatCurrency` renders whole dollars, so the
    // earlier assertion could not fail on any implementation.
    for (const tile of ['total', 'daily', 'rpm']) {
      await expect(
        page.locator(`[data-test="revenue-summary-error-${tile}"]`),
      ).toBeVisible(ERROR_STATE);
    }

    // No figure left in the three tiles the summary feeds. `$0`, not
    // `$0.00` — `formatCurrency` renders whole dollars, so the earlier
    // assertion could not fail on any implementation. Monthly Projection
    // reads its own query, which succeeded, so its figure is real.
    for (const tile of ['total', 'daily', 'rpm']) {
      await expect(
        page.locator(`[data-test="revenue-tile-${tile}"]`).getByText('$'),
      ).toHaveCount(0);
    }

    // And the same failed summary one tab across, which printed "No revenue
    // data by platform" — a measurement, off a read that never landed.
    await page.locator('[role="tab"]', { hasText: 'By Platform' }).click();

    await expect(
      page.locator('[data-test="revenue-summary-error-platforms"]'),
    ).toBeVisible(ERROR_STATE);
    await expect(page.getByText('No revenue data by platform')).toHaveCount(0);
  });

  test('failed deep-dive reads are reported, not shown as no data', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // The three cards that still rendered an empty result on failure. Each is
    // told apart by an argument only it carries.
    await abortActionMatching(
      page,
      (body) =>
        body.includes('"mode"') ||
        body.includes('"ageDays"') ||
        body.includes('"checkpoints"'),
    );

    await deepDive.goToDeepDive(fixture.team.slug, fixture.project.slug);

    await expect(
      page.locator('[data-test="median-error"]:visible'),
    ).toBeVisible(ERROR_STATE);
    await expect(
      page.locator('[data-test="back-catalog-error"]:visible'),
    ).toBeVisible(ERROR_STATE);
    await expect(
      page.locator('[data-test="cohort-error"]:visible'),
    ).toBeVisible(ERROR_STATE);

    // The claims that must not be made off a read that never landed.
    await expect(
      page.getByText('Not enough published videos yet to compute a median.'),
    ).toHaveCount(0);
    await expect(
      page.getByText('Not enough history yet to separate back catalog'),
    ).toHaveCount(0);
    await expect(page.getByText('No upload cohorts yet.')).toHaveCount(0);
  });

  test('a failed refetch keeps the channel filter', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);

    // Installed before the page loads: the refetch below only happens once
    // the entry is stale, and the app's stale time is 60s.
    await page.clock.install();

    const fixture = await deepDive.setup();

    // Loaded, then filtered: the state a discarded channel list strands, since
    // the filter is the only control that can clear the filtering.
    await deepDive.chooseChannel(fixture.activeChannelId);
    await expect(deepDive.channelFilter()).toContainText('Active Channel');

    let attempts = 0;

    await abortActionMatching(page, (body) => {
      try {
        const [args] = JSON.parse(body) as Array<Record<string, unknown>>;

        if (Object.keys(args ?? {}).join() !== 'projectId') return false;

        attempts += 1;

        return true;
      } catch {
        return false;
      }
    });

    // `visibilitychange` on `window` is what React Query's focus manager
    // listens to.
    await page.clock.fastForward('02:00');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('visibilitychange')),
    );

    // Run the clock until the retries are spent: the query only reports
    // failure after the last one, and asserting before that passes against
    // any implementation.
    await expect
      .poll(
        async () => {
          await page.clock.runFor('00:05');
          return attempts;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(RETRIED_ATTEMPTS);

    // The query has now failed, and its last good data is still cached:
    // query-core sets `status: 'error'` but keeps `data`, so a bare
    // `isError` would take the filter away while the filtering it applied
    // stays on every card.
    await expect(
      page.locator('[data-test="channel-filter-error"]'),
    ).toHaveCount(0);
    await expect(deepDive.channelFilter()).toContainText('Active Channel');

    // The cards follow the same rule through `isUnavailable`, covered by its
    // unit test: driving *their* refetch from a browser needs a key switch,
    // which leaves some of them genuinely uncached — a different case, and a
    // flaky assertion.
  });
});
