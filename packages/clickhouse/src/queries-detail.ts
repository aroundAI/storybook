/**
 * Detail queries for the extended-metrics tables (FILM-1505):
 * retention curves, audience breakdowns, and traffic sources.
 */
import { getClickHouseClient, isClickHouseEnabled } from './client';
import type {
  AudienceDimension,
  RetentionCurvePoint,
  VideoAudienceRow,
} from './types';

/**
 * Insert retention curve points (latest fetch wins per point).
 */
export async function insertRetentionCurves(
  points: RetentionCurvePoint[],
): Promise<void> {
  if (points.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_retention_curves',
    values: points,
    format: 'JSONEachRow',
  });
}

/**
 * Insert audience breakdown rows (latest fetch wins per key).
 */
export async function insertVideoAudience(
  rows: VideoAudienceRow[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_audience',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * The latest retention curve for a video, sorted by position.
 */
export async function queryRetentionCurve(input: {
  videoId: string;
}): Promise<Array<{ elapsedRatio: number; audienceWatchRatio: number }>> {
  if (!isClickHouseEnabled()) return [];

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        elapsed_ratio,
        argMax(audience_watch_ratio, fetched_at) as audience_watch_ratio
      FROM video_retention_curves
      WHERE video_id = {videoId: String}
      GROUP BY elapsed_ratio
      ORDER BY elapsed_ratio ASC
    `,
    query_params: { videoId: input.videoId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    elapsed_ratio: number;
    audience_watch_ratio: number;
  }>();

  return rows.map((row) => ({
    elapsedRatio: Number(row.elapsed_ratio),
    audienceWatchRatio: Number(row.audience_watch_ratio),
  }));
}

/**
 * Latest audience breakdown rows per (video, key) for one dimension.
 * Callers aggregate across videos, typically weighting percentages by
 * each video's view totals.
 */
export async function queryAudienceRows(input: {
  videoIds: string[];
  dimension: AudienceDimension;
}): Promise<
  Array<{ videoId: string; key: string; views: number; percentage: number }>
> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        video_id,
        key,
        argMax(views, fetched_at) as views,
        argMax(percentage, fetched_at) as percentage
      FROM video_audience
      WHERE video_id IN {videoIds: Array(String)}
        AND dimension = {dimension: String}
      GROUP BY video_id, key
    `,
    query_params: { videoIds: input.videoIds, dimension: input.dimension },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    video_id: string;
    key: string;
    views: number;
    percentage: number;
  }>();

  return rows.map((row) => ({
    videoId: row.video_id,
    key: row.key,
    views: Number(row.views),
    percentage: Number(row.percentage),
  }));
}

/** Per-video packaging and quality metrics for a period. */
export interface VideoQualityMetrics {
  impressions: number;
  /** View-weighted click-through rate, 0..1. */
  impressionsCtr: number;
  engagedViews: number;
  /** View-weighted average view duration, seconds. */
  avgViewDurationSeconds: number;
  /** View-weighted average view percentage, 0..100. */
  avgViewPercentage: number;
}

/**
 * Packaging and quality metrics per video: thumbnail impressions and CTR
 * from the Reporting API, plus average view duration from the daily
 * metrics. These are the weekly-diagnostic numbers (did the packaging
 * fail, did the intro fail) and the previously-empty report columns.
 */
export async function queryQualityMetricsForVideos(input: {
  videoIds: string[];
  startDate?: string;
  endDate?: string;
}): Promise<Map<string, VideoQualityMetrics>> {
  const result = new Map<string, VideoQualityMetrics>();

  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return result;

  const client = getClickHouseClient();
  const params: Record<string, unknown> = { videoIds: input.videoIds };
  const bounds: string[] = [];

  if (input.startDate) {
    bounds.push('metric_date >= {startDate: Date}');
    params.startDate = input.startDate;
  }
  if (input.endDate) {
    bounds.push('metric_date <= {endDate: Date}');
    params.endDate = input.endDate;
  }

  const where = bounds.length > 0 ? `AND ${bounds.join(' AND ')}` : '';

  // Reach and daily metrics live in separate tables; join per video so a
  // video missing reach data still reports its duration metrics.
  const query = `
    SELECT
      video_id,
      sum(impressions) as impressions,
      sum(ctr_weighted) as ctr_weighted,
      sum(engaged_views) as engaged_views,
      sum(views) as views,
      sum(avd_weighted) as avd_weighted,
      sum(avp_weighted) as avp_weighted
    FROM (
      SELECT
        video_id,
        impressions,
        impressions_ctr * impressions as ctr_weighted,
        engaged_views,
        0 as views, 0 as avd_weighted, 0 as avp_weighted
      FROM video_reach_daily FINAL
      WHERE video_id IN {videoIds: Array(String)} ${where}

      UNION ALL

      SELECT
        video_id,
        0 as impressions, 0 as ctr_weighted, 0 as engaged_views,
        views,
        avg_view_duration_seconds * views as avd_weighted,
        avg_view_percentage * views as avp_weighted
      FROM video_daily_stats
      WHERE video_id IN {videoIds: Array(String)} ${where}
    )
    GROUP BY video_id
  `;

  const response = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await response.json<{
    video_id: string;
    impressions: number;
    ctr_weighted: number;
    engaged_views: number;
    views: number;
    avd_weighted: number;
    avp_weighted: number;
  }>();

  for (const row of rows) {
    const impressions = Number(row.impressions);
    const views = Number(row.views);

    result.set(row.video_id, {
      impressions,
      impressionsCtr:
        impressions > 0 ? Number(row.ctr_weighted) / impressions : 0,
      engagedViews: Number(row.engaged_views),
      avgViewDurationSeconds:
        views > 0 ? Number(row.avd_weighted) / views : 0,
      avgViewPercentage: views > 0 ? Number(row.avp_weighted) / views : 0,
    });
  }

  return result;
}

/**
 * Aggregated traffic sources for a set of videos, optionally date-bounded,
 * grouped by source — and additionally by date (`byDate`) and/or by video
 * (`byVideo`). Without `byVideo` the rows are summed across the whole video
 * set, so a per-video answer requires it.
 */
export async function queryTrafficSources(input: {
  videoIds: string[];
  startDate?: string;
  endDate?: string;
  byDate?: boolean;
  byVideo?: boolean;
}): Promise<
  Array<{
    source: string;
    date?: string;
    videoId?: string;
    views: number;
    watchTimeMinutes: number;
  }>
> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  const client = getClickHouseClient();
  const params: Record<string, unknown> = { videoIds: input.videoIds };
  const conditions = ['video_id IN {videoIds: Array(String)}'];

  if (input.startDate) {
    conditions.push('metric_date >= {startDate: Date}');
    params.startDate = input.startDate;
  }
  if (input.endDate) {
    conditions.push('metric_date <= {endDate: Date}');
    params.endDate = input.endDate;
  }

  const dateSelect = input.byDate ? 'toString(metric_date) as date,' : '';
  const dateGroup = input.byDate ? ', metric_date' : '';
  const videoSelect = input.byVideo ? 'video_id,' : '';
  const videoGroup = input.byVideo ? ', video_id' : '';

  const result = await client.query({
    query: `
      SELECT
        ${dateSelect}
        ${videoSelect}
        source,
        sum(views) as views,
        sum(watch_time_minutes) as watch_time_minutes
      FROM video_traffic_sources FINAL
      WHERE ${conditions.join(' AND ')}
      GROUP BY source${dateGroup}${videoGroup}
      ORDER BY views DESC
    `,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    source: string;
    date?: string;
    video_id?: string;
    views: number;
    watch_time_minutes: number;
  }>();

  return rows.map((row) => ({
    source: row.source,
    ...(row.date ? { date: row.date } : {}),
    ...(row.video_id ? { videoId: row.video_id } : {}),
    views: Number(row.views),
    watchTimeMinutes: Number(row.watch_time_minutes),
  }));
}
