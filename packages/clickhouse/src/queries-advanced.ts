/**
 * Deep-dive analytics queries (FILM-1506).
 *
 * All queries join video_dim FINAL for dimensions (published_at,
 * content_type, language, tags) and are scoped by projectId or accountId
 * to prevent full-table scans. Distributions (medians), ratios (traffic
 * share, back-catalog share), and age-controlled comparisons (cohorts)
 * live here — the playbook's discipline that plain sums cannot express.
 */
import { getClickHouseClient, isClickHouseEnabled } from './client';
import type { VideoDim } from './types';

export interface DimScope {
  projectId?: string;
  accountId?: string;
  platform?: string;
  contentType?: string;
  language?: string;
}

export interface MedianBucket {
  bucket: string;
  videoCount: number;
  medianViews: number;
  p25Views: number;
  p75Views: number;
  meanViews: number;
}

export interface RollingViewsPoint {
  date: string;
  views: number;
  rollingViews: number;
}

export interface TrafficShareBucket {
  bucket: string;
  totalViews: number;
  browseSuggestedViews: number;
  share: number;
}

export interface BackCatalogBucket {
  bucket: string;
  totalViews: number;
  backCatalogViews: number;
  share: number;
}

export interface CohortRow {
  cohort: string;
  videoCount: number;
  /** Cumulative views per checkpoint age (days), summed across the cohort. */
  viewsAtCheckpoint: Record<number, number>;
}

export interface WatchWindowTotals {
  watchTimeSeconds: number;
  netSubscribers: number;
}

export interface TagMedianRow {
  tag: string;
  videoCount: number;
  medianViews: number;
  meanViews: number;
  medianWatchTimeSeconds: number;
}

/**
 * Default source names counted as "Browse + Suggested" for the traffic
 * share trend. RELATED_VIDEO is Suggested; SUBSCRIBER (home/subscriptions
 * feeds) plus NOTIFICATION approximate Studio's Browse bucket — the
 * Analytics/Reporting APIs expose no literal BROWSE source. Callers can
 * override.
 */
export const DEFAULT_BROWSE_SUGGESTED_SOURCES = [
  'RELATED_VIDEO',
  'SUBSCRIBER',
  'NOTIFICATION',
];

function assertDimScope(scope: DimScope): void {
  if (!scope.projectId && !scope.accountId) {
    throw new Error(
      'Deep-dive query requires projectId or accountId to prevent full table scans',
    );
  }
}

/**
 * WHERE conditions selecting video_dim rows for a scope.
 */
function buildDimConditions(scope: DimScope): {
  conditions: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (scope.projectId) {
    conditions.push('project_id = {scopeProjectId: UUID}');
    params.scopeProjectId = scope.projectId;
  }
  if (scope.accountId) {
    conditions.push('account_id = {scopeAccountId: UUID}');
    params.scopeAccountId = scope.accountId;
  }
  if (scope.platform) {
    conditions.push('platform = {scopePlatform: String}');
    params.scopePlatform = scope.platform;
  }
  if (scope.contentType) {
    conditions.push('content_type = {scopeContentType: String}');
    params.scopeContentType = scope.contentType;
  }
  if (scope.language) {
    conditions.push('language = {scopeLanguage: String}');
    params.scopeLanguage = scope.language;
  }

  return { conditions: conditions.join(' AND '), params };
}

/** Subquery selecting the latest dim row per video in scope. */
function dimSubquery(conditions: string): string {
  return `
    SELECT
      video_id,
      argMax(published_at, updated_at) as published_at,
      argMax(tags, updated_at) as tags
    FROM video_dim
    WHERE ${conditions}
    GROUP BY video_id
  `;
}

/**
 * Upsert dimension rows (latest updated_at wins per video).
 */
export async function insertVideoDims(rows: VideoDim[]): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_dim',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Median (and p25/p75/mean) views per video, bucketed by month or quarter.
 *
 * - 'cohort_views_to_date' (headline mode): buckets are UPLOAD periods;
 *   each video contributes its cumulative views to date. A rising line
 *   means newer uploads outperform — channel authority building.
 * - 'views_in_period': buckets are CALENDAR periods; each video
 *   contributes the views it accrued within the bucket.
 */
