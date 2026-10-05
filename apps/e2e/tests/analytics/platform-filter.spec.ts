import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { ANALYTICS_PLATFORMS as EVERY_ANALYTICS_PLATFORM } from '../../../../packages/clickhouse/src/lib/data-provenance';
import { platformLabel } from '../../../../packages/features/content-analytics/src/lib/platform-labels';
import { isOfferedPlatform } from '../../../../packages/features/publishing/src/lib/platforms';
import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  insertClickHouse,
  seedVideoAudience,
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

/** The platforms the filter offers: X is hidden while `X_ENABLED` is off. */
const ANALYTICS_PLATFORMS = EVERY_ANALYTICS_PLATFORM.filter(isOfferedPlatform);

/**
 * FILM-1709 — the Platforms filter reaches every tab and the headline
 * figures.
 *
 * The guard tests hold whether or not the server reads ClickHouse (⚫️ Test
 * runs with it off): the selection survives tab switches, the Deep Dive's
 * switcher shows and sets the page's one selection, and no platform
 * selected says so instead of asking. With CLICKHOUSE_EVIDENCE the server
 * reads the seeded rows and every figure is read off the page, before and
 * after a platform is deselected, against this hand-computed fixture.
 *
 * | video | platform  | rows (days ago: views / likes) | country |
 * |-------|-----------|--------------------------------|---------|
 * | yt-1  | YouTube   | 10: 100 / 10 · 9: 20 / 2       | US 120  |
 * | tt-1  | TikTok    | 8: 300 / 30                    | —       |
 * | ig-1  | Instagram | 7: 40 / 3                      | BR 40   |
 * | ig-2  | Instagram | 6: 5 / 1                       | BR 5    |
 *
 * | selection             | Views | Likes | content | video log | en views | US / BR        |
 * |-----------------------|-------|-------|---------|-----------|----------|----------------|
 * | all three             | 465   | 46    | 4       | 4         | 465      | 72.7% / 27.3%  |
 * | TikTok deselected     | 165   | 16    | 3       | 3         | 165      | 72.7% / 27.3%  |
 * | YouTube deselected    | 345   | 34    |         |           |          | — / 100.0%     |
 * | TikTok alone          | 300   | 30    |         |           |          |                |
 *
 * All three = 120 + 300 + 45, the three single-platform totals (§7).
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const OBSERVED = Boolean(process.env.CLICKHOUSE_EVIDENCE);
const SLOW = { timeout: 60_000 };

type Platform = (typeof ANALYTICS_PLATFORMS)[number];

/**
 * The filter offers every analytics platform, all selected (FILM-1709), and
 * that list grows (Facebook with FILM-1720, X with FILM-1727): every
 * expectation about "the rest" is read from it, never written out here.
 */
const allBut = (...out: Platform[]) =>
  ANALYTICS_PLATFORMS.filter((platform) => !out.includes(platform));

const switcherText = (platforms: readonly Platform[]) =>
  platforms.map(platformLabel).join(' + ');

const ticks = (selected: readonly Platform[]) =>
  Object.fromEntries(
    ANALYTICS_PLATFORMS.map((platform) => [
      platform,
      selected.includes(platform) ? 'checked' : 'unchecked',
    ]),
  );

