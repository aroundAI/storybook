import { Locator, Page, Request, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  cvdDeltaE,
  normalDeltaE,
  parseColour,
} from '../../../../packages/features/content-analytics/__tests__/support/colour-distance';
import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  insertClickHouse,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1708 — the "Where views came from" drill-down, the colour ramp and
 * keyboard-reachable chart detail, against seeded ClickHouse rows.
 *
 * Two weeks of one video's traffic, 2,000 views. Every window total is even,
 * so each share is exact to one decimal:
 *
 * | Group              | Codes (week A + week B)                    | Views | Share |
 * |--------------------|--------------------------------------------|-------|-------|
 * | Browse + Suggested | RELATED_VIDEO 500+300, SUBSCRIBER 100+100  | 1,000 | 50.0% |
 * |                    |   RELATED_VIDEO 800 = 40.0%, SUBSCRIBER 200 = 10.0% |  |   |
 * | Search             | YT_SEARCH 350+200                          |   550 | 27.5% |
 * | Shorts feed        | SHORTS 120                                 |   120 |  6.0% |
 * | External           | EXTERNAL_URL 100                           |   100 |  5.0% |
 * | Playlists          | PLAYLIST 4                                 |     4 |  0.2% |
 * | Channel page       | CHANNEL_PAGE 60                            |    60 |  3.0% |
 * | Direct / unknown   | DIRECT_OR_UNKNOWN 70                       |    70 |  3.5% |
 * | Other              | TS_44 50+26 = 3.8%, END_SCREEN 20 = 1.0%   |    96 |  4.8% |
 *
 * NOTIFICATION is a Browse + Suggested code that never occurs, so the
 * drill-down must not list it. TS_44 is a code the parser does not know, so
 * it must be listed, as unrecognised. In week B Playlists is 4 of 1,000 —
 * 0.4%, which draws at 0.32px and is floored to 2px; its detail must still
 * say 0.4%.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const EXPECTED_GROUPS = {
  browse_suggested: {
    share: 0.5,
    text: '50.0%',
    codes: { RELATED_VIDEO: '40.0%', SUBSCRIBER: '10.0%' },
  },
  search: { share: 0.275, text: '27.5%', codes: { YT_SEARCH: '27.5%' } },
  shorts_feed: { share: 0.06, text: '6.0%', codes: { SHORTS: '6.0%' } },
  external: { share: 0.05, text: '5.0%', codes: { EXTERNAL_URL: '5.0%' } },
  playlists: { share: 0.002, text: '0.2%', codes: { PLAYLIST: '0.2%' } },
  channel_page: { share: 0.03, text: '3.0%', codes: { CHANNEL_PAGE: '3.0%' } },
  direct: { share: 0.035, text: '3.5%', codes: { DIRECT_OR_UNKNOWN: '3.5%' } },
  other: {
    share: 0.048,
    text: '4.8%',
    codes: { TS_44: '3.8%', END_SCREEN: '1.0%' },
  },
} as const;

type Group = keyof typeof EXPECTED_GROUPS;

const WEEK_A = [
  ['RELATED_VIDEO', 500],
  ['SUBSCRIBER', 100],
  ['YT_SEARCH', 350],
  ['TS_44', 50],
] as const;

const WEEK_B = [
  ['RELATED_VIDEO', 300],
  ['SUBSCRIBER', 100],
  ['YT_SEARCH', 200],
  ['SHORTS', 120],
  ['EXTERNAL_URL', 100],
  ['PLAYLIST', 4],
  ['CHANNEL_PAGE', 60],
  ['DIRECT_OR_UNKNOWN', 70],
  ['TS_44', 26],
  ['END_SCREEN', 20],
] as const;

/** A day inside the last complete Sunday-to-Saturday week, as the tab windows. */
function lastCompleteWeekDay() {
  const date = daysAgo(0);

  date.setUTCDate(date.getUTCDate() - date.getUTCDay() - 4);

  return date;
}

async function setup(page: Page) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const connectionId = await seedYouTubeConnection(team.accountId, 'Main');
  const publish = await seedPublishedEpisode(project.id, connectionId, {
    number: 1,
    seasonId,
  });

  const video: SeededVideo = {
    videoId: publish.publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title: 'Seeded Episode 1',
    publishedAt: daysAgo(30),
  };

  await seedVideoDims([video]);
  await seedVideoMetricsBatch([
    { video, days: [{ ageDays: 1, views: 2_000 }] },
  ]);

  const weekB = lastCompleteWeekDay();
  const weekA = new Date(weekB);

  weekA.setUTCDate(weekA.getUTCDate() - 7);

  await insertClickHouse(
    'video_traffic_sources',
    (
      [
        [weekA, WEEK_A],
        [weekB, WEEK_B],
      ] as const
    ).flatMap(([day, rows]) =>
      rows.map(([source, views]) => ({
        project_id: project.id,
        video_id: video.videoId,
        platform: 'youtube',
        metric_date: clickHouseDate(day),
        source,
        views,
        watch_time_minutes: views,
      })),
    ),
  );

  await signInAs(page, team);

  const url = `/home/${team.slug}/studio/${project.slug}/analytics`;

  return { url };
}

