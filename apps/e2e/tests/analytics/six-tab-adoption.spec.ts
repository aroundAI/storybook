import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  type SeededVideo,
  clickHouseDate,
  insertClickHouse,
  seedVideoDims,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-1707 — one card shell on every tab, and Deep Dive's date axes.
 *
 * The guard tests hold whether or not the server reads ClickHouse (⚫️ Test
 * runs with it off): every card on every tab carries a chip, the date-axis
 * cards name only what they plot, the one-time note and the switcher. With
 * CLICKHOUSE_EVIDENCE the server reads the seeded rows and the §2 figures
 * are read off the page against this hand-computed fixture.
 *
 * Two months, M0 and M1: the month before last, and last month.
 *
 * | video | platform | published | rows (day of month: views)        | source         |
 * |-------|----------|-----------|-----------------------------------|----------------|
 * | yt-a  | YouTube  | M0 10     | M0 11: 100 · M0 last: 50 · M1 1: 30 · M1 2: 20 | analytics_api |
 * | yt-b  | YouTube  | M1 5      | M1 6: 40                          | analytics_api  |
 * | tt-a  | TikTok   | M0 15     | M0 20: 500 · M1 4: 700            | snapshot_delta |
 *
 * tt-a was not fetched from M0 21 to M1 3 — a gap across the month
 * boundary — so the 700 it gained, much of it in M0, is dated M1 4.
 *
 * | figure                          | before (pooled)        | after (true-daily)   |
 * |---------------------------------|------------------------|----------------------|
 * | median by upload month, M0      | median of 200, 1,200 = 700 (2 videos) | 200 (1 video) |
 * | median of views in period, M0   | median of 150, 500 = 325 (2)          | 150 (1)       |
 * | median of views in period, M1   | median of 40, 50, 700 = 50 (3)        | 45 (2)        |
 * | rolling 90-day views (today)    | 1,440                  | 240                  |
 * | back catalog, views in M0 / M1  | 650 / 790              | 150 / 90             |
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const OBSERVED = Boolean(process.env.CLICKHOUSE_EVIDENCE);
const SLOW = { timeout: 60_000 };

const TABS = [
  'overview',
  'content',
  'audience',
  'deep-dive',
  'video-log',
  'language',
  'insights',
] as const;

const DATE_AXIS_CARDS = [
  'deep-dive-median',
  'deep-dive-rolling',
  'deep-dive-back-catalog',
  'deep-dive-cohorts',
] as const;

/** The matrix-derived sentence a date-axis card carries for a TikTok project. */
const LEFT_OUT =
  'TikTok isn’t shown here — it reports running totals, not daily views.';

function monthStart(monthsBack: number) {
  const date = new Date();

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsBack, 1),
  );
}

function day(month: Date, dayOfMonth: number) {
  return new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), dayOfMonth),
  );
}

function lastDay(month: Date) {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
}

