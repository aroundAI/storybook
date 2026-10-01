import { Locator, Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { ReachPageObject } from '../analytics/reach.po';
import {
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  insertClickHouse,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedRevenueRecord,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { setup as seedTraffic } from './traffic-fixture';

/**
 * FILM-1708 §8 — every chart surface the ramp reaches, light and dark, for a
 * side-by-side before and after.
 *
 * The same spec runs against a server built from origin/main
 * (`FILM_1708_PHASE=before`) and from this branch (the default, `after`),
 * with the same seed, so the two sets differ only by the code. It uses only
 * hooks main already has, so it can run against it.
 *
 * Not reachable, so not captured: `dashboard-demo-charts.tsx`. Its only
 * importer is the `dynamic()` wrapper in `dashboard-demo.tsx`, which no page
 * imports.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const PHASE = process.env.FILM_1708_PHASE === 'before' ? 'before' : 'after';
const THEMES = ['light', 'dark'] as const;

type Theme = (typeof THEMES)[number];

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
}

async function shoot(surface: Locator, name: string, theme: Theme) {
  await surface.scrollIntoViewIfNeeded();
  // The 52-week scrollers start at the oldest week; the data is at the end.
  await surface.locator('.overflow-x-auto').evaluateAll((scrollers) => {
    for (const scroller of scrollers)
      scroller.scrollLeft = scroller.scrollWidth;
  });
  await surface.page().mouse.move(0, 0);
  await surface.screenshot({
    path: `${OUT}/film-1708-${PHASE}-${name}-${theme}.png`,
    animations: 'disabled',
  });
}

test.describe(`FILM-1708 ramp, ${PHASE}`, () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading ClickHouse.',
  );

  test.describe.configure({ timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 2000 } });
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('deep dive: traffic, Browse + Suggested, median, back catalog', async ({
    page,
  }) => {
    const { url } = await seedTraffic(page, { backCatalog: true });

    for (const theme of THEMES) {
      await page.goto(url);
      await setTheme(page, theme);
      await byTest(page, 'analytics-tab-deep-dive').click();

      const traffic = byTest(page, 'deep-dive-traffic-breakdown');

      await expect(byTest(traffic, 'card-figure')).toHaveText('50%');
      await shoot(traffic, 'traffic-breakdown', theme);
      await shoot(
        byTest(page, 'deep-dive-traffic-share'),
        'traffic-share',
        theme,
      );

      const median = byTest(page, 'deep-dive-median');

      await expect(byTest(median, 'card-figure')).toBeVisible();
      await shoot(median, 'median', theme);

      const backCatalog = byTest(page, 'deep-dive-back-catalog');

      await expect(byTest(backCatalog, 'card-figure')).toBeVisible();
      await shoot(backCatalog, 'back-catalog', theme);
    }
  });

  test('reach history', async ({ page }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup();
    const ig = fixture.instagram.connectionId;
    const yt = fixture.youtube.connectionId;
    const windowRow = (
      connectionId: string,
      platform: string,
      asOf: Date,
      reached: number,
    ) => ({
      connection_id: connectionId,
      platform,
      as_of: clickHouseDate(asOf),
      window_days: 30,
      accounts_reached: reached,
      accounts_reached_followers: null,
      accounts_reached_non_followers: null,
      source: 'e2e',
      inserted_at: clickHouseDateTime(new Date()),
    });

    // Two channels so the chart draws two series: chart-1 and chart-2.
    await insertClickHouse(
      'channel_windows',
      [1, 2, 3, 4, 5, 6].flatMap((day) => [
        windowRow(ig, 'instagram', daysAgo(day), 100 + day * 15),
        windowRow(yt, 'youtube', daysAgo(day), 60 + day * 10),
      ]),
    );

    for (const theme of THEMES) {
      await reach.open(fixture.team, { window: 30 });
      await setTheme(page, theme);

      const history = byTest(page, 'reach-history');

      await expect(history).toBeVisible();
      await shoot(history, 'reach-history', theme);
    }
  });

  test('revenue mix', async ({ page }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { publishId } = await seedPublishedEpisode(project.id, connectionId);
    const recordDate = daysAgo(5).toISOString().slice(0, 10);

    // Every category, so every colour the mix uses is on screen.
    for (const [category, dollars] of [
      ['ads', 400],
      ['premium', 120],
    ] as const) {
      await seedRevenueRecord({
        publishId,
        category,
        revenueCents: dollars * 100,
        recordDate,
      });
    }

    for (const [category, dollars] of [
      ['sponsorship', 300],
      ['product', 220],
      ['affiliate', 160],
      ['licensing', 250],
      ['other', 90],
    ] as const) {
      await seedRevenueRecord({
        accountId: team.accountId,
        category,
        source: 'manual',
        revenueCents: dollars * 100,
        recordDate,
      });
    }

    await signInAs(page, team);

    for (const theme of THEMES) {
      await page.goto(`/home/${team.slug}/studio/analytics`);
      await setTheme(page, theme);
      await byTest(page, 'revenue-tab-overview').click();

      const mix = byTest(page, 'revenue-mix-card');

      await expect(mix).toContainText('Licensing');
      await shoot(mix, 'revenue-mix', theme);
    }
  });
});