export async function queryMedianViewsPerVideo(input: {
  scope: DimScope;
  bucket: 'month' | 'quarter';
  mode: 'cohort_views_to_date' | 'views_in_period';
  startDate?: string;
  endDate?: string;
}): Promise<MedianBucket[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  const bucketFn =
    input.bucket === 'quarter' ? 'toStartOfQuarter' : 'toStartOfMonth';

  // In views_in_period the range bounds which METRIC DAYS are summed.
  // In cohort_views_to_date it bounds which UPLOADS are included — each
  // selected video contributes its full views-to-date, otherwise older
  // buckets are silently truncated to the window and read far too low.
  const metricDateConditions: string[] = ['1 = 1'];
  const publishedConditions: string[] = ['1 = 1'];

  if (input.startDate) {
    metricDateConditions.push('metric_date >= {startDate: Date}');
    publishedConditions.push('d.published_at >= {startDate: Date}');
    params.startDate = input.startDate;
  }
  if (input.endDate) {
    metricDateConditions.push('metric_date <= {endDate: Date}');
    publishedConditions.push('d.published_at <= {endDate: Date}');
    params.endDate = input.endDate;
  }

  const query =
    input.mode === 'cohort_views_to_date'
      ? `
        SELECT
          toString(${bucketFn}(d.published_at)) as bucket,
          count() as video_count,
          quantileExact(0.5)(v.total_views) as median_views,
          quantileExact(0.25)(v.total_views) as p25_views,
          quantileExact(0.75)(v.total_views) as p75_views,
          avg(v.total_views) as mean_views
        FROM (${dimSubquery(conditions)}) d
        LEFT JOIN (
          SELECT video_id, sum(views) as total_views
          FROM video_daily_stats
          WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
          GROUP BY video_id
        ) v ON v.video_id = d.video_id
        WHERE ${publishedConditions.join(' AND ')}
        GROUP BY bucket
        ORDER BY bucket ASC
      `
      : `
        SELECT
          bucket,
          count() as video_count,
          quantileExact(0.5)(video_views) as median_views,
          quantileExact(0.25)(video_views) as p25_views,
          quantileExact(0.75)(video_views) as p75_views,
          avg(video_views) as mean_views
        FROM (
          SELECT
            toString(${bucketFn}(metric_date)) as bucket,
            video_id,
            sum(views) as video_views
          FROM video_daily_stats
          WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
            AND ${metricDateConditions.join(' AND ')}
          GROUP BY bucket, video_id
        )
        GROUP BY bucket
        ORDER BY bucket ASC
      `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    bucket: string;
    video_count: number;
    median_views: number;
    p25_views: number;
    p75_views: number;
    mean_views: number;
  }>();

  return rows.map((row) => ({
    bucket: row.bucket,
    videoCount: Number(row.video_count),
    medianViews: Number(row.median_views),
    p25Views: Number(row.p25_views),
    p75Views: Number(row.p75_views),
    meanViews: Number(row.mean_views),
  }));
}

/**
 * Daily views with a rolling-window total (default use: 90-day rolling
 * views). Dates are zero-filled so the window covers days, not rows.
 */
