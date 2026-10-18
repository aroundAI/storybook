/**
 * The rows a morning report's figures are read from (FILM-1734): every
 * stored column of a video's days and snapshots, and a channel's days, as
 * stored. Nothing here sums across sources or fills a NULL; the reader in
 * `@kit/content-analytics/server/daily-figures` decides what a figure is.
 *
 * Every read takes the project ids its video ids belong to: they lead each
 * table's sort key, so they bound what is scanned. They are never the
 * access check — the caller has already proven the ids are the user's.
 */
import { concatByChunk } from './chunked';
import { getClickHouseClient, isClickHouseEnabled } from './client';
import type { ChannelMetricsDaily } from './types';

/** ClickHouse sends UInt64 as a string; NULL stays null, never 0. */
function figure(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export async function insertChannelMetricsDaily(
  rows: ChannelMetricsDaily[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  await getClickHouseClient().insert({
    table: 'channel_metrics_daily',
    values: rows,
    format: 'JSONEachRow',
  });
}

/** One `video_metrics` day, every figure column as stored. */
export interface VideoMetricDayRow {
  videoId: string;
  platform: string;
  date: string;
  metricSource: string;
  views: number | null;
  engagedViews: number | null;
  accountsReached: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reposts: number | null;
  watchTimeSeconds: number | null;
  avgViewDurationSeconds: number | null;
  avgViewPercentage: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  profileVisits: number | null;
  views3s: number | null;
  views3sOrganic: number | null;
  completeViews: number | null;
}

type VideoRange = {
  projectIds: string[];
  videoIds: string[];
  from: string;
  to: string;
};

const METRIC_COLUMNS = `
  video_id,
  toString(platform) AS platform,
  toString(metric_date) AS date,
  toString(metric_source) AS metric_source,
  views,
  engaged_views,
  accounts_reached,
  likes,
  dislikes,
  comments,
  shares,
  saves,
  reposts,
  watch_time_seconds,
  avg_view_duration_seconds,
  avg_view_percentage,
  subscribers_gained,
  subscribers_lost,
  profile_visits,
  views_3s,
  views_3s_organic,
  complete_views`;

type RawMetricRow = Record<string, string | number | null>;

function toMetricDay(row: RawMetricRow): VideoMetricDayRow {
  return {
    videoId: String(row.video_id),
    platform: String(row.platform),
    date: String(row.date),
    metricSource: String(row.metric_source),
    views: figure(row.views),
    engagedViews: figure(row.engaged_views),
    accountsReached: figure(row.accounts_reached),
    likes: figure(row.likes),
    dislikes: figure(row.dislikes),
    comments: figure(row.comments),
    shares: figure(row.shares),
    saves: figure(row.saves),
    reposts: figure(row.reposts),
    watchTimeSeconds: figure(row.watch_time_seconds),
    avgViewDurationSeconds: figure(row.avg_view_duration_seconds),
    avgViewPercentage: figure(row.avg_view_percentage),
    subscribersGained: figure(row.subscribers_gained),
    subscribersLost: figure(row.subscribers_lost),
    profileVisits: figure(row.profile_visits),
    views3s: figure(row.views_3s),
    views3sOrganic: figure(row.views_3s_organic),
    completeViews: figure(row.complete_views),
  };
}

/** Each video's `video_metrics` days in the range, one row a day. */
export async function queryVideoMetricDays(
  input: VideoRange,
): Promise<VideoMetricDayRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT ${METRIC_COLUMNS}
        FROM video_metrics FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND metric_date BETWEEN {from: Date} AND {to: Date}
        ORDER BY video_id, metric_date
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
    });

    return (await result.json<RawMetricRow>()).map(toMetricDay);
  });
}

/**
 * Each video's `video_metrics` days up to and including `to`, summed: the
 * figures that add up across days. Averages are not summed; they are
 * rebuilt from their definitions — duration is watch time over views, and
 * percentage viewed is weighted by each day's views. A sum over days none
 * of which measured a column is null (`count(col) = 0`), never 0.
 */
export interface VideoMetricTotalsRow {
  videoId: string;
  platform: string;
  lastDate: string;
  views: number | null;
  engagedViews: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  watchTimeSeconds: number | null;
  avgViewDurationSeconds: number | null;
  avgViewPercentage: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
}

const MEASURED_SUM = (column: string) =>
  `if(count(${column}) = 0, NULL, sum(${column})) AS ${column}`;