async function seedPage(page: Page) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const connections = {
    youtube: await seedYouTubeConnection(team.accountId, 'Seed Studio'),
    tiktok: await seedYouTubeConnection(team.accountId, '@seedstudio', {
      platform: 'tiktok',
    }),
    instagram: await seedYouTubeConnection(team.accountId, '@seed.studio', {
      platform: 'instagram',
    }),
  };

  const publish = async (
    number: number,
    title: string,
    platform: keyof typeof connections,
  ) => {
    const { publishId } = await seedPublishedEpisode(
      project.id,
      connections[platform],
      { number, seasonId, title, platform },
    );

    const video: SeededVideo = {
      videoId: publishId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connections[platform],
      title,
      publishedAt: daysAgo(12),
      platform,
    };

    return video;
  };

  const yt1 = await publish(1, 'yt-1', 'youtube');
  const tt1 = await publish(2, 'tt-1', 'tiktok');
  const ig1 = await publish(3, 'ig-1', 'instagram');
  const ig2 = await publish(4, 'ig-2', 'instagram');

  const row = (
    video: SeededVideo,
    ago: number,
    views: number,
    likes: number,
  ) => {
    const fetchDated = video.platform !== 'youtube';

    return {
      project_id: project.id,
      video_id: video.videoId,
      platform: video.platform,
      metric_date: clickHouseDate(daysAgo(ago)),
      views,
      likes,
      comments: 0,
      shares: 0,
      // What ingest writes where a platform does not measure it (KB-114).
      saves: fetchDated ? null : 0,
      watch_time_seconds: fetchDated ? null : views * 60,
      revenue_cents: 0,
      subscribers_gained: fetchDated ? null : 0,
      metric_source: fetchDated ? 'snapshot_delta' : 'analytics_api',
    };
  };

  if (OBSERVED) {
    await seedVideoDims([yt1, tt1, ig1, ig2]);
    await insertClickHouse('video_metrics', [
      row(yt1, 10, 100, 10),
      row(yt1, 9, 20, 2),
      row(tt1, 8, 300, 30),
      row(ig1, 7, 40, 3),
      row(ig2, 6, 5, 1),
    ]);
    await seedVideoAudience([
      { video: yt1, rows: [{ dimension: 'country', key: 'US', views: 120 }] },
      { video: ig1, rows: [{ dimension: 'country', key: 'BR', views: 40 }] },
      { video: ig2, rows: [{ dimension: 'country', key: 'BR', views: 5 }] },
    ]);
  }

  await signInAs(page, team);

  const url = `/home/${team.slug}/studio/${project.slug}/analytics`;

  await page.goto(url);
  await expect(byTest(page, 'metric-card-views')).toBeVisible(SLOW);

  return { url };
}

async function openTab(page: Page, tab: string) {
  await byTest(page, `analytics-tab-${tab}`).click();
  await expect(byTest(page, `analytics-tab-${tab}`)).toHaveAttribute(
    'data-state',
    'active',
  );
}

async function openFilter(page: Page) {
  const trigger = byTest(page, 'platform-filter-trigger');

  await trigger.focus();
  await page.keyboard.press('Enter');

  const options = byTest(page, 'platform-filter-options');

  await expect(options).toBeVisible();

  return options;
}

async function closeFilter(page: Page, options: Locator) {
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
}

/** Toggle platforms in the header filter, and close it. */
async function toggle(page: Page, ...platforms: Platform[]) {
  const options = await openFilter(page);

  for (const platform of platforms) {
    await byTest(options, `platform-filter-${platform}`)
      .locator('button[role="checkbox"]')
      .click();
  }

  await closeFilter(page, options);
}

/** What the header filter has ticked, read off its checkboxes. */
async function ticked(page: Page) {
  const options = await openFilter(page);
  const states: Record<string, string | null> = {};

  // Every analytics platform is offered and selected by default; the
  // seeded project has nothing on those beyond the three, so they add no
  // figure.
  for (const platform of ANALYTICS_PLATFORMS) {
    states[platform] = await byTest(options, `platform-filter-${platform}`)
      .locator('button[role="checkbox"]')
      .getAttribute('data-state');
  }

  await closeFilter(page, options);

  return states;
}

const metricValue = (page: Page, key: string) =>
  byTest(byTest(page, `metric-card-${key}`), 'metric-value');