/** Counts server-action POSTs, so opening the drill-down can be shown to add none. */
function countActions(page: Page) {
  const calls: string[] = [];

  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) {
      calls.push(request.url());
    }
  });

  return calls;
}

async function openDeepDive(page: Page, url: string, theme: 'light' | 'dark') {
  await page.goto(url);
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
  await byTest(page, 'analytics-tab-deep-dive').click();

  const card = byTest(page, 'deep-dive-traffic-breakdown');

  await expect(byTest(card, 'card-figure')).toHaveText('50%');

  return card;
}

/** The newest column's slice for a group — week B has all eight. */
function slice(card: Locator, group: Group) {
  return card
    .locator(`[data-test="traffic-slice"][data-group="${group}"]`)
    .last();
}

async function readDrillDown(card: Locator) {
  return card
    .locator('[data-test="traffic-drilldown-group"]')
    .evaluateAll((groups) =>
      groups.map((group) => ({
        group: group.getAttribute('data-group')!,
        share: Number(group.getAttribute('data-share')),
        text: group.querySelector('.tabular-nums')?.textContent ?? '',
        codes: [
          ...group.querySelectorAll('[data-test="traffic-drilldown-source"]'),
        ].map((code) => ({
          source: code.getAttribute('data-source')!,
          share: Number(code.getAttribute('data-share')),
          recognised: code.getAttribute('data-recognised') === 'true',
          text: code.textContent ?? '',
          shareText: code.querySelector('.tabular-nums')?.textContent ?? '',
        })),
      })),
    );
}

/**
 * The tooltip of the focused mark, by the id its trigger points at. Radix
 * keeps a closing tooltip in the DOM until its exit animation ends, so
 * "the tooltip on the page" can be several.
 */
async function focusedTooltip(page: Page) {
  const focused = page.locator(':focus');

  await expect(focused).toHaveAttribute('aria-describedby', /.+/);

  const id = await focused.getAttribute('aria-describedby');

  return page.locator(`[id="${id}"]`);
}

/** Tooltip bubbles a sighted reader can see right now. */
const openTooltips = (page: Page) =>
  page.locator('[data-radix-popper-content-wrapper] [data-state$="open"]');

/** The 52-week scroller starts at the oldest week; the data is at the end. */
async function scrollToNewest(card: Locator) {
  await byTest(card, 'traffic-breakdown-bars').evaluate((chart) => {
    chart.scrollLeft = chart.scrollWidth;
  });
}

async function sampleColours(card: Locator) {
  const colours: Record<string, string> = {};

  for (const group of Object.keys(EXPECTED_GROUPS) as Group[]) {
    colours[group] = await slice(card, group).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
  }

  return colours;
}

function pairwise(colours: Record<string, string>) {
  const groups = Object.keys(colours);
  const pairs: { pair: string; cvd: number; normal: number }[] = [];

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = parseColour(colours[groups[i]!]!);
      const b = parseColour(colours[groups[j]!]!);

      pairs.push({
        pair: `${groups[i]}/${groups[j]}`,
        cvd: cvdDeltaE(a, b),
        normal: normalDeltaE(a, b),
      });
    }
  }

  return pairs.sort((x, y) => x.cvd - y.cvd);
}