async function seedPage(page: Page) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const youtube = await seedYouTubeConnection(team.accountId, 'Seed Studio');
  const tiktok = await seedYouTubeConnection(team.accountId, '@seedstudio', {
    platform: 'tiktok',
  });

  const [ytA, ytB, ttA] = await Promise.all([
    seedPublishedEpisode(project.id, youtube, {
      number: 1,
      seasonId,
      title: 'yt-a',
    }),
    seedPublishedEpisode(project.id, youtube, {
      number: 2,
      seasonId,
      title: 'yt-b',
    }),
    seedPublishedEpisode(project.id, tiktok, {
      number: 3,
      seasonId,
      title: 'tt-a',
      platform: 'tiktok',
    }),
  ]);

  const m0 = monthStart(2);
  const m1 = monthStart(1);

  const video = (
    publishId: string,
    title: string,
    connectionId: string,
    publishedAt: Date,
    platform: 'youtube' | 'tiktok',
  ): SeededVideo => ({
    videoId: publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title,
    publishedAt,
    platform,
  });

  const videos = {
    ytA: video(ytA.publishId, 'yt-a', youtube, day(m0, 10), 'youtube'),
    ytB: video(ytB.publishId, 'yt-b', youtube, day(m1, 5), 'youtube'),
    ttA: video(ttA.publishId, 'tt-a', tiktok, day(m0, 15), 'tiktok'),
  };

  const row = (
    seeded: SeededVideo,
    date: Date,
    views: number,
    source: 'analytics_api' | 'snapshot_delta',
  ) => ({
    project_id: project.id,
    video_id: seeded.videoId,
    platform: seeded.platform,
    metric_date: clickHouseDate(date),
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    // What ingest writes for TikTok: not measured is NULL (KB-114).
    saves: source === 'snapshot_delta' ? null : 0,
    watch_time_seconds: source === 'snapshot_delta' ? null : views * 60,
    revenue_cents: 0,
    subscribers_gained: source === 'snapshot_delta' ? null : 0,
    metric_source: source,
  });

  if (OBSERVED) {
    await seedVideoDims(Object.values(videos));
    await insertClickHouse('video_metrics', [
      row(videos.ytA, day(m0, 11), 100, 'analytics_api'),
      row(videos.ytA, lastDay(m0), 50, 'analytics_api'),
      row(videos.ytA, day(m1, 1), 30, 'analytics_api'),
      row(videos.ytA, day(m1, 2), 20, 'analytics_api'),
      row(videos.ytB, day(m1, 6), 40, 'analytics_api'),
      row(videos.ttA, day(m0, 20), 500, 'snapshot_delta'),
      row(videos.ttA, day(m1, 4), 700, 'snapshot_delta'),
    ]);
  }

  await signInAs(page, team);

  const url = `/home/${team.slug}/studio/${project.slug}/analytics`;

  await page.goto(url);

  return { url, m0, m1 };
}

async function openTab(page: Page, tab: (typeof TABS)[number]) {
  await byTest(page, `analytics-tab-${tab}`).click();
  await expect(byTest(page, `analytics-tab-${tab}`)).toHaveAttribute(
    'data-state',
    'active',
  );
}

/** Every card on screen: its family, its chip and the chip's label. */
async function readCards(page: Page) {
  return visible(page, '[data-card-shell="analytics"]').evaluateAll((cards) =>
    cards.map((card) => {
      const chips = card.querySelectorAll('[data-test="provenance-chip"]');

      return {
        card: card.getAttribute('data-test') ?? '',
        title: card.querySelector('h2')?.textContent ?? '',
        family: card.getAttribute('data-metric-family') ?? '',
        dateAxis: card.getAttribute('data-date-axis') === 'true',
        chips: chips.length,
        chip: chips[0]?.textContent ?? null,
        figure:
          card.querySelector('[data-test="card-figure"]')?.textContent ??
          card.querySelector('[data-test="card-no-figure"]')?.textContent ??
          null,
        scope:
          card.querySelector('[data-test="card-scope-note"]')?.textContent ??
          null,
      };
    }),
  );
}

const chipOf = (card: Locator) => byTest(card, 'provenance-chip').first();

/** Tabs whose cards are drawn whatever the data: the shell says what is missing. */
const ALWAYS_CARDS = ['overview', 'deep-dive', 'video-log', 'language'];

/**
 * A tab has drawn its cards: the first one on tabs that always have them,
 * and the requests settled on the others, which show an empty state of
 * their own when nothing was reported (Content, Audience) or wait on a
 * model (AI Insights).
 */
async function cardsDrawn(page: Page, tab: (typeof TABS)[number]) {
  if (ALWAYS_CARDS.includes(tab)) {
    await expect(
      visible(page, '[data-card-shell="analytics"]').first(),
    ).toBeVisible(SLOW);
  } else {
    await page.waitForLoadState('networkidle');
  }
}

