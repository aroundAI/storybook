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
});
