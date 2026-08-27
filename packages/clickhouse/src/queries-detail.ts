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

/**
 * Aggregated traffic sources for a set of videos, optionally date-bounded,
 * grouped by source (and by date when byDate is set).
 */
export async function queryTrafficSources(input: {
  videoIds: string[];
  startDate?: string;
  endDate?: string;
  byDate?: boolean;
}): Promise<
  Array<{
    source: string;
    date?: string;
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

  const result = await client.query({
    query: `
      SELECT
        ${dateSelect}
        source,
        sum(views) as views,
        sum(watch_time_minutes) as watch_time_minutes
      FROM video_traffic_sources FINAL
      WHERE ${conditions.join(' AND ')}
      GROUP BY source${dateGroup}
      ORDER BY views DESC
    `,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    source: string;
    date?: string;
    views: number;
    watch_time_minutes: number;
  }>();

  return rows.map((row) => ({
    source: row.source,
    ...(row.date ? { date: row.date } : {}),
    views: Number(row.views),
    watchTimeMinutes: Number(row.watch_time_minutes),
  }));
}
