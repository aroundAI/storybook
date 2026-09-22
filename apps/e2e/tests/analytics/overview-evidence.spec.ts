import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { daysAgo, seedVideoDim, seedVideoMetrics } from '../utils/clickhouse';
import { OverviewFixture, OverviewPageObject } from './overview.po';

/**
 * Screenshots and DOM measurements for the Overview tab (KB-16).
 *
 * Not a guard — `overview.spec.ts` holds those, and runs without
 * ClickHouse. This seeds 200,000 views on the one video so the metric row
 * is non-zero, which is the state that used to read "+100.0%" beside every
 * figure: `calculateChange(n, 0)` called a change from nothing a doubling,
 * and this page never had a previous period to hand it.
 *
 * Every value read here is written to `kb-16-measured-*.json` for the PR
 * comment. Run against the unfixed base for the BEFORE set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function seedViews(fixture: OverviewFixture) {
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

/** The figures the PR comment tabulates, read out of the DOM. */
async function measure(page: Page, overview: OverviewPageObject) {
  const text = await overview.pageText();
  const texts = (selector: string) =>
    page
      .locator(selector)
      .allInnerTexts()
      .then((all) => all.map((item) => item.replace(/\s+/g, ' ').trim()));

  // By text, so the unfixed page — which has none of the `data-test`
  // hooks — measures by the same rule.
  const between = (source: string, from: string, to: string) =>
    source.slice(source.indexOf(from), source.indexOf(to)).trim();
  // The tab list separates the metric row from the grid, and the grid's
  // card titles repeat the metric labels.
  const grid = text.slice(text.indexOf('Overview Content'));

  return {
    metricRow: between(text, 'Export', 'Overview Content'),
    platformSplit: between(grid, 'Platform Split', 'Comments'),
    comments: between(grid, 'Comments', 'AI Performance Insight'),
    shares: between(grid, 'Shares', 'Top Performing Content'),
    revenue: between(grid, 'Revenue', 'Top Regions'),
    revenueCards: await texts('[data-test="overview-revenue"]'),
    metricChanges: await texts('[data-test="metric-change"]'),
  };
}

test.describe('Overview truth — evidence (KB-16)', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  // Tall enough for the whole grid without `fullPage`, which resizes the
  // viewport and restarts every chart's reveal.
  test.use({ viewport: { width: 1440, height: 1700 } });

  for (const [state, label] of [
    ['none', 'no-breakdown-data'],
    ['two', 'two-currencies'],
    ['one', 'one-currency'],
  ] as const) {
    test(`overview with ${label}`, async ({ page }) => {
      const overview = new OverviewPageObject(page);
      const fixture = await overview.setup(state);

      await seedViews(fixture);
      await overview.goToOverview(fixture);

      // 200,000 views on the one video, in the metric row.
      await expect(page.getByText('200.0K').first()).toBeVisible();

      // The grid renders all at once after its queries land, and the only
      // Recharts surface (Performance Over Time) is below the fold of this
      // viewport, so there is no reveal to wait out. The pointer is parked
      // so no tooltip is in the capture.
      await page.mouse.move(0, 0);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/kb16-${label}.png` });

      writeFileSync(
        `${OUT}/kb-16-measured-${label}.json`,
        JSON.stringify(await measure(page, overview), null, 2),
      );
    });
  }
});