export async function queryRollingViews(input: {
  scope: DimScope;
  windowDays: number;
  startDate: string;
  endDate: string;
}): Promise<RollingViewsPoint[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  params.startDate = input.startDate;
  params.endDate = input.endDate;
  params.windowPreceding = Math.max(0, Math.floor(input.windowDays) - 1);

  const query = `
    SELECT
      toString(date) as date,
      views,
      sum(views) OVER (
        ORDER BY date
        ROWS BETWEEN {windowPreceding: UInt32} PRECEDING AND CURRENT ROW
      ) as rolling_views
    FROM (
      SELECT metric_date as date, sum(views) as views
      FROM video_daily_stats
      WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
        AND metric_date >= {startDate: Date}
        AND metric_date <= {endDate: Date}
      GROUP BY metric_date
      ORDER BY metric_date ASC
        WITH FILL FROM {startDate: Date} TO {endDate: Date} STEP 1
    )
    ORDER BY date ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    date: string;
    views: number;
    rolling_views: number;
  }>();

  return rows.map((row) => ({
    date: row.date,
    views: Number(row.views),
    rollingViews: Number(row.rolling_views),
  }));
}

/**
 * Browse+Suggested share of views per week/month — the clearest signal of
 * whether the algorithm has decided what the channel is for.
 */
export async function queryTrafficShareTrend(input: {
  scope: DimScope;
  bucket: 'week' | 'month';
  browseSuggestedSources?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<TrafficShareBucket[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  params.browseSources =
    input.browseSuggestedSources ?? DEFAULT_BROWSE_SUGGESTED_SOURCES;

  const bucketFn = input.bucket === 'week' ? 'toStartOfWeek' : 'toStartOfMonth';
  const dateConditions: string[] = ['1 = 1'];
  if (input.startDate) {
    dateConditions.push('metric_date >= {startDate: Date}');
    params.startDate = input.startDate;
  }
  if (input.endDate) {
    dateConditions.push('metric_date <= {endDate: Date}');
    params.endDate = input.endDate;
  }

  const query = `
    SELECT
      toString(${bucketFn}(metric_date)) as bucket,
      sum(views) as total_views,
      sumIf(views, source IN {browseSources: Array(String)}) as browse_views
    FROM video_traffic_sources FINAL
    WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
      AND ${dateConditions.join(' AND ')}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    bucket: string;
    total_views: number;
    browse_views: number;
  }>();

  return rows.map((row) => {
    const totalViews = Number(row.total_views);
    const browseSuggestedViews = Number(row.browse_views);
    return {
      bucket: row.bucket,
      totalViews,
      browseSuggestedViews,
      share: totalViews > 0 ? browseSuggestedViews / totalViews : 0,
    };
  });
}

/**
 * Share of period views coming from videos older than ageDays, bucketed
 * monthly. Rising back-catalog share is the compounding-content signal.
 */
export async function queryBackCatalogShare(input: {
  scope: DimScope;
  ageDays: number;
  startDate: string;
  endDate: string;
}): Promise<BackCatalogBucket[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  params.startDate = input.startDate;
  params.endDate = input.endDate;
  params.ageDays = Math.floor(input.ageDays);

  const query = `
    SELECT
      toString(toStartOfMonth(m.metric_date)) as bucket,
      sum(m.views) as total_views,
      sumIf(
        m.views,
        dateDiff('day', d.published_at, toDateTime(m.metric_date)) > {ageDays: Int32}
      ) as back_views
    FROM video_daily_stats m
    INNER JOIN (${dimSubquery(conditions)}) d ON m.video_id = d.video_id
    WHERE m.metric_date >= {startDate: Date}
      AND m.metric_date <= {endDate: Date}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    bucket: string;
    total_views: number;
    back_views: number;
  }>();

  return rows.map((row) => {
    const totalViews = Number(row.total_views);
    const backCatalogViews = Number(row.back_views);
    return {
      bucket: row.bucket,
      totalViews,
      backCatalogViews,
      share: totalViews > 0 ? backCatalogViews / totalViews : 0,
    };
  });
}

/**
 * Per-quarter upload cohorts with cumulative views at fixed ages —
 * the age-controlled growth measurement raw monthly totals cannot give.
 * Sums are cohort totals; callers normalize by videoCount.
 */
export async function queryCohortCurves(input: {
  scope: DimScope;
  checkpoints?: number[];
}): Promise<CohortRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const checkpoints = (input.checkpoints ?? [30, 90, 180, 365]).map((c) =>
    Math.max(1, Math.floor(c)),
  );

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);

  const checkpointSelects = checkpoints
    .map(
      (days) =>
        `sumIf(m.views, dateDiff('day', d.published_at, toDateTime(m.metric_date)) <= ${days}) as views_at_${days}`,
    )
    .join(',\n      ');

  const query = `
    SELECT
      toString(toStartOfQuarter(d.published_at)) as cohort,
      count(DISTINCT d.video_id) as video_count,
      ${checkpointSelects}
    FROM (${dimSubquery(conditions)}) d
    LEFT JOIN video_daily_stats m ON m.video_id = d.video_id
    GROUP BY cohort
    ORDER BY cohort ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();

  return rows.map((row) => {
    const viewsAtCheckpoint: Record<number, number> = {};
    for (const days of checkpoints) {
      viewsAtCheckpoint[days] = Number(row[`views_at_${days}`] ?? 0);
    }
    return {
      cohort: String(row.cohort),
      videoCount: Number(row.video_count),
      viewsAtCheckpoint,
    };
  });
}