test.describe('Six-tab adoption (FILM-1707)', () => {
  test('every card on every tab is the one shell, with a family and a chip', async ({
    page,
  }) => {
    await seedPage(page);

    const seen: Record<string, number> = {};

    for (const tab of TABS) {
      await openTab(page, tab);
      await cardsDrawn(page, tab);

      const cards = await readCards(page);

      seen[tab] = cards.length;

      for (const card of cards) {
        expect(card.chips, `${tab}: ${card.title}`).toBe(1);
        expect(card.family, `${tab}: ${card.title}`).not.toBe('');
      }
    }

    for (const tab of [
      'overview',
      'deep-dive',
      'video-log',
      'language',
    ] as const) {
      expect(seen[tab], `${tab} draws its cards on the shell`).toBeGreaterThan(
        0,
      );
    }
  });

  test('the Overview’s rule-built sentence is not chipped as measured or generated', async ({
    page,
  }) => {
    await seedPage(page);

    await expect(chipOf(byTest(page, 'overview-ai-insight'))).toHaveText(
      'Page summary',
      SLOW,
    );
  });

  test('Deep Dive: date axes name what they plot, a note says the figures moved, and the switcher scopes the tab', async ({
    page,
  }) => {
    const { url } = await seedPage(page);

    await openTab(page, 'deep-dive');

    for (const card of DATE_AXIS_CARDS) {
      const shell = byTest(page, card);

      await expect(shell).toHaveAttribute('data-date-axis', 'true', SLOW);
      // Never "2 of 3 platforms" on a card that plotted one.
      await expect(chipOf(shell)).toHaveText('YouTube only', SLOW);
      await expect(byTest(shell, 'card-scope-note')).toHaveText(LEFT_OUT);
    }

    // Traffic is not video_metrics: its chip is the matrix's, unchanged.
    await expect(
      chipOf(byTest(page, 'deep-dive-traffic-breakdown')),
    ).toHaveText('YouTube only');

    // The note, once, and dismissed for good in this browser.
    const note = byTest(page, 'deep-dive-date-axis-note');

    await expect(note).toBeVisible();
    await byTest(page, 'deep-dive-date-axis-note-dismiss').click();
    await expect(note).toHaveCount(0);

    await page.goto(url);
    await openTab(page, 'deep-dive');
    await expect(chipOf(byTest(page, 'deep-dive-median'))).toHaveText(
      'YouTube only',
      SLOW,
    );
    await expect(byTest(page, 'deep-dive-date-axis-note')).toHaveCount(0);

    // All platforms by default — not YouTube.
    const switcher = byTest(page, 'deep-dive-platform-switcher');

    await expect(switcher).toHaveText('All platforms');

    // TikTok alone: nothing true to put on a date axis, said as such.
    await switcher.click();

    // Every option is on screen and reachable once the page has settled:
    // the headline cards above used to grow by a screen while it was open.
    await expect(
      byTest(page, 'deep-dive-platform-option-facebook'),
    ).toBeInViewport();

    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({ path: `${OUT}/six-tab-deep-dive-switcher-open.png` });
    }

    await byTest(page, 'deep-dive-platform-option-tiktok').click();
    await expect(switcher).toHaveText('TikTok');

    for (const card of DATE_AXIS_CARDS) {
      const shell = byTest(page, card);

      await expect(chipOf(shell)).toHaveText('Not on a date axis');
      await expect(byTest(shell, 'card-no-figure')).toHaveText(
        'Not drawn for this platform.',
      );
    }

    // A YouTube-only card dims rather than blanks under a TikTok selection.
    await expect(byTest(page, 'deep-dive-traffic-breakdown')).toHaveAttribute(
      'data-dimmed',
      'true',
    );

    // And back: the switcher's second change is the one state bugs hide in.
    await switcher.click();
    await byTest(page, 'deep-dive-platform-option-all').click();
    await expect(switcher).toHaveText('All platforms');
    await expect(chipOf(byTest(page, 'deep-dive-median'))).toHaveText(
      'YouTube only',
    );
    // Whatever the rows say now, it is no longer the switcher's refusal.
    await expect(byTest(page, 'deep-dive-median')).not.toContainText(
      'Not drawn for this platform.',
    );
  });
});