test.describe('FILM-1708 traffic drill-down and colour ramp', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test.describe.configure({ timeout: 180_000 });
  test.use({ viewport: { width: 1440, height: 2000 } });

  test('a group expands to the codes observed, summing to it, with no new query', async ({
    page,
  }) => {
    const { url } = await setup(page);
    const actions = countActions(page);
    const card = await openDeepDive(page, url, 'light');

    await page.waitForLoadState('networkidle');

    const before = actions.length;

    await card.getByRole('button', { name: 'Details' }).click();
    await expect(byTest(card, 'traffic-drilldown')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Carried in the breakdown response the chart already drew.
    expect(actions.length).toBe(before);

    const groups = await readDrillDown(card);

    expect(groups.map((g) => g.group)).toEqual(Object.keys(EXPECTED_GROUPS));

    for (const group of groups) {
      const expected = EXPECTED_GROUPS[group.group as Group];

      expect(group.share, group.group).toBeCloseTo(expected.share, 12);
      expect(group.text, group.group).toBe(expected.text);
      expect(
        group.codes.reduce((sum, code) => sum + code.share, 0),
        `${group.group}: codes sum to the group`,
      ).toBeCloseTo(group.share, 12);
      expect(
        Object.fromEntries(
          group.codes.map((code) => [code.source, code.shareText]),
        ),
      ).toEqual(expected.codes);
    }

    const browse = groups.find((g) => g.group === 'browse_suggested')!;

    expect(browse.codes.map((c) => c.source)).not.toContain('NOTIFICATION');

    const ts44 = groups
      .find((g) => g.group === 'other')!
      .codes.find((c) => c.source === 'TS_44')!;

    expect(ts44.recognised).toBe(false);
    expect(ts44.text).toContain('unrecognised code');

    // The legend says the same figures, to the same decimal — Playlists'
    // 0.2% used to read "0%" there.
    const legend = await card
      .locator('[data-test="traffic-legend-item"]')
      .evaluateAll((items) =>
        items.map((item) => [
          item.getAttribute('data-group'),
          item.querySelector('.tabular-nums')?.textContent,
        ]),
      );

    expect(Object.fromEntries(legend)).toEqual(
      Object.fromEntries(
        Object.entries(EXPECTED_GROUPS).map(([group, { text }]) => [
          group,
          text,
        ]),
      ),
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`all eight groups are distinguishable as rendered, ${theme}`, async ({
      page,
    }) => {
      const { url } = await setup(page);
      const card = await openDeepDive(page, url, theme);
      const colours = await sampleColours(card);

      expect(new Set(Object.values(colours)).size).toBe(8);

      for (const value of Object.values(colours)) {
        // No alpha: an alpha is not a colour, and it is what direct and
        // other used to differ by.
        expect(value).not.toMatch(/\/\s*0?\.\d|rgba\(.*,\s*0?\.\d+\)/);
      }

      const weakest = pairwise(colours)[0]!;

      expect(weakest.cvd, weakest.pair).toBeGreaterThanOrEqual(8);
      expect(
        Math.min(...pairwise(colours).map((p) => p.normal)),
      ).toBeGreaterThanOrEqual(15);

      // The floored slice still draws, at the floor.
      const box = await slice(card, 'playlists').boundingBox();

      expect(box!.height).toBeGreaterThanOrEqual(1.5);
      expect(box!.height).toBeLessThanOrEqual(2.5);
    });
  }

  test('the floored slice is reachable by keyboard and reports its true share', async ({
    page,
  }) => {
    const { url } = await setup(page);
    const card = await openDeepDive(page, url, 'light');
    const chart = byTest(card, 'traffic-breakdown-bars');
    const stops = chart.locator('[tabindex="0"]');

    await expect(stops).toHaveCount(1);
    await stops.focus();
    await page.keyboard.press('End');
    // Week B, bottom up: Browse + Suggested, Search, Shorts, External, Playlists.
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');

    const focused = page.locator(':focus');

    await expect(focused).toHaveAttribute('data-group', 'playlists');
    await expect(focused).toHaveAttribute('data-share', '0.004');
    await expect(await focusedTooltip(page)).toHaveText(
      `${await focused.getAttribute('data-bucket')} — Playlists: 0.4% of 1,000 views`,
    );
    // One bubble on screen, not one per mark visited.
    await expect(openTooltips(page)).toHaveCount(1);
    // Still one tab stop: arrowing moved it, it did not add one.
    await expect(stops).toHaveCount(1);
  });

  test('evidence: drilled down, the ramp and the floored slice, both themes', async ({
    page,
  }) => {
    test.skip(!process.env.CAPTURE_EVIDENCE, 'Set CAPTURE_EVIDENCE=1.');
    mkdirSync(OUT, { recursive: true });

    const { url } = await setup(page);
    const measured: Record<string, unknown> = {};

    for (const theme of ['light', 'dark'] as const) {
      const card = await openDeepDive(page, url, theme);

      await card.scrollIntoViewIfNeeded();
      await scrollToNewest(card);
      await card.screenshot({ path: `${OUT}/film-1708-ramp-${theme}.png` });

      const colours = await sampleColours(card);

      measured[`colours-${theme}`] = colours;
      measured[`pairs-${theme}`] = pairwise(colours).map((p) => ({
        ...p,
        cvd: +p.cvd.toFixed(1),
        normal: +p.normal.toFixed(1),
      }));

      await card.getByRole('button', { name: 'Details' }).click();
      await expect(byTest(card, 'traffic-drilldown')).toBeVisible();
      measured[`drilldown-${theme}`] = await readDrillDown(card);
      await card.screenshot({
        path: `${OUT}/film-1708-drilled-down-${theme}.png`,
      });

      const stops = byTest(card, 'traffic-breakdown-bars').locator(
        '[tabindex="0"]',
      );

      await stops.focus();
      await page.keyboard.press('End');
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
      const tooltip = await focusedTooltip(page);

      await expect(tooltip).toContainText('Playlists: 0.4%');
      await expect(openTooltips(page)).toHaveCount(1);
      // Let the bubbles of the marks passed on the way finish fading out,
      // so the picture shows what a reader sees once they stop.
      await expect(
        page.locator('[data-radix-popper-content-wrapper]'),
      ).toHaveCount(1);
      measured[`floored-tooltip-${theme}`] = await tooltip.textContent();
      await page.screenshot({
        path: `${OUT}/film-1708-floored-slice-tooltip-${theme}.png`,
        clip: await card.boundingBox().then((box) => ({
          x: box!.x - 60,
          y: box!.y - 20,
          width: box!.width + 80,
          height: Math.min(box!.height + 20, 420),
        })),
      });
    }

    writeFileSync(
      `${OUT}/film-1708-measured.json`,
      JSON.stringify({ expected: EXPECTED_GROUPS, measured }, null, 2),
    );
  });
});