test.describe('Platform filter completion (FILM-1709)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the selection survives tab switches, and the Deep Dive switcher is the same selection', async ({
    page,
  }) => {
    await seedPage(page);

    // Deselect TikTok on the Overview, then walk every tab and come back.
    await toggle(page, 'tiktok');

    for (const tab of ['audience', 'deep-dive', 'language', 'overview']) {
      await openTab(page, tab);
      await expect(byTest(page, 'platform-filter-trigger')).toContainText(
        String(allBut('tiktok').length),
      );
    }

    expect(await ticked(page)).toEqual(ticks(allBut('tiktok')));

    // The Deep Dive switcher shows the header's selection, named — not the
    // first.
    await openTab(page, 'deep-dive');

    const switcher = byTest(page, 'deep-dive-platform-switcher');

    await expect(switcher).toHaveText(switcherText(allBut('tiktok')));
    await expect(switcher).toHaveAttribute(
      'data-selection',
      allBut('tiktok').join(','),
    );

    // And sets it: TikTok alone, in the header too.
    await switcher.click();
    await byTest(page, 'deep-dive-platform-option-tiktok').click();
    await expect(switcher).toHaveText('TikTok');

    await openTab(page, 'overview');
    expect(await ticked(page)).toEqual(ticks(['tiktok']));

    // The second change, where state bugs hide: back to every platform.
    await openTab(page, 'deep-dive');
    await switcher.click();
    await byTest(page, 'deep-dive-platform-option-all').click();
    await expect(switcher).toHaveText('All platforms');
    await expect(byTest(page, 'platform-filter-trigger')).not.toContainText(
      /\d/,
    );
  });

  test('no platform selected says so, asks for nothing, and has a way back', async ({
    page,
  }) => {
    await seedPage(page);

    const options = await openFilter(page);

    await options.getByRole('button', { name: 'None' }).click();
    await closeFilter(page, options);

    const panel = byTest(page, 'analytics-no-platform-selected');

    await expect(panel).toContainText('No platform is selected in the filter.');

    // A headline figure dims with the reason and draws no digits — not 0.
    const views = byTest(page, 'metric-card-views');

    await expect(views).toHaveAttribute('data-dimmed', 'true');
    await expect(byTest(views, 'metric-unmeasured')).toHaveText(
      'No platform selected',
    );
    await expect(byTest(page, 'metric-value')).toHaveCount(0);

    // Every tab says it once, in place of its cards.
    for (const tab of ['content', 'audience', 'deep-dive', 'language']) {
      await openTab(page, tab);
      await expect(panel).toBeVisible();
      await expect(visible(page, '[data-card-shell="analytics"]')).toHaveCount(
        0,
      );
    }

    await byTest(page, 'analytics-select-all-platforms').click();
    await expect(panel).toHaveCount(0);
    await expect(views).not.toHaveAttribute('data-dimmed', 'true', SLOW);

    // Back to every platform's total. Without metric rows (⚫️ Test reads
    // no ClickHouse) no video has a view, so the total is null and says
    // "Not measured" — never 0 (KB-153, KB-162). That is
    // `metric-not-measured`; `metric-unmeasured` is the no-selection
    // reason above, and is gone once a platform is selected (KB-149).
    if (OBSERVED) {
      await expect(metricValue(page, 'views')).toBeVisible(SLOW);
    } else {
      await expect(byTest(views, 'metric-unmeasured')).toHaveCount(0);
      await expect(byTest(views, 'metric-not-measured')).toHaveText(
        'Not measured',
      );
      await expect(byTest(views, 'metric-value')).toHaveCount(0);
    }
  });
});