export async function queryVideoMetricTotals(input: {
  projectIds: string[];
  videoIds: string[];
  to: string;
}): Promise<VideoMetricTotalsRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT
          video_id,
          toString(any(platform)) AS platform,
          toString(max(metric_date)) AS last_date,
          ${MEASURED_SUM('views')},
          ${MEASURED_SUM('engaged_views')},
          ${MEASURED_SUM('likes')},
          ${MEASURED_SUM('dislikes')},
          ${MEASURED_SUM('comments')},
          ${MEASURED_SUM('shares')},
          ${MEASURED_SUM('watch_time_seconds')},
          ${MEASURED_SUM('subscribers_gained')},
          ${MEASURED_SUM('subscribers_lost')},
          if(sumIf(views, avg_view_percentage IS NOT NULL) = 0, NULL,
            sumIf(avg_view_percentage * views, avg_view_percentage IS NOT NULL)
              / sumIf(views, avg_view_percentage IS NOT NULL)) AS avg_view_percentage
        FROM video_metrics FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND metric_date <= {to: Date}
        GROUP BY video_id
        ORDER BY video_id
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
      clickhouse_settings: { prefer_column_name_to_alias: 1 },
    });

    return (await result.json<RawMetricRow>()).map((row) => {
      const views = figure(row.views);
      const watch = figure(row.watch_time_seconds);

      return {
        videoId: String(row.video_id),
        platform: String(row.platform),
        lastDate: String(row.last_date),
        views,
        engagedViews: figure(row.engaged_views),
        likes: figure(row.likes),
        dislikes: figure(row.dislikes),
        comments: figure(row.comments),
        shares: figure(row.shares),
        watchTimeSeconds: watch,
        avgViewDurationSeconds: views && watch !== null ? watch / views : null,
        avgViewPercentage: figure(row.avg_view_percentage),
        subscribersGained: figure(row.subscribers_gained),
        subscribersLost: figure(row.subscribers_lost),
      };
    });
  });
}

/** One `video_snapshots` row — a video's lifetime figures on one day. */
export interface VideoSnapshotRow {
  videoId: string;
  platform: string;
  date: string;
  fetchedAt: string;
  source: string;
  views: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reposts: number | null;
  watchTimeSeconds: number | null;
  subscribersGained: number | null;
  accountsReached: number | null;
  profileVisits: number | null;
  reelsAvgWatchTimeMs: number | null;
  reelsSkipRate: number | null;
  views3s: number | null;
  views3sOrganic: number | null;
  completeViews: number | null;
}

const SNAPSHOT_COLUMNS = `
  video_id,
  toString(platform) AS platform,
  toString(snapshot_date) AS date,
  toString(fetched_at) AS fetched,
  source,
  views,
  likes,
  dislikes,
  comments,
  shares,
  saves,
  reposts,
  watch_time_seconds,
  subscribers_gained,
  accounts_reached,
  profile_visits,
  ig_reels_avg_watch_time_ms,
  ig_reels_skip_rate,
  views_3s,
  views_3s_organic,
  complete_views`;

function toSnapshot(row: RawMetricRow): VideoSnapshotRow {
  return {
    videoId: String(row.video_id),
    platform: String(row.platform),
    date: String(row.date),
    fetchedAt: String(row.fetched),
    source: String(row.source),
    views: figure(row.views),
    likes: figure(row.likes),
    dislikes: figure(row.dislikes),
    comments: figure(row.comments),
    shares: figure(row.shares),
    saves: figure(row.saves),
    reposts: figure(row.reposts),
    watchTimeSeconds: figure(row.watch_time_seconds),
    subscribersGained: figure(row.subscribers_gained),
    accountsReached: figure(row.accounts_reached),
    profileVisits: figure(row.profile_visits),
    reelsAvgWatchTimeMs: figure(row.ig_reels_avg_watch_time_ms),
    reelsSkipRate: figure(row.ig_reels_skip_rate),
    views3s: figure(row.views_3s),
    views3sOrganic: figure(row.views_3s_organic),
    completeViews: figure(row.complete_views),
  };
}

/**
 * Each video's daily snapshots from `from` to `to`: one row a day, the
 * day's latest fetch (the table keeps one per day, `ReplacingMergeTree`).
 */
export async function queryVideoSnapshotDays(
  input: VideoRange,
): Promise<VideoSnapshotRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT ${SNAPSHOT_COLUMNS}
        FROM video_snapshots FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND snapshot_date BETWEEN {from: Date} AND {to: Date}
        ORDER BY video_id, snapshot_date
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
    });

    return (await result.json<RawMetricRow>()).map(toSnapshot);
  });
}

/**
 * Each video's latest snapshot fetched at or before `asOf`, whole — the
 * row's own values, NULLs included, never a column borrowed from an older
 * row (a bare `argMax` skips NULLs, migration 017).
 */
export async function queryLatestVideoSnapshots(input: {
  projectIds: string[];
  videoIds: string[];
  /** 'YYYY-MM-DD HH:MM:SS', UTC. */
  asOf: string;
}): Promise<VideoSnapshotRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT ${SNAPSHOT_COLUMNS}
        FROM video_snapshots FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND fetched_at <= {asOf: DateTime}
        ORDER BY video_id, fetched_at DESC
        LIMIT 1 BY video_id
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
    });

    return (await result.json<RawMetricRow>()).map(toSnapshot);
  });
}

/** One `video_reach_daily` day: YouTube's impressions and their CTR. */
export interface VideoReachDayRow {
  videoId: string;
  date: string;
  impressions: number;
  impressionsCtr: number;
}

