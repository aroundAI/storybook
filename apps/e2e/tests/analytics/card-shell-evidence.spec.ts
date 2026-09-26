import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  insertClickHouse,
  seedVideoAudience,
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

/**
 * FILM-1706 — screenshots and DOM measurements for the card shell.
 *
 * Not a guard (`card-shell.spec.ts` holds those). It seeds ClickHouse rows
 * whose answers are worked out by hand below, reads every card's figure and
 * sentence off the page in both themes, and writes them to
 * `film-1706-measured.json` beside the screenshots for the PR table.
 *
 * | Card                     | Seeded                                   | Answer |
 * |--------------------------|------------------------------------------|--------|
 * | Total Views              | 1,000 + 3,000 views                      | 4,000  |
 * | Platform Split           | both videos on YouTube                   | 100%   |
 * | Gender                   | 60/40 on 1,000 views, 20/80 on 3,000     | 70% (women: 400 + 2,400 of 4,000) |
 * | Top Regions              | IN 300 + 2,700 of 4,000 country views    | 75%    |
 * | Median views per video   | two videos, same month: 1,000 and 3,000  | 3.0K — `quantileExact(0.5)` takes the upper middle of an even count, not the average of the two |
 * | Browse + Suggested share | last full week: 700 of 1,000             | 70%    |
 * | Where views came from    | the same rows over the window            | 70%    |
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const EXPECTED = {
  'Total Views': '4,000',
  'Platform Split': '100%',
  Gender: '70%',
  'Top Regions': '75%',
  'Median views per video': '3.0K',
  'Browse + Suggested share': '70%',
  'Where views came from': '70%',
} as const;

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

  const publishes = await Promise.all(
    [1, 2].map((number) =>
      seedPublishedEpisode(project.id, connectionId, { number, seasonId }),
    ),
  );

  const [first, second] = publishes.map((publish, index) => ({
    videoId: publish.publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title: `Seeded Episode ${index + 1}`,
    publishedAt: daysAgo(10),
  })) as [SeededVideo, SeededVideo];

  await seedVideoDims([first, second]);
  await seedVideoMetricsBatch([
    { video: first, days: [{ ageDays: 1, views: 1_000 }] },
    { video: second, days: [{ ageDays: 1, views: 3_000 }] },
  ]);
  await seedVideoAudience([
    {
      video: first,
      rows: [
        { dimension: 'gender', key: 'male', percentage: 60 },
        { dimension: 'gender', key: 'female', percentage: 40 },
        { dimension: 'country', key: 'US', views: 700 },
        { dimension: 'country', key: 'IN', views: 300 },
      ],
    },
    {
      video: second,
      rows: [
        { dimension: 'gender', key: 'male', percentage: 20 },
        { dimension: 'gender', key: 'female', percentage: 80 },
        { dimension: 'country', key: 'US', views: 300 },
        { dimension: 'country', key: 'IN', views: 2_700 },
      ],
    },
  ]);

  const metricDate = clickHouseDate(lastCompleteWeekDay());

  await insertClickHouse(
    'video_traffic_sources',
    [
      { source: 'RELATED_VIDEO', views: 700 },
      { source: 'YT_SEARCH', views: 300 },
    ].map(({ source, views }) => ({
      project_id: project.id,
      video_id: second.videoId,
      platform: 'youtube',
      metric_date: metricDate,
      source,
      views,
      watch_time_minutes: views,
    })),
  );

  await signInAs(page, team);

  return { team, project };
}

/** Every visible card's title, figure (or stated reason) and sentence. */
async function readCards(page: Page) {
  const cards = page.locator('section[aria-labelledby]:visible');

  await expect(cards.first()).toBeVisible();

  return cards.evaluateAll((all) =>
    all.map((card) => ({
      title: card.querySelector('h3')?.textContent ?? '',
      figure:
        card.querySelector('[data-test="card-figure"]')?.textContent ?? null,
      noFigure:
        card.querySelector('[data-test="card-no-figure"]')?.textContent ?? null,
      sentence:
        card.querySelector('[data-test="card-sentence"]')?.textContent ?? '',
      hasDetails: card.querySelector('button[aria-controls]') !== null,
    })),
  );
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
}

test.describe('FILM-1706 card shell — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test.describe.configure({ timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 2000 } });

  test('both tabs, both themes, figures against the hand-computed answers', async ({
    page,
  }) => {
    mkdirSync(OUT, { recursive: true });

    const { team, project } = await setup(page);
    const url = `/home/${team.slug}/studio/${project.slug}/analytics`;
    const measured: Record<string, unknown> = {};

    for (const theme of ['light', 'dark'] as const) {
      await page.goto(url);
      await setTheme(page, theme);
      await expect(
        page.getByRole('heading', { name: 'Shares', exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-test="overview-views"] [data-test="card-figure"]'),
      ).toHaveText(EXPECTED['Total Views']);
      // The audience read lands after the page: wait for it, or Gender is
      // not on the page yet when the cards are read.
      await expect(
        page.locator('[data-test="overview-gender"] [data-test="card-figure"]'),
      ).toHaveText(EXPECTED.Gender);

      measured[`overview-${theme}`] = await readCards(page);
      await page.screenshot({ path: `${OUT}/film-1706-overview-${theme}.png` });

      await page.locator('[data-test="analytics-tab-deep-dive"]').click();
      await expect(
        page.locator(
          '[data-test="deep-dive-traffic-share"] [data-test="card-figure"]',
        ),
      ).toHaveText(EXPECTED['Browse + Suggested share']);

      measured[`deep-dive-${theme}`] = await readCards(page);
      await page.screenshot({
        path: `${OUT}/film-1706-deep-dive-${theme}.png`,
      });
    }

    // The figures, read off the page, against the answers worked out above.
    const all = [
      ...(measured['overview-light'] as Awaited<ReturnType<typeof readCards>>),
      ...(measured['deep-dive-light'] as Awaited<ReturnType<typeof readCards>>),
    ];

    for (const [title, figure] of Object.entries(EXPECTED)) {
      expect(all.find((card) => card.title === title)?.figure, title).toBe(
        figure,
      );
    }

    // Details, opened from the keyboard, with focus showing.
    const traffic = page.locator('[data-test="deep-dive-traffic-breakdown"]');
    const trigger = traffic.getByRole('button', { name: 'Details' });

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await traffic.screenshot({
      path: `${OUT}/film-1706-details-open-dark.png`,
    });

    // The second state: the median card after its mode changes. Same rows,
    // a different question, so the sentence must change with it.
    const median = page.locator('[data-test="deep-dive-median"]');
    const before = await median
      .locator('[data-test="card-sentence"]')
      .textContent();

    await median.getByRole('button', { name: 'Views in period' }).click();
    await expect(median.locator('[data-test="card-sentence"]')).not.toHaveText(
      before ?? '',
    );
    await expect(median.locator('[data-test="card-figure"]')).toHaveText(
      EXPECTED['Median views per video'],
    );

    measured['median-second-state'] = {
      before,
      after: await median.locator('[data-test="card-sentence"]').textContent(),
      figure: await median.locator('[data-test="card-figure"]').textContent(),
    };
    await median.screenshot({
      path: `${OUT}/film-1706-median-second-state.png`,
    });

    writeFileSync(
      `${OUT}/film-1706-measured.json`,
      JSON.stringify({ expected: EXPECTED, measured }, null, 2),
    );
  });
});
