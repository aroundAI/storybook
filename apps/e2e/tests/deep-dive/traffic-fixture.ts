import { Page } from '@playwright/test';

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

/**
 * FILM-1708's seed: one video's traffic over two weeks, 2,000 views, with
 * every share worked out by hand (the table is in traffic-drill-down.spec.ts).
 * Shared with the before/after evidence so both pictures show the same rows.
 */
export const EXPECTED_GROUPS = {
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

export type Group = keyof typeof EXPECTED_GROUPS;

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

export async function setup(page: Page, { backCatalog = false } = {}) {
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

  // For the before/after pictures only: an older video, so the median and
  // back-catalog charts have months to draw. No traffic rows, so the
  // breakdown's figures are unchanged.
  if (backCatalog) {
    const older = await seedPublishedEpisode(project.id, connectionId, {
      number: 2,
      seasonId,
    });
    const archive: SeededVideo = {
      ...video,
      videoId: older.publishId,
      title: 'Seeded Episode 2',
      publishedAt: daysAgo(200),
    };

    await seedVideoDims([archive]);
    await seedVideoMetricsBatch([
      {
        video: archive,
        days: [10, 40, 100, 130, 160, 190].map((ageDays, i) => ({
          ageDays,
          views: 300 + i * 150,
        })),
      },
    ]);
  }

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
