import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { daysAgo, seedVideoDim, seedVideoMetrics } from '../utils/clickhouse';
import {
  CurrencyFixture,
  RevenueCurrencyPageObject,
} from './revenue-currency.po';
import { RevenuePageObject } from './revenue.po';

/**
 * Screenshots and DOM measurements for revenue per currency (KB-12).
 *
 * Not a guard — `revenue-currency.spec.ts` holds those, and runs without
 * ClickHouse. This seeds views as well, so the RPM tile is a measured figure
 * rather than the `$0` it is with ClickHouse off, and writes every value it
 * reads to `kb-12-measured-*.json` for the PR comment.
 *
 * 200,000 views in the window. RPM is cents per thousand views, within a
 * currency: $1,600 → $8 and €800 → €4. Summed it was $2,400 → "$12", which
 * is what the single-currency account — whose $2,400 really is dollars —
 * must still read.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function seedViews(fixture: CurrencyFixture) {
  const video = {
    videoId: fixture.publishId,
    projectId: fixture.project.id,
    accountId: fixture.team.accountId,
    connectionId: fixture.connectionId,
    title: 'Sponsored video',
    publishedAt: daysAgo(10),
  };

  await seedVideoDim(video);
  await seedVideoMetrics(video, [{ ageDays: 5, views: 200_000 }]);
}

/**
 * Waits until every chart has finished drawing.
 *
 * Recharts animates an area two ways, and both were measured here rather
 * than guessed. On mount it reveals the area left to right by widening a
 * second clip rect until it matches the plot's. On a data change it keeps
 * one clip rect and morphs the path, so the area's height grows instead. A
 * screenshot taken during either shows an empty or half-drawn chart.
 *
 * So: every reveal has reached full width, and two consecutive samples are
 * identical. That is the condition, not a guess at its duration.
 */
async function chartsDrawn(page: Page) {
  const surfaces = page.locator(
    '[data-test="revenue-chart-card"] svg.recharts-surface',
  );

  await expect(surfaces.first()).toBeVisible();

  // Wherever the last click left the pointer, it is over a chart, and the
  // capture would carry a tooltip reading "$0" across the figure.
  await page.mouse.move(0, 0);

  let previous = '';

  await expect
    .poll(async () => {
      const charts = await surfaces.evaluateAll((svgs) =>
        svgs.map((svg) => {
          const widths = [...svg.querySelectorAll('clipPath rect')].map(
            (rect) => Number(rect.getAttribute('width')),
          );
          const area = svg.querySelector('.recharts-area-area');

          return {
            revealed:
              widths.length > 0 &&
              widths[0]! > 100 &&
              widths.every((width) => width === widths[0]),
            areaHeight:
              area instanceof SVGGraphicsElement ? area.getBBox().height : 0,
          };
        }),
      );

      const state = JSON.stringify(charts);
      const settled =
        state === previous && charts.every((chart) => chart.revealed);

      previous = state;

      return settled;
    })
    .toBe(true);
}

/** Every figure on the three tabs, read out of the DOM. */
async function measure(page: Page, revenue: RevenueCurrencyPageObject) {
  const texts = (selector: string) =>
    page
      .locator(selector)
      .allInnerTexts()
      .then((all) => all.map((text) => text.replace(/\s+/g, ' ').trim()));

  await revenue.openTab('overview');
  await expect(revenue.mixCards().first()).toContainText('%');
  // The projection is its own query; a tile read before it lands is a
  // skeleton, which measures as a title and no figure.
  await expect(revenue.tileValues('projection').first()).toBeVisible();

  const overview = {
    total: await texts('[data-test="revenue-tile-total"]'),
    daily: await texts('[data-test="revenue-tile-daily"]'),
    rpm: await texts('[data-test="revenue-tile-rpm"]'),
    projection: await texts('[data-test="revenue-tile-projection"]'),
    charts: await texts('[data-test="revenue-chart-card"] h3'),
    mix: await texts('[data-test="revenue-mix-card"]:visible'),
  };

  await revenue.openTab('platforms');
  await expect(revenue.platformCards().first()).toBeVisible();

  const platforms = await texts('[data-test="revenue-platform-card"]');

  await revenue.openTab('content');
  await expect(revenue.topContentTables().first()).toBeVisible();

  const content = await texts('[data-test="revenue-top-content-row"]');

  return { ...overview, platforms, content };
}

