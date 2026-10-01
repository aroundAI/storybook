import { Page, expect } from '@playwright/test';

import {
  clickHouseDate,
  insertClickHouse,
  seedVideoDims,
  seedVideoReach,
} from '../utils/clickhouse';
import type { SeededVideo } from '../utils/clickhouse';
import { seedPublishedEpisode, seedPublishedVideos } from '../utils/seed';
import {
  ChannelExperimentsPage,
  daysAgoIso,
  seedAssignment,
  seedRunningChannelExperiment,
} from './channel-experiments.po';

/**
 * A running experiment with figures in ClickHouse, every one worked out by
 * hand here rather than read back from the page.
 *
 * Two styles, started 45 days ago. Each mature video is 31–40 days old.
 *
 * | style        | views in days 0–6        | + day 10 | CTR, first 7 days |
 * |--------------|--------------------------|----------|-------------------|
 * | Mouth open   | 100 200 300 400 (+500 UI) | +1,000   | 5% on 1,000 impr. |
 * | Mouth closed | 1,000 1,100 1,200 1,300 1,400 | +0   | 10% on 1,000      |
 * | Mouth closed | one video published today: pending at 7 and 30 |       |
 *
 * Views at 7 days, before the fifth "Mouth open" video is assigned:
 *   open n=4 → no verdict, "Mouth open needs 1 more"; median 250.
 * After it (assigned through the page, at the table's suggestion):
 *   open   [100..500]       median 300,   range 200 – 400
 *   closed [1,000..1,400]   median 1,200, range 1,100 – 1,300
 *   → ranges apart: "Mouth closed is ahead of Mouth open".
 * Views at 30 days:
 *   open   [1,100..1,500]   median 1,300, range 1,200 – 1,400
 *   closed [1,000..1,400]   median 1,200, range 1,100 – 1,300
 *   → ranges overlap: "No clear difference yet", though the medians differ.
 * CTR: 5.0% against 10.0%, each range a single point: closed ahead.
 *
 * Quantiles interpolate at (n − 1)·p, as quantileExactInclusive does.
 */
export const EXPECTED = {
  thinOpenMedian: '250',
  open7: { median: '300', range: '200 – 400' },
  closed7: { median: '1,200', range: '1,100 – 1,300' },
  open30: { median: '1,300', range: '1,200 – 1,400' },
  closed30: { median: '1,200', range: '1,100 – 1,300' },
  openCtr: '5.0%',
  closedCtr: '10.0%',
};

export async function seedResultsScenario(
  page: Page,
  po: ChannelExperimentsPage,
) {
  const team = await po.setup();

  const openViews = [100, 200, 300, 400, 500];
  const closedViews = [1000, 1100, 1200, 1300, 1400];
  const titles = [
    ...openViews.map((_, i) => `Open ${i + 1}`),
    ...closedViews.map((_, i) => `Closed ${i + 1}`),
  ];

  // One day apart, 40 → 31 days old: every one past 30 days.
  const firstPublished = daysAgoIso(40);
  const mature = await seedPublishedVideos(
    team.projectId,
    team.connectionId,
    titles,
    firstPublished,
  );
  // Published now: younger than every checkpoint.
  const { publishId: young } = await seedPublishedEpisode(
    team.projectId,
    team.connectionId,
    { number: 1, title: 'Closed, new today' },
  );

  const experiment = await seedRunningChannelExperiment({
    accountId: team.accountId,
    connectionId: team.connectionId,
    title: 'Mouth open or closed',
    styles: ['Mouth open', 'Mouth closed'],
    measures: ['views', 'ctr'],
    startedAt: daysAgoIso(45).slice(0, 10),
  });
  const [open, closed] = experiment.styleIds as [string, string];

  const video = (publishId: string, publishedAt: string): SeededVideo => ({
    videoId: publishId,
    projectId: team.projectId,
    accountId: team.accountId,
    connectionId: team.connectionId,
    title: publishId,
    publishedAt: new Date(publishedAt),
  });

  const published = (index: number) =>
    new Date(Date.parse(firstPublished) + index * 86_400_000).toISOString();

  const videos = mature.map((id, index) => video(id, published(index)));
  await seedVideoDims([...videos, video(young, new Date().toISOString())]);

  const row = (seeded: SeededVideo, ageDays: number, views: number) => ({
    project_id: seeded.projectId,
    video_id: seeded.videoId,
    platform: 'youtube',
    metric_date: clickHouseDate(
      new Date(seeded.publishedAt.getTime() + ageDays * 86_400_000),
    ),
    views,
    // Both series carry the figure, so whichever FILM-1722 picks for the
    // experiment's dates, the answer above holds.
    engaged_views: views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: views * 60,
    revenue_cents: 0,
    subscribers_gained: 0,
    subscribers_lost: 0,
    avg_view_duration_seconds: 120,
    avg_view_percentage: 40,
    dislikes: 0,
  });

  await insertClickHouse('video_metrics', [
    ...videos
      .slice(0, 5)
      .flatMap((seeded, i) => [
        row(seeded, 1, openViews[i]!),
        row(seeded, 10, 1000),
      ]),
    ...videos.slice(5).map((seeded, i) => row(seeded, 1, closedViews[i]!)),
  ]);

  for (const [index, seeded] of videos.entries()) {
    await seedVideoReach(seeded, [
      { ageDays: 2, impressions: 1000, ctr: index < 5 ? 0.05 : 0.1 },
    ]);
  }

  // Four "open" and all "closed" assigned already; the fifth "open" is
  // assigned on the page.
  for (const [index, publishId] of mature.entries()) {
    if (index === 4) continue;
    await seedAssignment({
      experimentId: experiment.id,
      styleId: index < 5 ? open : closed,
      publishId,
      connectionId: team.connectionId,
    });
  }
  await seedAssignment({
    experimentId: experiment.id,
    styleId: closed,
    publishId: young,
    connectionId: team.connectionId,
  });

  await po.goTo(team.slug, experiment.id);
  await expect(po.inDetail('ce-results')).toBeVisible();

  return {
    team,
    experimentId: experiment.id,
    open,
    closed,
    fifthOpen: mature[4]!,
  };
}

/** A results cell's text. */
export function cell(
  page: Page,
  measure: string,
  checkpoint: number,
  styleId: string,
  part: string,
) {
  return page.locator(
    `[data-test="ce-cell-${measure}-${checkpoint}-${styleId}-${part}"]`,
  );
}