test.describe('Six-tab adoption, measured (FILM-1707)', () => {
  test.skip(
    !OBSERVED,
    'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  /**
   * Each bar's accessible name, which carries its bucket's figures: since
   * FILM-1708 it is also the bar's hover detail, and there is no `title`.
   */
  async function barTitles(card: Locator) {
    return byTest(card, 'median-bar')
      .or(byTest(card, 'back-catalog-bar'))
      .evaluateAll((bars) => bars.map((bar) => bar.getAttribute('aria-label')));
  }

  test('Deep Dive’s date-axis figures are YouTube’s alone, read off the page', async ({
    page,
  }) => {
    const { m0, m1 } = await seedPage(page);

    await openTab(page, 'deep-dive');

    const median = byTest(page, 'deep-dive-median');
    const rolling = byTest(page, 'deep-dive-rolling');
    const backCatalog = byTest(page, 'deep-dive-back-catalog');

    // Read everything first and record it, then assert: the same test
    // records the pooled figures when run against the queries before §2
    // (MEASURED_AS=before), where the assertions below are expected to fail.
    await expect(byTest(rolling, 'card-figure')).toBeVisible(SLOW);
    await expect.poll(() => barTitles(median), SLOW).toHaveLength(2);
    await expect.poll(() => barTitles(backCatalog), SLOW).toHaveLength(2);

    const rollingFigure = await byTest(rolling, 'card-figure').textContent();
    const byUpload = await barTitles(median);
    const catalog = await barTitles(backCatalog);

    await byTest(page, 'median-mode-period').click();
    // Two bars again, and not the upload-month ones: the skeleton between
    // has none.
    await expect
      .poll(async () => {
        const titles = await barTitles(median);

        return titles.length === 2 && titles.join('|') !== byUpload.join('|');
      }, SLOW)
      .toBe(true);

    const byPeriod = await barTitles(median);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      `${OUT}/film-1707-measured-${process.env.MEASURED_AS ?? 'after'}.json`,
      JSON.stringify(
        {
          months: { m0: clickHouseDate(m0), m1: clickHouseDate(m1) },
          rolling: rollingFigure,
          medianByUpload: byUpload,
          medianByPeriod: byPeriod,
          backCatalog: catalog,
          marks: await byTest(page, 'view-definition-mark').evaluateAll(
            (marks) =>
              marks.map((mark) => ({
                date: mark.getAttribute('data-date'),
                text: mark.textContent,
              })),
          ),
          cards: await readCards(page),
        },
        null,
        2,
      ),
    );

    // Rolling 90-day views: 100 + 50 + 30 + 20 + 40; pooled it was 1,440.
    expect(rollingFigure).toBe('240');
    // Median by upload month: M0 is yt-a alone, 200; pooled, 700 of two.
    expect(byUpload).toEqual([
      expect.stringMatching(/median 200, mean 200 \(1 videos\)$/),
      expect.stringMatching(/median 40, mean 40 \(1 videos\)$/),
    ]);
    // Views in period: M0 150 (pooled 325 of two); M1 45 of two (pooled
    // 50 of three — the gap's 700 dated to M1).
    expect(byPeriod).toEqual([
      expect.stringMatching(/median 150, mean 150 \(1 videos\)$/),
      expect.stringMatching(/median 45, mean 45 \(2 videos\)$/),
    ]);
    // Back catalog: every view in the denominator is YouTube's.
    expect(catalog).toEqual([
      expect.stringMatching(/of 150 views$/),
      expect.stringMatching(/of 90 views$/),
    ]);
  });

  test('a content card shows its platform once, in the chip', async ({
    page,
  }) => {
    await seedPage(page);
    await openTab(page, 'content');

    const cards = byTest(page, 'content-card');

    // Those the header's 30-day window lists; at least last month's upload.
    await expect(cards.first()).toBeVisible(SLOW);

    for (const card of await cards.all()) {
      const text = (await card.textContent()) ?? '';
      const chip = (await chipOf(card).textContent()) ?? '';
      const platform = chip.startsWith('TikTok') ? 'TikTok' : 'YouTube';

      expect(text.split(platform).length - 1, text).toBe(1);
    }
  });
});

test.describe('Six-tab adoption evidence (FILM-1707)', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !OBSERVED,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test('all seven tabs, in both themes', async ({ page }) => {
    test.setTimeout(240_000);

    // Tall enough for a tab's cards, which scroll inside the page's own
    // container rather than the window.
    await page.setViewportSize({ width: 1440, height: 2600 });

    const { url } = await seedPage(page);

    mkdirSync(OUT, { recursive: true });

    for (const theme of ['light', 'dark'] as const) {
      await page.goto(url);
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        theme,
      );
      await page.reload();

      for (const tab of TABS) {
        await openTab(page, tab);

        if (tab === 'deep-dive') {
          await expect(
            byTest(byTest(page, 'deep-dive-rolling'), 'card-figure'),
          ).toHaveText('240', SLOW);
        } else {
          await cardsDrawn(page, tab);
        }

        await page.screenshot({
          path: `${OUT}/film-1707-${tab}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  });
});