test.describe('Revenue per currency — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  // Tall enough to hold the two-currency overview without `fullPage`.
  // A full-page capture resizes the viewport, the charts' responsive
  // containers re-render, and Recharts restarts its reveal from zero — so
  // every full-page capture of this dashboard had empty charts in it.
  test.use({ viewport: { width: 1440, height: 1900 } });

  test('one currency: the dashboard as it always was', async ({ page }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const fixture = await revenue.setup('USD');

    await seedViews(fixture);
    await revenue.goToRevenue(fixture.team.slug);

    await expect(revenue.tileValues('rpm')).toHaveText(['$12']);
    await expect(revenue.tileValues('total')).toHaveText(['$2,400']);
    await expect(revenue.mixCards()).toHaveCount(1);

    mkdirSync(OUT, { recursive: true });
    await chartsDrawn(page);
    await page.screenshot({
      path: `${OUT}/kb12-01-one-currency-overview.png`,
    });

    const measured = await measure(page, revenue);

    await revenue.openTab('platforms');
    await expect(revenue.platformCards()).toHaveCount(2);
    await page.screenshot({
      path: `${OUT}/kb12-02-one-currency-platforms.png`,
    });

    await revenue.openTab('content');
    await expect(revenue.topContentTables()).toHaveCount(1);
    await page.screenshot({
      path: `${OUT}/kb12-03-one-currency-content.png`,
    });

    writeFileSync(
      `${OUT}/kb-12-measured-one-currency.json`,
      JSON.stringify(measured, null, 2),
    );
  });

  test('two currencies: one card per currency, on every tab', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const fixture = await revenue.setup('EUR');

    await seedViews(fixture);
    await revenue.goToRevenue(fixture.team.slug);

    await expect(revenue.tileValues('total')).toHaveText(['$1,600', '€800']);
    // Each currency over the same 200,000 views; "$12" is the sum's RPM.
    await expect(revenue.tileValues('rpm')).toHaveText(['$8', '€4']);
    await expect(revenue.mixCards()).toHaveCount(2);

    mkdirSync(OUT, { recursive: true });
    await chartsDrawn(page);
    await page.screenshot({
      path: `${OUT}/kb12-04-two-currencies-overview.png`,
    });

    const measured = await measure(page, revenue);

    await revenue.openTab('platforms');
    await expect(revenue.platformCards()).toHaveCount(3);
    await page.screenshot({
      path: `${OUT}/kb12-05-two-currencies-platforms.png`,
    });

    await revenue.openTab('content');
    await expect(revenue.topContentTables()).toHaveCount(2);
    // The video's euros over its views: 60000 / 200000 × 1000 = 300 cents.
    await expect(
      revenue
        .topContentTables()
        .nth(1)
        .locator('[data-test="revenue-top-content-row"]'),
    ).toHaveText([/€600\s*€3$/]);
    await page.screenshot({
      path: `${OUT}/kb12-06-two-currencies-content.png`,
    });

    writeFileSync(
      `${OUT}/kb-12-measured-two-currencies.json`,
      JSON.stringify(measured, null, 2),
    );
  });

  test('the state after the action: a euro entry saved into a dollar account', async ({
    page,
  }) => {
    const revenue = new RevenueCurrencyPageObject(page);
    const form = new RevenuePageObject(page);
    const fixture = await revenue.setup('USD');

    await seedViews(fixture);
    await revenue.goToRevenue(fixture.team.slug);
    await expect(revenue.tileValues('total')).toHaveText(['$2,400']);

    await revenue.openTab('manual');
    await form.chooseCurrency('EUR - Euro');
    await form.addEntry({ dollars: '50.00', category: 'Licensing' });
    await form.expectSuccessToast();

    await expect(revenue.tileValues('total')).toHaveText(['$2,400', '€50']);

    await revenue.openTab('overview');
    await expect(revenue.mixCards()).toHaveCount(2);

    mkdirSync(OUT, { recursive: true });
    await chartsDrawn(page);
    await page.screenshot({
      path: `${OUT}/kb12-07-after-saving-a-euro-entry.png`,
    });

    const measured = await measure(page, revenue);

    writeFileSync(
      `${OUT}/kb-12-measured-after-euro-entry.json`,
      JSON.stringify(measured, null, 2),
    );
  });
});