/**
 * Rolling watch time + net subscribers over the trailing window from
 * platform-published videos.
 */
export async function queryWatchWindowTotals(input: {
  scope: DimScope;
  windowDays: number;
}): Promise<WatchWindowTotals> {
  const empty: WatchWindowTotals = { watchTimeSeconds: 0, netSubscribers: 0 };
  if (!isClickHouseEnabled()) return empty;
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  params.windowDays = Math.floor(input.windowDays);

  const query = `
    SELECT
      sum(watch_time_seconds) as watch_time_seconds,
      sum(subscribers_gained) - sum(subscribers_lost) as net_subscribers
    FROM video_daily_stats
    WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
      AND metric_date >= today() - {windowDays: UInt32}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    watch_time_seconds: number;
    net_subscribers: number;
  }>();

  if (rows.length === 0) return empty;

  return {
    watchTimeSeconds: Number(rows[0]!.watch_time_seconds),
    netSubscribers: Number(rows[0]!.net_subscribers),
  };
}

/**
 * Watch time over the trailing window from channel videos NOT published
 * through the platform (channel_daily). Added to queryWatchWindowTotals
 * for channel-accurate YPP tracking.
 */
export async function queryChannelWatchWindow(input: {
  connectionIds: string[];
  windowDays: number;
}): Promise<{ watchTimeSeconds: number }> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) {
    return { watchTimeSeconds: 0 };
  }

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT sum(watch_time_seconds) as watch_time_seconds
      FROM channel_daily FINAL
      WHERE connection_id IN {connectionIds: Array(String)}
        AND metric_date >= today() - {windowDays: UInt32}
    `,
    query_params: {
      connectionIds: input.connectionIds,
      windowDays: Math.floor(input.windowDays),
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ watch_time_seconds: number }>();

  return {
    watchTimeSeconds: rows.length > 0 ? Number(rows[0]!.watch_time_seconds) : 0,
  };
}

/**
 * Median performance per taxonomy tag of one dimension. Individual video
 * performance is mostly luck; tag-level medians across enough videos are
 * signal.
 */
export async function queryMedianByTag(input: {
  scope: DimScope;
  dimension: string;
  minVideos: number;
}): Promise<TagMedianRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);
  params.tagPrefix = `${input.dimension}:%`;
  params.minVideos = Math.max(1, Math.floor(input.minVideos));

  const query = `
    SELECT
      t.tag as tag,
      count() as video_count,
      quantileExact(0.5)(v.total_views) as median_views,
      avg(v.total_views) as mean_views,
      quantileExact(0.5)(v.total_watch) as median_watch
    FROM (
      SELECT video_id, sum(views) as total_views, sum(watch_time_seconds) as total_watch
      FROM video_daily_stats
      WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions)}))
      GROUP BY video_id
    ) v
    INNER JOIN (
      SELECT video_id, arrayJoin(tags) as tag
      FROM (${dimSubquery(conditions)})
    ) t ON v.video_id = t.video_id
    WHERE t.tag LIKE {tagPrefix: String}
    GROUP BY t.tag
    HAVING video_count >= {minVideos: UInt32}
    ORDER BY median_views DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    tag: string;
    video_count: number;
    median_views: number;
    mean_views: number;
    median_watch: number;
  }>();

  return rows.map((row) => ({
    tag: row.tag,
    videoCount: Number(row.video_count),
    medianViews: Number(row.median_views),
    meanViews: Number(row.mean_views),
    medianWatchTimeSeconds: Number(row.median_watch),
  }));
}
