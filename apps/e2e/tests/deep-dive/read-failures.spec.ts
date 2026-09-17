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
 */
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
    ).toBeVisible();

    await expect(page.locator('[data-test="ypp-error"]:visible')).toBeVisible();

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

    await expect(mix.locator('[data-test="revenue-mix-error"]')).toBeVisible();
    await expect(mix).not.toContainText('No revenue recorded for this period.');
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
    ).toBeVisible();
    await expect(
      page.locator('[data-test="back-catalog-error"]:visible'),
    ).toBeVisible();
    await expect(
      page.locator('[data-test="cohort-error"]:visible'),
    ).toBeVisible();

    // The claims that must not be made off a read that never landed.
    await expect(
      page.getByText('Not enough published videos yet to compute a median.'),
    ).toHaveCount(0);
    await expect(
      page.getByText('Not enough history yet to separate back catalog'),
    ).toHaveCount(0);
    await expect(page.getByText('No upload cohorts yet.')).toHaveCount(0);
  });

  test('a failed refetch keeps the channel filter and the cards', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);

    // Installed before the page loads: the refetch below only happens once
    // the entry is stale, and the app's stale time is 60s.
    await page.clock.install();

    const fixture = await deepDive.setup();

    // Loaded, then filtered: the state a discarded channel list would strand,
    // since the filter is the only control that can clear the filtering.
    await deepDive.chooseChannel(fixture.activeChannelId);
    await expect(deepDive.channelFilter()).toContainText('Active Channel');

    await abortActionMatching(page, (body) => {
      try {
        const [args] = JSON.parse(body) as Array<Record<string, unknown>>;
        return Object.keys(args ?? {}).join() === 'projectId';
      } catch {
        return false;
      }
    });

    // `visibilitychange` on `window` is what React Query's focus manager
    // listens to; the second fast-forward runs its retry backoff out, so the
    // refetch has genuinely failed by the time this asserts.
    await page.clock.fastForward('02:00');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('visibilitychange')),
    );
    await page.clock.fastForward('00:30');

    // A failed *refetch* is not an absence: React Query keeps the last good
    // data and leaves `status` at success, so the filter must keep working.
    await expect(
      page.locator('[data-test="channel-filter-error"]'),
    ).toHaveCount(0);
    await expect(deepDive.channelFilter()).toContainText('Active Channel');
  });
});