export async function queryVideoReachDays(input: {
  projectIds: string[];
  videoIds: string[];
  from: string;
  to: string;
}): Promise<VideoReachDayRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT
          video_id,
          toString(metric_date) AS date,
          impressions,
          impressions_ctr
        FROM video_reach_daily FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND metric_date BETWEEN {from: Date} AND {to: Date}
        ORDER BY video_id, metric_date
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
    });

    return (await result.json<RawMetricRow>()).map((row) => ({
      videoId: String(row.video_id),
      date: String(row.date),
      impressions: Number(row.impressions),
      impressionsCtr: Number(row.impressions_ctr),
    }));
  });
}

/**
 * Each video's impressions up to and including `to`, and their CTR weighted
 * by impressions — the only way a CTR over several days is one CTR.
 */
export interface VideoReachTotalsRow {
  videoId: string;
  lastDate: string;
  impressions: number;
  impressionsCtr: number | null;
}

export async function queryVideoReachTotals(input: {
  projectIds: string[];
  videoIds: string[];
  to: string;
}): Promise<VideoReachTotalsRow[]> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  return concatByChunk(input.videoIds, async (videoIds) => {
    const result = await getClickHouseClient().query({
      query: `
        SELECT
          video_id,
          toString(max(metric_date)) AS last_date,
          sum(impressions) AS total_impressions,
          if(sum(impressions) = 0, NULL,
            sum(impressions * impressions_ctr) / sum(impressions)) AS weighted_ctr
        FROM video_reach_daily FINAL
        WHERE project_id IN {projectIds: Array(UUID)}
          AND video_id IN {videoIds: Array(String)}
          AND metric_date <= {to: Date}
        GROUP BY video_id
        ORDER BY video_id
      `,
      query_params: { ...input, videoIds },
      format: 'JSONEachRow',
    });

    return (await result.json<RawMetricRow>()).map((row) => ({
      videoId: String(row.video_id),
      lastDate: String(row.last_date),
      impressions: Number(row.total_impressions),
      impressionsCtr: figure(row.weighted_ctr),
    }));
  });
}

/** One `channel_metrics_daily` row, as stored. */
export interface ChannelMetricsDayRow {
  connectionId: string;
  platform: string;
  date: string;
  source: string;
  views: number | null;
  watchTimeSeconds: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  lifetimeViews: number | null;
  lifetimeSubscribers: number | null;
  lifetimeVideos: number | null;
}

type ChannelRange = {
  connectionIds: string[];
  from: string;
  to: string;
};

export async function queryChannelMetricsDays(
  input: ChannelRange,
): Promise<ChannelMetricsDayRow[]> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) return [];

  const result = await getClickHouseClient().query({
    query: `
      SELECT
        toString(connection_id) AS connection,
        toString(platform) AS platform,
        toString(metric_date) AS date,
        source,
        views,
        watch_time_seconds,
        likes,
        dislikes,
        comments,
        shares,
        subscribers_gained,
        subscribers_lost,
        lifetime_views,
        lifetime_subscribers,
        lifetime_videos
      FROM channel_metrics_daily FINAL
      WHERE connection_id IN {connectionIds: Array(UUID)}
        AND metric_date BETWEEN {from: Date} AND {to: Date}
      ORDER BY connection_id, metric_date, source
    `,
    query_params: input,
    format: 'JSONEachRow',
  });

  return (await result.json<RawMetricRow>()).map((row) => ({
    connectionId: String(row.connection),
    platform: String(row.platform),
    date: String(row.date),
    source: String(row.source),
    views: figure(row.views),
    watchTimeSeconds: figure(row.watch_time_seconds),
    likes: figure(row.likes),
    dislikes: figure(row.dislikes),
    comments: figure(row.comments),
    shares: figure(row.shares),
    subscribersGained: figure(row.subscribers_gained),
    subscribersLost: figure(row.subscribers_lost),
    lifetimeViews: figure(row.lifetime_views),
    lifetimeSubscribers: figure(row.lifetime_subscribers),
    lifetimeVideos: figure(row.lifetime_videos),
  }));
}

/** A channel's subscriber anchor for each day it was recorded. */
export interface ChannelSubscriberDayRow {
  connectionId: string;
  date: string;
  subscribers: number;
}

export async function queryChannelSubscriberDays(
  input: ChannelRange,
): Promise<ChannelSubscriberDayRow[]> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) return [];

  const result = await getClickHouseClient().query({
    query: `
      SELECT
        toString(connection_id) AS connection,
        toString(snapshot_date) AS date,
        subscriber_count
      FROM channel_subscribers FINAL
      WHERE connection_id IN {connectionIds: Array(UUID)}
        AND snapshot_date BETWEEN {from: Date} AND {to: Date}
      ORDER BY connection_id, snapshot_date
    `,
    query_params: input,
    format: 'JSONEachRow',
  });

  return (await result.json<RawMetricRow>()).map((row) => ({
    connectionId: String(row.connection),
    date: String(row.date),
    subscribers: Number(row.subscriber_count),
  }));
}
