import {
  type SeededVideo,
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  insertClickHouse,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import {
  type SeededTeam,
  insertRow,
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';

/**
 * FILM-1726 fixtures: two teams, one whose YouTube channel holds the
 * monetary scope and one whose channels cannot report earnings.
 *
 * | Team        | Channel                          | Video            | Views | Revenue rows |
 * |-------------|----------------------------------|------------------|-------|--------------|
 * | measured    | YouTube, monetary scope held     | episode 1 (long) | 1,000 | 1,234¢       |
 * | measured    | same                             | episode 2 (short)| 500   | 66¢          |
 * | unmeasured  | YouTube, connected before it     | episode 1 (long) | 800   | none         |
 * | unmeasured  | YouTube, scope held, not in YPP  | (no video)       |       |              |
 * | unmeasured  | TikTok                           | episode 2 (short)| 400   | none         |
 *
 * Hand-computed answers are in `MONETISATION_EXPECTED`.
 */
const YOUTUBE_READ = 'https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_ANALYTICS =
  'https://www.googleapis.com/auth/yt-analytics.readonly';
const YOUTUBE_MONETARY =
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';

export const MONETISATION_EXPECTED = {
  measured: {
    // 1,234 + 66 = 1,300¢, shown in whole dollars by the card.
    projectCard: '$13',
    // Episode 1 alone: 1,234¢.
    episodeHeader: '$12.34',
    episodeCard: '$12',
    // The short: 66¢ over 500 views = 0.132¢ a view = $0.0013.
    roiRevenuePerView: '$0.0013',
    // The experiment's own snapshots: 1,000¢ before, 1,300¢ after.
    experimentDelta: '1,000 → 1,300',
  },
  unmeasured: {
    figure: 'Not measured',
    reasons: [
      'This account was connected before we asked for permission to read its earnings. Reconnect it to grant that permission.',
      'YouTube only reports earnings for channels in the YouTube Partner Program, so there is nothing to show until your channel joins it.',
      'TikTok does not report what a video earned, so TikTok revenue is only what you enter yourself.',
    ],
  },
} as const;

export interface MonetisationTeam {
  team: SeededTeam;
  projectSlug: string;
  episodeSlug: string;
  experimentId: string;
}

function dim(
  video: SeededVideo,
  contentType: 'long' | 'short',
  platform: 'youtube' | 'tiktok',
) {
  return {
    video_id: video.videoId,
    project_id: video.projectId,
    account_id: video.accountId,
    connection_id: video.connectionId,
    episode_id: '00000000-0000-0000-0000-000000000000',
    platform,
    content_type: contentType,
    language: 'en',
    channel_language: 'en',
    title: video.title,
    published_at: clickHouseDateTime(video.publishedAt),
    episode_duration_seconds: 600,
    asset_duration_seconds: contentType === 'short' ? 45 : 600,
    tags: [],
    updated_at: clickHouseDateTime(new Date()),
  };
}

async function seedConcludedExperiment(
  accountId: string,
  before: number | null,
  after: number | null,
) {
  const totals = (revenueCents: number | null) => ({
    views: 1_000,
    likes: 10,
    comments: 2,
    shares: 1,
    watchTimeSeconds: 60_000,
    revenueCents,
  });

  const row = await insertRow<{ id: string }>(
    'analytics_experiments',
    {
      account_id: accountId,
      title: 'Earnings snapshot',
      change_description: 'Seeded experiment',
      status: 'concluded',
      outcome_status: 'inconclusive',
      started_at: clickHouseDate(daysAgo(40)),
      ended_at: clickHouseDate(daysAgo(1)),
      review_window_days: 30,
      baseline_metrics: { publishCount: 1, totals: totals(before) },
      result_metrics: { publishCount: 1, totals: totals(after) },
    },
    serviceRoleAuth(),
  );

  return row.id;
}

/** The team whose YouTube channel reports earnings. */
export async function seedMeasuredTeam(): Promise<MonetisationTeam> {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const connectionId = await seedYouTubeConnection(team.accountId, 'Partner', {
    scopes: [YOUTUBE_READ, YOUTUBE_ANALYTICS, YOUTUBE_MONETARY],
  });

  const long = await seedPublishedEpisode(project.id, connectionId, {
    number: 1,
    seasonId,
    title: 'Long video',
  });
  const short = await seedPublishedEpisode(project.id, connectionId, {
    number: 2,
    seasonId,
    title: 'Short video',
    contentType: 'short',
    assetDurationSeconds: 45,
  });

  const video = (publishId: string, title: string): SeededVideo => ({
    videoId: publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId,
    title,
    publishedAt: daysAgo(10),
  });
  const longVideo = video(long.publishId, 'Long video');
  const shortVideo = video(short.publishId, 'Short video');

  await insertClickHouse('video_dim', [
    dim(longVideo, 'long', 'youtube'),
    dim(shortVideo, 'short', 'youtube'),
  ]);
  await seedVideoMetricsBatch([
    { video: longVideo, days: [{ ageDays: 5, views: 1_000 }] },
    { video: shortVideo, days: [{ ageDays: 5, views: 500 }] },
  ]);

  const metricDate = clickHouseDate(
    new Date(longVideo.publishedAt.getTime() + 5 * 86_400_000),
  );
  await insertClickHouse('video_revenue_daily', [
    {
      project_id: project.id,
      video_id: long.publishId,
      platform: 'youtube',
      metric_date: metricDate,
      revenue_cents: 1_234,
    },
    {
      project_id: project.id,
      video_id: short.publishId,
      platform: 'youtube',
      metric_date: metricDate,
      revenue_cents: 66,
    },
  ]);

  return {
    team,
    projectSlug: project.slug,
    episodeSlug: long.episodeSlug,
    experimentId: await seedConcludedExperiment(team.accountId, 1_000, 1_300),
  };
}

/** The team none of whose channels can report earnings, each for its own reason. */
export async function seedUnmeasuredTeam(): Promise<MonetisationTeam> {
  const team = await seedTeamAccount();
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);

  const youtube = await seedYouTubeConnection(team.accountId, 'Old channel', {
    scopes: [YOUTUBE_READ, YOUTUBE_ANALYTICS],
  });
  await seedYouTubeConnection(team.accountId, 'Not in YPP', {
    scopes: [YOUTUBE_READ, YOUTUBE_ANALYTICS, YOUTUBE_MONETARY],
    metadata: { analytics_account_gated: ['youtube.revenue'] },
  });
  const tiktok = await seedYouTubeConnection(team.accountId, 'TikTok', {
    platform: 'tiktok',
    scopes: ['user.info.basic', 'video.list', 'user.info.stats'],
  });

  const long = await seedPublishedEpisode(project.id, youtube, {
    number: 1,
    seasonId,
    title: 'Long video',
  });
  const short = await seedPublishedEpisode(project.id, tiktok, {
    number: 2,
    seasonId,
    title: 'TikTok video',
    platform: 'tiktok',
    contentType: 'short',
    assetDurationSeconds: 45,
  });

  const longVideo: SeededVideo = {
    videoId: long.publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId: youtube,
    title: 'Long video',
    publishedAt: daysAgo(10),
  };
  const shortVideo: SeededVideo = {
    videoId: short.publishId,
    projectId: project.id,
    accountId: team.accountId,
    connectionId: tiktok,
    title: 'TikTok video',
    publishedAt: daysAgo(10),
    platform: 'tiktok',
  };

  await insertClickHouse('video_dim', [
    dim(longVideo, 'long', 'youtube'),
    dim(shortVideo, 'short', 'tiktok'),
  ]);
  await seedVideoMetricsBatch([
    { video: longVideo, days: [{ ageDays: 5, views: 800 }] },
    { video: shortVideo, days: [{ ageDays: 5, views: 400 }] },
  ]);

  return {
    team,
    projectSlug: project.slug,
    episodeSlug: long.episodeSlug,
    experimentId: await seedConcludedExperiment(team.accountId, null, null),
  };
}