test.describe('Platform filter completion, measured (FILM-1709)', () => {
  test.skip(
    !OBSERVED,
    'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );
  test.describe.configure({ timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 1400 } });

  test('every figure moves with a deselected platform, read off the page', async ({
    page,
  }) => {
    const { url } = await seedPage(page);
    const measured: Record<string, Record<string, unknown>> = {};

    const headline = async () => ({
      views: await metricValue(page, 'views').textContent(),
      likes: await metricValue(page, 'likes').textContent(),
    });

    // ── Every platform ────────────────────────────────────────────────
    await expect(metricValue(page, 'views')).toHaveText('465', SLOW);
    await expect(metricValue(page, 'likes')).toHaveText('46');
    measured.all = await headline();

    await openTab(page, 'content');
    await expect(byTest(page, 'content-card')).toHaveCount(4, SLOW);

    await openTab(page, 'audience');

    const geography = byTest(page, 'audience-card-geography');

    await expect(
      byTest(byTest(geography, 'geography-row-US'), 'geography-share'),
    ).toHaveText('72.7%', SLOW);
    await expect(
      byTest(byTest(geography, 'geography-row-BR'), 'geography-share'),
    ).toHaveText('27.3%');

    await openTab(page, 'video-log');
    await expect(byTest(page, 'video-log-row')).toHaveCount(4, SLOW);

    await openTab(page, 'language');

    const english = byTest(page, 'language-row-en');

    await expect(byTest(english, 'language-row-views')).toHaveText('465', SLOW);

    // ── TikTok deselected, from the Language tab ─────────────────────
    await toggle(page, 'tiktok');

    await expect(byTest(english, 'language-row-views')).toHaveText('165', SLOW);
    await expect(metricValue(page, 'views')).toHaveText('165', SLOW);
    await expect(metricValue(page, 'likes')).toHaveText('16');
    measured.withoutTikTok = await headline();

    await openTab(page, 'video-log');
    await expect(byTest(page, 'video-log-row')).toHaveCount(3, SLOW);

    await openTab(page, 'content');
    await expect(byTest(page, 'content-card')).toHaveCount(3, SLOW);

    await openTab(page, 'deep-dive');
    await expect(byTest(page, 'deep-dive-platform-switcher')).toHaveText(
      switcherText(allBut('tiktok')),
    );

    // ── YouTube deselected instead: the audience splits move ──────────
    await toggle(page, 'tiktok', 'youtube');
    await openTab(page, 'audience');
    await expect(
      byTest(byTest(geography, 'geography-row-BR'), 'geography-share'),
    ).toHaveText('100.0%', SLOW);
    await expect(byTest(geography, 'geography-row-US')).toHaveCount(0);
    await expect(metricValue(page, 'views')).toHaveText('345', SLOW);
    measured.withoutYouTube = await headline();

    // ── TikTok alone ─────────────────────────────────────────────────
    await toggle(page, 'instagram');
    await expect(metricValue(page, 'views')).toHaveText('300', SLOW);
    await expect(metricValue(page, 'likes')).toHaveText('30');
    measured.tiktokOnly = await headline();

    // The two other singles, so the §7 sum is read off the page too.
    await toggle(page, 'tiktok', 'youtube');
    await expect(metricValue(page, 'views')).toHaveText('120', SLOW);
    measured.youtubeOnly = await headline();

    await toggle(page, 'youtube', 'instagram');
    await expect(metricValue(page, 'views')).toHaveText('45', SLOW);
    measured.instagramOnly = await headline();

    const singles = [
      measured.youtubeOnly!.views,
      measured.tiktokOnly!.views,
      measured.instagramOnly!.views,
    ].map(Number);

    expect(singles.reduce((sum, views) => sum + views, 0)).toBe(
      Number(measured.all!.views),
    );

    // ── Evidence: both themes, before and after ──────────────────────
    if (!process.env.CAPTURE_EVIDENCE) return;

    mkdirSync(OUT, { recursive: true });

    for (const theme of ['light', 'dark'] as const) {
      await page.goto(url);
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        theme,
      );
      await page.reload();

      await expect(metricValue(page, 'views')).toHaveText('465', SLOW);
      await expect(
        byTest(byTest(page, 'overview-views'), 'card-figure'),
      ).toBeVisible(SLOW);
      await page.screenshot({
        path: `${OUT}/film-1709-overview-all-${theme}.png`,
        animations: 'disabled',
      });

      await toggle(page, 'tiktok');
      await expect(metricValue(page, 'views')).toHaveText('165', SLOW);
      await page.screenshot({
        path: `${OUT}/film-1709-overview-without-tiktok-${theme}.png`,
        animations: 'disabled',
      });

      await openTab(page, 'deep-dive');
      await expect(byTest(page, 'deep-dive-platform-switcher')).toHaveText(
        switcherText(allBut('tiktok')),
      );
      await page.screenshot({
        path: `${OUT}/film-1709-deep-dive-two-platforms-${theme}.png`,
        animations: 'disabled',
      });

      // TikTok alone: a YouTube-only card dims, with why.
      await toggle(page, 'youtube', 'instagram', 'tiktok');
      await expect(byTest(page, 'deep-dive-traffic-breakdown')).toHaveAttribute(
        'data-dimmed',
        'true',
      );
      await page.screenshot({
        path: `${OUT}/film-1709-deep-dive-tiktok-${theme}.png`,
        animations: 'disabled',
      });

      const options = await openFilter(page);

      await options.getByRole('button', { name: 'None' }).click();
      await closeFilter(page, options);
      await expect(
        byTest(page, 'analytics-no-platform-selected'),
      ).toBeVisible();
      await page.screenshot({
        path: `${OUT}/film-1709-none-selected-${theme}.png`,
        animations: 'disabled',
      });
    }

    writeFileSync(
      `${OUT}/film-1709-measured.json`,
      JSON.stringify(measured, null, 2),
    );
  });
});
