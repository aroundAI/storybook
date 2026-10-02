import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  insertClickHouse,
} from '../utils/clickhouse';
import { byTest } from '../utils/visible';
import { ReachFixture, ReachPageObject } from './reach.po';

/**
 * The reach page's figures, from hand-computed ClickHouse rows, and the PR
 * screenshots (cross-platform reach design, approved 2026-09-28).
 *
 * Needs ClickHouse: skipped unless CAPTURE_EVIDENCE and CLICKHOUSE_EVIDENCE
 * are set, as the 🧬 E2E evidence job sets them.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function seed(fixture: ReachFixture) {
  const yesterday = daysAgo(1);
  const dayBefore = daysAgo(2);
  const ig = fixture.instagram;
  const window = (
    asOf: Date,
    windowDays: number,
    reached: number,
    split: [number, number] | null = null,
  ) => ({
    connection_id: ig.connectionId,
    platform: 'instagram',
    as_of: clickHouseDate(asOf),
    window_days: windowDays,
    accounts_reached: reached,
    accounts_reached_followers: split?.[0] ?? null,
    accounts_reached_non_followers: split?.[1] ?? null,
    source: 'e2e',
    inserted_at: clickHouseDateTime(new Date()),
  });

  await insertClickHouse('channel_windows', [
    window(yesterday, 7, 60, [20, 40]),
    window(yesterday, 30, 170),
    window(yesterday, 23, 130),
    window(dayBefore, 30, 160),
  ]);

  const metric = (
    videoId: string,
    platform: string,
    date: Date,
    counts: { views: number; comments: number; shares: number },
    accountsReached: number | null,
  ) => ({
    project_id: fixture.projectId,
    video_id: videoId,
    platform,
    metric_date: clickHouseDate(date),
    views: counts.views,
    likes: 0,
    comments: counts.comments,
    shares: counts.shares,
    saves: 0,
    watch_time_seconds: null,
    subscribers_gained: null,
    metric_source: platform === 'youtube' ? 'analytics_api' : 'snapshot_delta',
    accounts_reached: accountsReached,
    extra_metrics: '{}',
  });

  await insertClickHouse('video_metrics', [
    metric(
      ig.postId,
      'instagram',
      yesterday,
      { views: 100, comments: 3, shares: 2 },
      80,
    ),
    metric(
      ig.postId,
      'instagram',
      dayBefore,
      { views: 50, comments: 1, shares: 0 },
      40,
    ),
    metric(
      fixture.youtube.videoId,
      'youtube',
      yesterday,
      { views: 1000, comments: 10, shares: 5 },
      null,
    ),
  ]);

  await insertClickHouse('video_snapshots', [
    {
      project_id: fixture.projectId,
      video_id: ig.postId,
      platform: 'instagram',
      snapshot_date: clickHouseDate(yesterday),
      views: 150,
      likes: 0,
      comments: 4,
      shares: 2,
      saves: 0,
      watch_time_seconds: 0,
      subscribers_gained: 0,
      accounts_reached: 400,
    },
  ]);
}

async function shoot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/reach-${name}.png`, fullPage: true });
}

test.describe('Reach page — figures and evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.use({ viewport: { width: 1440, height: 1400 } });

  test('every window, tab and view shows the hand-computed figure', async ({
    page,
  }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup();
    await seed(fixture);

    const ig = reach.channel(fixture.instagram.connectionId);
    const readings: Record<string, string | null> = {};

    // 7 days, All platforms. Counts add up: 100 + 50 + 1000 views.
    await reach.open(fixture.team, { window: 7 });
    await expect(reach.count('views')).toHaveText('1,150');
    await expect(reach.count('comments')).toHaveText('14');
    await expect(reach.count('shares')).toHaveText('7');
    await expect(byTest(ig, 'channel-reach-value')).toHaveText('60');
    // 170 − 130: seen this week, not in the 23 days before.
    await expect(byTest(ig, 'channel-new-accounts')).toContainText('40');
    await expect(reach.channel(fixture.youtube.connectionId)).toContainText(
      'Not measured',
    );
    readings.all7 = await byTest(page, 'reach-overview').innerText();
    await shoot(page, '01-all-7-days');

    // The Instagram tab adds the follower split.
    await reach.open(fixture.team, { tab: 'instagram', window: 7 });
    await expect(byTest(ig, 'channel-reach-split')).toHaveText(
      'Followers: 20 · Not following: 40',
    );
    await expect(reach.count('views')).toHaveText('150');
    await shoot(page, '02-instagram-7-days');

    // 30 days: a different recorded figure, and its history.
    await reach.open(fixture.team, { window: 30 });
    await expect(byTest(ig, 'channel-reach-value')).toHaveText('170');
    await expect(byTest(page, 'reach-history')).toBeVisible();
    await shoot(page, '03-all-30-days');

    // 90 days: counts still add up; unique reach is not measured.
    await reach.open(fixture.team, { window: 90 });
    await expect(reach.count('views')).toHaveText('1,150');
    await expect(byTest(ig, 'channel-reach-reason')).toHaveText(
      /longest unique-reach window is 30 days/,
    );
    await shoot(page, '04-all-90-days');

    // Posts, 7 days: 80 + 40 first-time viewers; Meta's lifetime 400.
    await reach.open(fixture.team, { view: 'posts', window: 7 });
    const reel = reach.postRow('Harbour reel');
    await expect(byTest(reel, 'reach-post-new')).toHaveText('120');
    await expect(byTest(reel, 'reach-post-lifetime')).toHaveText('400');
    await expect(
      byTest(reach.postRow('Harbour long cut'), 'reach-post-new'),
    ).toHaveText('Not measured');
    readings.posts7 = await byTest(page, 'reach-posts').innerText();
    await shoot(page, '05-posts-7-days');

    writeFileSync(
      `${OUT}/reach-measured.json`,
      JSON.stringify(readings, null, 2),
    );
  });

  test('a Facebook reel adds nothing to views, and says why (FILM-1720)', async ({
    page,
  }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup({ facebook: true });
    await seed(fixture);

    const facebook = fixture.facebook!;
    const yesterday = daysAgo(1);

    // Facebook writes NULL views (migration 020): 900 first plays and 500
    // three-second views are its own columns, and are not views.
    await insertClickHouse('video_metrics', [
      {
        project_id: fixture.projectId,
        video_id: facebook.postId,
        platform: 'facebook',
        metric_date: clickHouseDate(yesterday),
        views: null,
        likes: 7,
        comments: 4,
        shares: 1,
        saves: null,
        watch_time_seconds: 300,
        subscribers_gained: 2,
        metric_source: 'snapshot_delta',
        accounts_reached: 600,
        plays: 900,
        views_3s: 500,
        views_3s_organic: 400,
        views_3s_paid: 100,
        extra_metrics: '{}',
      },
    ]);

    const readings: Record<string, string | null> = {};

    // All platforms: views stay 100 + 50 + 1000; comments and shares add
    // the reel's 4 and 1 (14 + 4, 7 + 1).
    await reach.open(fixture.team, { window: 7 });
    await expect(reach.count('views')).toHaveText('1,150');
    await expect(reach.count('comments')).toHaveText('18');
    await expect(reach.count('shares')).toHaveText('8');
    await expect(
      byTest(byTest(page, 'reach-count-views'), 'reach-views-not-measured'),
    ).toHaveText('Not measured');
    readings.all7 = await byTest(page, 'reach-overview').innerText();
    await shoot(page, '06-facebook-all-7-days');

    // The Facebook tab: no views figure, the reason in its place.
    await reach.open(fixture.team, { tab: 'facebook', window: 7 });
    await expect(
      byTest(byTest(page, 'reach-count-views'), 'reach-count-reason'),
    ).toHaveText(/four different kinds of view/);
    await expect(reach.count('comments')).toHaveText('4');
    // Connected without Page insights: never read, and it says so.
    await expect(
      byTest(reach.channel(facebook.connectionId), 'channel-reach-reason'),
    ).toHaveText(/connected without permission to read its insights/);
    readings.facebook7 = await byTest(page, 'reach-overview').innerText();
    await shoot(page, '07-facebook-tab-7-days');

    // Posts: the reel's views are not measured; its 600 people are.
    await reach.open(fixture.team, { view: 'posts', window: 7 });
    const reel = reach.postRow('Harbour Facebook reel');
    await expect(byTest(reel, 'reach-views-not-measured')).toHaveText(
      'Not measured',
    );
    await expect(byTest(reel, 'reach-post-new')).toHaveText('600');
    readings.posts7 = await byTest(page, 'reach-posts').innerText();
    await shoot(page, '08-facebook-posts-7-days');

    writeFileSync(
      `${OUT}/reach-facebook-measured.json`,
      JSON.stringify(readings, null, 2),
    );
  });

  test("a Page's own reach, for the windows Facebook has (FILM-1720)", async ({
    page,
  }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup({
      facebook: { scopes: ['read_insights', 'pages_read_engagement'] },
    });
    await seed(fixture);

    const facebook = fixture.facebook!;
    const yesterday = daysAgo(1);

    // page_total_media_view_unique for the day, week and 28 days.
    await insertClickHouse(
      'channel_windows',
      [
        [1, 60],
        [7, 250],
        [28, 900],
      ].map(([windowDays, reached]) => ({
        connection_id: facebook.connectionId,
        platform: 'facebook',
        as_of: clickHouseDate(yesterday),
        window_days: windowDays,
        accounts_reached: reached,
        accounts_reached_followers: null,
        accounts_reached_non_followers: null,
        source: 'fb_page_insights',
        inserted_at: clickHouseDateTime(new Date()),
      })),
    );

    const readings: Record<string, string | null> = {};
    const card = reach.channel(facebook.connectionId);

    await reach.open(fixture.team, { tab: 'facebook', window: 7 });
    await expect(byTest(card, 'channel-reach-value')).toHaveText('250');
    // Meta splits plays by follower, not people: no split is shown.
    await expect(byTest(card, 'channel-reach-split')).toHaveCount(0);
    await expect(byTest(card, 'channel-reach-split-reason')).toHaveText(
      /does not split these viewers/,
    );
    readings.facebook7 = await byTest(page, 'reach-overview').innerText();
    await shoot(page, '09-facebook-page-7-days');

    // No 30-day window exists, and 28 days is not 30.
    await reach.open(fixture.team, { tab: 'facebook', window: 30 });
    await expect(byTest(card, 'channel-reach-reason')).toHaveText(
      /over a day, 7 days or 28 days, not 30/,
    );
    readings.facebook30 = await byTest(page, 'reach-overview').innerText();
    await shoot(page, '10-facebook-page-30-days');

    writeFileSync(
      `${OUT}/reach-facebook-page.json`,
      JSON.stringify(readings, null, 2),
    );
  });
});
