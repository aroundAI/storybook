/**
 * Detail queries for the extended-metrics tables (FILM-1505):
 * retention curves, audience breakdowns, and traffic sources.
 */
import {
  chunkVideoIds,
  concatByChunk,
  fitsOneChunk,
  mergeMapsByChunk,
  sumByChunk,
} from './chunked';
import { getClickHouseClient, isClickHouseEnabled } from './client';
import type {
  AudienceDimension,
  RetentionCurvePoint,
  VideoAudienceRow,
} from './types';

/**
 * Insert retention curve points (latest fetch wins per point).
 */
/**
 * Bounds a read to the projects the caller named, when it named any.
 *
 * Every metrics table here is `ORDER BY (project_id, platform, video_id,
 * …)`, so a filter on `video_id` alone matches no primary-key prefix and
 * the read scans the table — with FINAL — however few videos were asked
 * for. This is the predicate that makes it a range read.
 *
 * It bounds what is *read*, never what is *returned*: `video_id` is the
 * publish UUID and unique per tenant, so the id list already decides the
 * rows. That is also why it is opt-in — see `queryQualityMetricsForVideos`.
 */
function pushProjectScope(
  conditions: string[],
  params: Record<string, unknown>,
  projectIds: string[] | undefined,
): void {
  if (!projectIds?.length) return;

  conditions.push('project_id IN {projectIds: Array(UUID)}');
  params.projectIds = projectIds;
}

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
  /**
   * The project the video belongs to, when the caller knows it. See
   * `queryQualityMetricsForVideos` for why this bounds what is read and
   * never what is returned, and why it is opt-in rather than derived.
   */
  projectIds?: string[];
}): Promise<Array<{ elapsedRatio: number; audienceWatchRatio: number }>> {
  if (!isClickHouseEnabled()) return [];

  const client = getClickHouseClient();
  const params: Record<string, unknown> = { videoId: input.videoId };
  const conditions = ['video_id = {videoId: String}'];

  pushProjectScope(conditions, params, input.projectIds);

  const result = await client.query({
    query: `
      SELECT
        elapsed_ratio,
        argMax(audience_watch_ratio, fetched_at) as audience_watch_ratio
      FROM video_retention_curves
      WHERE ${conditions.join(' AND ')}
      GROUP BY elapsed_ratio
      ORDER BY elapsed_ratio ASC
    `,
    query_params: params,
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
async function queryAudienceRowsSingle(input: {
  videoIds: string[];
  projectIds?: string[];
  dimension: AudienceDimension;
}): Promise<
  Array<{ videoId: string; key: string; views: number; percentage: number }>
> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return [];

  const client = getClickHouseClient();
  const params: Record<string, unknown> = {
    videoIds: input.videoIds,
    dimension: input.dimension,
  };
  const conditions = [
    'video_id IN {videoIds: Array(String)}',
    'dimension = {dimension: String}',
  ];

  pushProjectScope(conditions, params, input.projectIds);

  const result = await client.query({
    query: `
      SELECT
        video_id,
        key,
        argMax(views, fetched_at) as views,
        argMax(percentage, fetched_at) as percentage
      FROM video_audience
      WHERE ${conditions.join(' AND ')}
      GROUP BY video_id, key
    `,
    query_params: params,
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
/**
 * Per-video quality metrics. The ratios here (CTR, average view duration)
 * are view-weighted within one video, and a video sits in exactly one
 * chunk, so merging the maps by assignment leaves them exact.
 */
export async function queryQualityMetricsForVideos(input: {
  videoIds: string[];
  /**
   * The projects those videos belong to, when the caller knows them.
   *
   * Purely a read-volume bound, never a correctness filter: `video_id` is
   * the publish UUID and unique per tenant, so the id list already decides
   * *which* rows are returned. But `video_metrics` and `video_reach_daily`
   * are both `ORDER BY (project_id, platform, video_id, metric_date)`, so
   * filtering on `video_id` alone matches no primary-key prefix and reads
   * the whole table — with FINAL — for every call.
   *
   * Opt-in rather than derived from `video_dim`, which is
   * `ORDER BY (video_id)` and so remembers only a video's *current*
   * project: deriving it would silently drop the history of a publish that
   * moved between projects, which is the error `verify-queries.ts` records
   * under "videoId-only reads span project_id by design". A caller passes
   * this only where it knows the scope it asked for.
   */
  projectIds?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<Map<string, VideoQualityMetrics>> {
  if (fitsOneChunk(input.videoIds)) {
    return queryQualityMetricsForVideosSingle(input);
  }

  return mergeMapsByChunk(input.videoIds, (chunk) =>
    queryQualityMetricsForVideosSingle({ ...input, videoIds: chunk }),
  );
}

/**
 * Audience rows. Each row carries its `videoId` and its percentage is
 * relative to that video, so chunks are disjoint and simply concatenate —
 * summing would be wrong here.
 */
export async function queryAudienceRows(input: {
  videoIds: string[];
  /**
   * The projects those videos belong to, when the caller knows them. See
   * `queryQualityMetricsForVideos` for why this bounds what is read and
   * never what is returned, and why it is opt-in rather than derived.
   */
  projectIds?: string[];
  dimension: AudienceDimension;
}): Promise<
  Array<{ videoId: string; key: string; views: number; percentage: number }>
> {
  if (fitsOneChunk(input.videoIds)) return queryAudienceRowsSingle(input);

  return concatByChunk(input.videoIds, (chunk) =>
    queryAudienceRowsSingle({ ...input, videoIds: chunk }),
  );
}

/**
 * Traffic sources. Grouped by source — and optionally by date and video —
 * so rows for the same group appear in several chunks and must be summed.
 * The fold key includes whichever optional dimensions are present, which
 * keeps per-video mode disjoint and pooled mode correctly additive.
 */
export async function queryTrafficSources(input: {
  videoIds: string[];
  /**
   * The projects those videos belong to, when the caller knows them. See
   * `queryQualityMetricsForVideos` for why this bounds what is read and
   * never what is returned, and why it is opt-in rather than derived.
   */
  projectIds?: string[];
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
  if (fitsOneChunk(input.videoIds)) return queryTrafficSourcesSingle(input);

  return sumByChunk(
    input.videoIds,
    (chunk) => queryTrafficSourcesSingle({ ...input, videoIds: chunk }),
    (row) => `${row.source}|${row.date ?? ''}|${row.videoId ?? ''}`,
  );
}

async function queryQualityMetricsForVideosSingle(input: {
  videoIds: string[];
  projectIds?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<Map<string, VideoQualityMetrics>> {
  const result = new Map<string, VideoQualityMetrics>();

  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return result;

  const client = getClickHouseClient();
  const params: Record<string, unknown> = { videoIds: input.videoIds };
  const bounds: string[] = [];

  pushProjectScope(bounds, params, input.projectIds);

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
      avgViewDurationSeconds: views > 0 ? Number(row.avd_weighted) / views : 0,
      avgViewPercentage: views > 0 ? Number(row.avp_weighted) / views : 0,
    });
  }

  return result;
}

/** Subscribers a video gained and lost over a window. */
export interface VideoSubscriberTotals {
  gained: number;
  lost: number;
}

/**
 * Subscribers gained and lost per video, optionally date-bounded (FILM-1610).
 *
 * Per video, not per scope: `queryWatchWindowTotals` answers the same
 * question for a whole project or account, which is the wrong denominator for
 * an experiment run on a handful of videos. A video with no rows in the window
 * is absent from the map rather than present with zeros, so a caller can tell
 * "gained nothing" from "no data".
 */
export async function queryNetSubscribersForVideos(input: {
  videoIds: string[];
  /**
   * The projects those videos belong to, when the caller knows them. See
   * `queryQualityMetricsForVideos` for why this bounds what is read and
   * never what is returned, and why it is opt-in rather than derived.
   */
  projectIds?: string[];

  startDate?: string;
  endDate?: string;
}): Promise<Map<string, VideoSubscriberTotals>> {
  if (fitsOneChunk(input.videoIds)) {
    return queryNetSubscribersForVideosSingle(input);
  }

  return mergeMapsByChunk(input.videoIds, (chunk) =>
    queryNetSubscribersForVideosSingle({ ...input, videoIds: chunk }),
  );
}

async function queryNetSubscribersForVideosSingle(input: {
  videoIds: string[];
  projectIds?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<Map<string, VideoSubscriberTotals>> {
  const result = new Map<string, VideoSubscriberTotals>();

  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return result;

  const client = getClickHouseClient();
  const params: Record<string, unknown> = { videoIds: input.videoIds };
  const conditions = ['video_id IN {videoIds: Array(String)}'];

  pushProjectScope(conditions, params, input.projectIds);

  if (input.startDate) {
    conditions.push('metric_date >= {startDate: Date}');
    params.startDate = input.startDate;
  }
  if (input.endDate) {
    conditions.push('metric_date <= {endDate: Date}');
    params.endDate = input.endDate;
  }

  // video_daily_stats is a view over `video_metrics FINAL`, so re-fetched
  // days are already collapsed to one row each.
  const response = await client.query({
    query: `
      SELECT
        video_id,
        sum(subscribers_gained) as gained,
        sum(subscribers_lost) as lost
      FROM video_daily_stats
      WHERE ${conditions.join(' AND ')}
      GROUP BY video_id
    `,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await response.json<{
    video_id: string;
    gained: number;
    lost: number;
  }>();

  for (const row of rows) {
    result.set(row.video_id, {
      gained: Number(row.gained),
      lost: Number(row.lost),
    });
  }

  return result;
}

/**
 * Tables a coverage count may read, keyed by what they hold (FILM-1610
 * review, C3). A fixed map rather than a parameter: a table name cannot be a
 * bound query parameter, so it must never come from a caller.
 */
const DATA_DAY_TABLES = {
  reach: 'video_reach_daily FINAL',
  daily: 'video_daily_stats',
  traffic: 'video_traffic_sources FINAL',
} as const;

export type DataDaySource = keyof typeof DATA_DAY_TABLES;

/**
 * Distinct days in a window on which any of the videos has a row.
 *
 * A windowed figure computed from ten days of a thirty-day window is a
 * figure about ten days. This is the count that lets it say so.
 */
export async function queryDataDaysForVideos(input: {
  videoIds: string[];
  /**
   * The projects those videos belong to, when the caller knows them. See
   * `queryQualityMetricsForVideos` for why this bounds what is read and
   * never what is returned, and why it is opt-in rather than derived.
   */
  projectIds?: string[];
  source: DataDaySource;
  startDate: string;
  endDate: string;
}): Promise<number> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return 0;

  // Object.hasOwn, as in traffic-groups: a prototype key must not resolve.
  if (!Object.hasOwn(DATA_DAY_TABLES, input.source)) {
    throw new Error(`Unknown data-day source: ${input.source}`);
  }

  const table = DATA_DAY_TABLES[input.source];
  const client = getClickHouseClient();
  const days = new Set<string>();

  // Chunked like the other video-id reads; a date seen in two chunks is one
  // day, so the chunks' dates are unioned, not their counts summed.
  for (const chunk of chunkVideoIds(input.videoIds)) {
    const params: Record<string, unknown> = {
      videoIds: chunk,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    const conditions = [
      'video_id IN {videoIds: Array(String)}',
      'metric_date >= {startDate: Date}',
      'metric_date <= {endDate: Date}',
    ];

    pushProjectScope(conditions, params, input.projectIds);

    const response = await client.query({
      query: `
        SELECT DISTINCT toString(metric_date) as day
        FROM ${table}
        WHERE ${conditions.join(' AND ')}
      `,
      query_params: params,
      format: 'JSONEachRow',
    });

    for (const row of await response.json<{ day: string }>()) {
      days.add(row.day);
    }
  }

  return days.size;
}

/**
 * Aggregated traffic sources for a set of videos, optionally date-bounded,
 * grouped by source — and additionally by date (`byDate`) and/or by video
 * (`byVideo`). Without `byVideo` the rows are summed across the whole video
 * set, so a per-video answer requires it.
 */
async function queryTrafficSourcesSingle(input: {
  videoIds: string[];
  projectIds?: string[];
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

  pushProjectScope(conditions, params, input.projectIds);

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
