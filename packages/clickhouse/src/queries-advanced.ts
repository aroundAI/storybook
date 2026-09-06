/**
 * Deep-dive analytics queries (FILM-1506).
 *
 * All queries join video_dim FINAL for dimensions (published_at,
 * content_type, language, tags) and are scoped by projectId or accountId
 * to prevent full-table scans. Distributions (medians), ratios (traffic
 * share, back-catalog share), and age-controlled comparisons (cohorts)
 * live here — the playbook's discipline that plain sums cannot express.
 */
import { concatByChunk } from './chunked';
import { getClickHouseClient, isClickHouseEnabled } from './client';
import { computeIngestLagDays, computeMaturity } from './lib/video-age';
import type { VideoDim } from './types';

export interface DimScope {
  projectId?: string;
  accountId?: string;
  /**
   * Narrows to one channel (platform_connections.id). A project spans
   * several channels, so this is a filter within a scope rather than a
   * scope of its own — assertDimScope still requires project or account.
   */
  connectionId?: string;
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

/** ClickHouse DateTime literal, UTC — matches how dims are written. */
function formatClickHouseDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

/** One checkpoint's distribution within a cohort. */
export interface CohortCheckpointStats {
  medianViews: number;
  p25Views: number;
  p75Views: number;
  meanViews: number;
  /**
   * Videos old enough to have actually reached this checkpoint *and* whose
   * window is covered by ingest — the only ones the figures above are
   * computed over. Travels with the number because a median resting on two
   * videos is one video's luck.
   */
  matureVideoCount: number;
  /**
   * Videos old enough for this checkpoint but whose window closed before
   * their channel's metrics were ever ingested. Excluded from the figures:
   * their sum is unknowable, not low. Surfaced so a thin sample can be
   * explained rather than just looking thin.
   */
  predatesIngestCount: number;
}

export interface CohortMedianRow {
  cohort: string;
  /** Videos uploaded in the cohort, regardless of age. */
  videoCount: number;
  checkpoints: Record<number, CohortCheckpointStats>;
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
  if (scope.connectionId) {
    conditions.push('connection_id = {scopeConnectionId: UUID}');
    params.scopeConnectionId = scope.connectionId;
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

/**
 * Subquery selecting the latest dim row per video in scope.
 *
 * Projects a fixed column set. An earlier `extra: string[]` parameter that
 * interpolated caller-supplied column names was removed unused — a raw
 * identifier splice into SQL is worth adding deliberately, with escaping,
 * rather than inheriting.
 *
 * The scope filter runs in an inner subquery, before any aliasing. Every
 * projected column here is aliased to its own name, and several of them
 * (project_id, platform, content_type, language, connection_id) are also
 * filter columns — so a WHERE alongside the argMax resolves the bare name
 * to the *aggregate* and ClickHouse rejects the query outright:
 * "Aggregate function argMax(...) is found in WHERE". Filtering first makes
 * the shadowing impossible rather than relying on each condition to
 * qualify its column.
 */
function dimSubquery(conditions: string): string {
  return `
    SELECT
      video_id,
      argMax(project_id, updated_at) as project_id,
      argMax(published_at, updated_at) as published_at,
      argMax(tags, updated_at) as tags,
      argMax(title, updated_at) as title,
      argMax(connection_id, updated_at) as connection_id,
      argMax(platform, updated_at) as platform,
      argMax(content_type, updated_at) as content_type,
      argMax(language, updated_at) as language
    FROM (SELECT * FROM video_dim WHERE ${conditions})
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
  // Interpolated, not bound. A window frame bound is part of the query's
  // structure rather than a value, and ClickHouse 24.x rejects a parameter
  // there — "Query parameter `windowPreceding` was not set" — while 25+
  // accepts it. Floored to a non-negative integer just above, so there is
  // nothing to inject.
  const windowPreceding = Math.max(0, Math.floor(input.windowDays) - 1);

  const query = `
    SELECT
      toString(date) as date,
      views,
      sum(views) OVER (
        ORDER BY date
        ROWS BETWEEN ${windowPreceding} PRECEDING AND CURRENT ROW
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
 * Upload cohorts with the distribution of per-video views at fixed ages.
 *
 * The point of this view is to control for how long each video has been
 * live: a later cohort beating an earlier one *at the same age* is real
 * improvement, which raw monthly totals can never show.
 *
 * Two-level aggregation. The inner query reduces to one row per video with
 * its age-bounded sums; the outer takes quantiles across the cohort. That
 * is what makes a median possible at all — a cohort-level SUM divided by
 * video count is a mean, and a mean on this view is hostage to one video
 * going viral, which is exactly the noise the view exists to filter.
 *
 * Maturity is judged per video, not per cohort. `age_days >= N` admits a
 * video to the "@Nd" figure only once *it* is N days old. Judging it from
 * the cohort's start instead — a quarter spans ~90 days — lets a video
 * published yesterday contribute a near-zero to its cohort's 30-day median,
 * and distorts the newest cohort most, which is the one a reader most wants
 * to judge.
 *
 * `quantileExact`, not `quantile`: cohorts are small, and an approximate
 * quantile would return a different number run to run.
 *
 * The join is LEFT so a video with no ingested rows counts as a zero rather
 * than vanishing — dropping it would inflate the median by silently
 * removing the worst performers.
 */
export async function queryCohortMedians(input: {
  scope: DimScope;
  checkpoints?: number[];
  bucket?: 'month' | 'quarter';
  /** Fixes "how old is this video"; bound so a call is reproducible. */
  asOf?: string;
}): Promise<CohortMedianRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  // De-duplicated after flooring: a repeated checkpoint would emit the same
  // SQL alias twice and ClickHouse rejects that outright, so `[30, 30]` —
  // which the caller's schema permits — would 500. Flooring first means
  // 30.4 and 30.9 collapse rather than colliding. Sorting keeps the
  // generated SQL stable for a given set.
  const checkpoints = Array.from(
    new Set(
      (input.checkpoints ?? [30, 90, 180, 365]).map((c) =>
        Math.max(1, Math.floor(c)),
      ),
    ),
  ).sort((a, b) => a - b);

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);

  const bucketFn =
    input.bucket === 'month' ? 'toStartOfMonth' : 'toStartOfQuarter';

  params.asOf = input.asOf ?? formatClickHouseDateTime(new Date());

  // `days` is floored to an integer above, so it is safe to interpolate.
  const perVideoSelects = checkpoints
    .map(
      (days) =>
        `sumIf(m.views, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as v_${days}`,
    )
    .join(',\n        ');

  // A checkpoint whose whole window closed before its channel's ingest
  // began is missing, not zero. Counting it as zero drags the median down,
  // and — because such a video still satisfies `age_days >= N` — it also
  // inflates the mature count, so the growth gate stops firing on exactly
  // the cohorts it exists to protect. Excluded from both, and counted
  // separately so the UI can say why a sample is thin.
  const cohortSelects = checkpoints
    .map((days) => {
      const eligible = `age_days >= ${days} AND ingest_lag_days < ${days}`;

      return `
      quantileExactIf(0.5)(v_${days}, ${eligible}) as median_${days},
      quantileExactIf(0.25)(v_${days}, ${eligible}) as p25_${days},
      quantileExactIf(0.75)(v_${days}, ${eligible}) as p75_${days},
      avgIf(v_${days}, ${eligible}) as mean_${days},
      countIf(${eligible}) as mature_count_${days},
      countIf(age_days >= ${days} AND ingest_lag_days >= ${days}) as predates_ingest_count_${days}`;
    })
    .join(',');

  // Ingest start is a property of the CHANNEL, not the video: a video with
  // no rows on a well-ingested channel is a real zero and must keep
  // counting as one. One row per connection, so the join cannot multiply.
  const query = `
    WITH dim AS (${dimSubquery(conditions)}),
    ingest AS (
      SELECT d.connection_id as connection_id, min(m.metric_date) as ingest_start
      FROM dim d
      INNER JOIN video_daily_stats m
        ON m.video_id = d.video_id AND m.project_id = d.project_id
      GROUP BY d.connection_id
    )
    SELECT
      toString(${bucketFn}(published_at)) as cohort,
      count() as video_count,${cohortSelects}
    FROM (
      SELECT
        d.video_id as video_id,
        d.published_at as published_at,
        dateDiff('day', d.published_at, {asOf: DateTime}) as age_days,
        if(
          any(i.ingest_start) > toDate(0),
          greatest(0, dateDiff('day', d.published_at, toDateTime(any(i.ingest_start)))),
          toInt32(100000)
        ) as ingest_lag_days,
        ${perVideoSelects}
      FROM dim d
      LEFT JOIN video_daily_stats m
        ON m.video_id = d.video_id AND m.project_id = d.project_id
      LEFT JOIN ingest i ON i.connection_id = d.connection_id
      GROUP BY video_id, published_at
    ) per_video
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
    const stats: Record<number, CohortCheckpointStats> = {};

    for (const days of checkpoints) {
      stats[days] = {
        medianViews: Math.round(Number(row[`median_${days}`] ?? 0)),
        p25Views: Math.round(Number(row[`p25_${days}`] ?? 0)),
        p75Views: Math.round(Number(row[`p75_${days}`] ?? 0)),
        meanViews: Math.round(Number(row[`mean_${days}`] ?? 0)),
        matureVideoCount: Number(row[`mature_count_${days}`] ?? 0),
        predatesIngestCount: Number(row[`predates_ingest_count_${days}`] ?? 0),
      };
    }

    return {
      cohort: String(row.cohort),
      videoCount: Number(row.video_count ?? 0),
      checkpoints: stats,
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

/** True for a bare 'YYYY-MM-DD', which needs widening to a DateTime bound. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDayStart(value: string): string {
  return DATE_ONLY.test(value) ? `${value} 00:00:00` : value;
}

function toDayEnd(value: string): string {
  return DATE_ONLY.test(value) ? `${value} 23:59:59` : value;
}

/** One video's row in the Video Log. */
export interface VideoAgeRow {
  videoId: string;
  title: string;
  publishedAt: string;
  connectionId: string;
  platform: string;
  contentType: string;
  language: string;
  /** Views accumulated in days 0..N-1, per requested checkpoint. */
  viewsAtAge: Record<number, number>;
  /** Whether each checkpoint has actually elapsed for this video. */
  matureAt: Record<number, boolean>;
  lifetimeViews: number;
  /** Earliest ingested metric day, or null when nothing was ingested. */
  firstMetricDate: string | null;
  /** Days between publication and the first ingested metric day. */
  ingestLagDays: number | null;
}

/**
 * Columns the Video Log may sort by.
 *
 * A whitelist, not caller-supplied text: `orderBy` reaches SQL by
 * interpolation because ClickHouse cannot bind an identifier as a
 * parameter, so it must never carry anything but one of these keys.
 *
 * These are the SELECT *aliases*, deliberately, not the underlying columns.
 * `published_at` is selected as `toString(d.published_at)`, and a bare
 * identifier in GROUP BY resolves to the alias — so the grouping key is the
 * string. Ordering by the raw `d.published_at` would then be neither
 * grouped nor aggregated and ClickHouse rejects the query outright. Sorting
 * the string is equivalent anyway: 'YYYY-MM-DD HH:MM:SS' orders
 * lexicographically exactly as it does chronologically.
 */
const VIDEO_AGE_ORDER_COLUMNS = {
  published_at: 'published_at',
  lifetime_views: 'lifetime_views',
  title: 'title',
} as const;

export type VideoAgeOrderBy = keyof typeof VIDEO_AGE_ORDER_COLUMNS;

/**
 * Per-video views at fixed ages — the workbook's Sheet 1 row.
 *
 * Every other deep-dive query aggregates across videos or across time; this
 * one holds both fixed, which is what makes videos of different ages
 * comparable at all.
 *
 * The join is deliberately LEFT. A published video with no ingested metric
 * rows must appear with zeros rather than drop out of the log — an inner
 * join would silently shorten the denominator, which is exactly the defect
 * FILM-1601 fixed in the cohort query. Do not "optimize" it to an INNER.
 *
 * Always paginated: the join scans the scope's full history, so an
 * unbounded read here would be the most expensive query in the package.
 *
 * When `videoIds` is supplied the caller has already fixed the set (the raw
 * CSV export does this), so the list is chunked to stay inside the request
 * URI limit and each chunk is read whole rather than paginated. Chunks are
 * ordered independently by the server, so the merged result is re-sorted
 * here — otherwise `orderBy` would silently apply only within each
 * 1,000-video block.
 */
export async function queryVideoViewsAtAge(input: {
  scope: DimScope;
  checkpoints?: number[];
  videoIds?: string[];
  publishedFrom?: string;
  publishedTo?: string;
  limit?: number;
  offset?: number;
  orderBy?: VideoAgeOrderBy;
  orderDirection?: 'asc' | 'desc';
  now?: Date;
}): Promise<VideoAgeRow[]> {
  if (!input.videoIds) return queryVideoViewsAtAgeSingle(input);

  if (input.videoIds.length === 0) return [];

  const rows = await concatByChunk(input.videoIds, (chunk) =>
    queryVideoViewsAtAgeSingle({
      ...input,
      videoIds: chunk,
      limit: chunk.length,
      offset: 0,
    }),
  );

  return sortVideoAgeRows(
    rows,
    input.orderBy ?? 'published_at',
    input.orderDirection ?? 'desc',
  );
}

/**
 * Re-establishes a total order over rows merged from separate requests.
 *
 * Mirrors the SQL ORDER BY, including its `video_id` tiebreak, so a chunked
 * read and a single-request read return the same sequence.
 */
function sortVideoAgeRows(
  rows: VideoAgeRow[],
  orderBy: VideoAgeOrderBy,
  orderDirection: 'asc' | 'desc',
): VideoAgeRow[] {
  const direction = orderDirection === 'asc' ? 1 : -1;

  const compare = (a: VideoAgeRow, b: VideoAgeRow): number => {
    if (orderBy === 'lifetime_views') {
      return (a.lifetimeViews - b.lifetimeViews) * direction;
    }

    const left = orderBy === 'title' ? a.title : a.publishedAt;
    const right = orderBy === 'title' ? b.title : b.publishedAt;

    return left.localeCompare(right) * direction;
  };

  return [...rows].sort(
    (a, b) => compare(a, b) || a.videoId.localeCompare(b.videoId),
  );
}

async function queryVideoViewsAtAgeSingle(input: {
  scope: DimScope;
  checkpoints?: number[];
  videoIds?: string[];
  publishedFrom?: string;
  publishedTo?: string;
  limit?: number;
  offset?: number;
  orderBy?: VideoAgeOrderBy;
  orderDirection?: 'asc' | 'desc';
  /** Injectable for tests; maturity is relative to "now". */
  now?: Date;
}): Promise<VideoAgeRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  // De-duplicated after flooring: a repeated checkpoint would emit the same
  // SQL alias twice and ClickHouse rejects that outright, so `[30, 30]` —
  // which the caller's schema permits — would 500. Flooring first means
  // 30.4 and 30.9 collapse rather than colliding. Sorting keeps the
  // generated SQL stable for a given set.
  const checkpoints = Array.from(
    new Set(
      (input.checkpoints ?? [30, 90, 180, 365]).map((c) =>
        Math.max(1, Math.floor(c)),
      ),
    ),
  ).sort((a, b) => a - b);

  const limit = Math.min(1000, Math.max(1, Math.floor(input.limit ?? 200)));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));

  const orderColumn =
    VIDEO_AGE_ORDER_COLUMNS[input.orderBy ?? 'published_at'] ??
    VIDEO_AGE_ORDER_COLUMNS.published_at;
  const orderDirection = input.orderDirection === 'asc' ? 'ASC' : 'DESC';

  const client = getClickHouseClient();
  const { conditions, params } = buildDimConditions(input.scope);

  const dimConditions = [conditions];

  // Accept a bare date and widen it to cover the whole day, so the bound
  // matches the declared DateTime parameter type rather than relying on
  // lenient coercion — and so `publishedTo` includes that day's uploads
  // instead of cutting them off at midnight.
  if (input.publishedFrom) {
    dimConditions.push('published_at >= {publishedFrom: DateTime}');
    params.publishedFrom = toDayStart(input.publishedFrom);
  }

  if (input.publishedTo) {
    dimConditions.push('published_at <= {publishedTo: DateTime}');
    params.publishedTo = toDayEnd(input.publishedTo);
  }

  if (input.videoIds) {
    dimConditions.push('video_id IN {videoIds: Array(String)}');
    params.videoIds = input.videoIds;
  }

  // `days` is floored to an integer above, so it is safe to interpolate.
  const checkpointSelects = checkpoints
    .map(
      (days) =>
        `sumIf(m.views, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as views_at_${days}`,
    )
    .join(',\n      ');

  const query = `
    SELECT
      d.video_id as video_id,
      d.title as title,
      toString(d.published_at) as published_at,
      toString(d.connection_id) as connection_id,
      d.platform as platform,
      d.content_type as content_type,
      d.language as language,
      ${checkpointSelects},
      sum(m.views) as lifetime_views,
      toString(min(m.metric_date)) as first_metric_date,
      countIf(m.metric_date > toDate(0)) as metric_days
    FROM (${dimSubquery(dimConditions.join(' AND '))}) d
    LEFT JOIN video_daily_stats m
      ON m.video_id = d.video_id AND m.project_id = d.project_id
    GROUP BY
      video_id, title, published_at, connection_id,
      platform, content_type, language
    ORDER BY ${orderColumn} ${orderDirection}, video_id ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<Record<string, unknown>>();
  const now = input.now ?? new Date();

  return rows.map((row) => {
    const publishedAt = String(row.published_at);

    const viewsAtAge: Record<number, number> = {};
    for (const days of checkpoints) {
      viewsAtAge[days] = Number(row[`views_at_${days}`] ?? 0);
    }

    // A LEFT JOIN with no match still produces one row, whose aggregates
    // read as zero — so "no metric days" is what distinguishes a video
    // with nothing ingested from one that genuinely earned no views.
    const hasMetrics = Number(row.metric_days ?? 0) > 0;
    const firstMetricDate = hasMetrics ? String(row.first_metric_date) : null;

    return {
      videoId: String(row.video_id),
      title: String(row.title ?? ''),
      publishedAt,
      connectionId: String(row.connection_id ?? ''),
      platform: String(row.platform ?? ''),
      contentType: String(row.content_type ?? ''),
      language: String(row.language ?? ''),
      viewsAtAge,
      matureAt: computeMaturity(publishedAt, checkpoints, now),
      lifetimeViews: Number(row.lifetime_views ?? 0),
      firstMetricDate,
      ingestLagDays: computeIngestLagDays(publishedAt, firstMetricDate),
    };
  });
}

/**
 * Stored subscriber anchors for a set of channels (FILM-1607).
 *
 * `connectionIds`, not a `DimScope`: `channel_subscribers` has only
 * `connection_id`, so `buildDimConditions`' `project_id`/`account_id`
 * predicates have nothing to bind to and `assertDimScope` would reject or —
 * worse — the query would filter on nothing and return every tenant's rows.
 * `queryChannelWatchWindow` above is the precedent; ids are resolved in
 * Postgres by the caller, which is also where the tenant check lives.
 *
 * `from` is expected to already reach back to the latest anchor at or before
 * the caller's window, so a window opening inside a capture gap can still be
 * levelled. `reconstructSeries` needs that anchor to exist in this result.
 */
export async function querySubscriberAnchors(input: {
  connectionIds: string[];
  from: string;
  to: string;
}): Promise<
  Array<{
    connectionId: string;
    snapshotDate: string;
    subscriberCount: number;
    roundingStep: number;
  }>
> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) {
    return [];
  }

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        toString(connection_id)   as connection_id,
        toString(snapshot_date)   as snapshot_date,
        subscriber_count,
        rounding_step
      FROM (
        SELECT * FROM channel_subscribers FINAL
        WHERE connection_id IN {connectionIds: Array(String)}
          AND snapshot_date >= {from: Date}
          AND snapshot_date <= {to: Date}
      )
      ORDER BY connection_id, snapshot_date
    `,
    query_params: {
      connectionIds: input.connectionIds,
      from: input.from,
      to: input.to,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    connection_id: string;
    snapshot_date: string;
    subscriber_count: number;
    rounding_step: number;
  }>();

  return rows.map((row) => ({
    connectionId: row.connection_id,
    snapshotDate: row.snapshot_date,
    subscriberCount: Number(row.subscriber_count),
    roundingStep: Number(row.rounding_step),
  }));
}

/**
 * Per-connection daily subscriber movement (FILM-1607).
 *
 * The composed channel total, not `channel_daily` alone. `channel_daily` is
 * the residual of videos that failed to match a publish, so on its own it
 * sees only the unmatched slice — and the error is invisible, because anchors
 * re-level the curve at each snapshot and it looks right everywhere except
 * between them, which is the only region the reconstruction exists to fill.
 *
 * Every leg carries FINAL, `video_metrics` included: it is a
 * ReplacingMergeTree and the hourly sync re-ingests the same
 * (video_id, metric_date), so an unmerged part would double-count.
 *
 * Each leg nets to Int64 before the UNION. `video_metrics.subscribers_gained`
 * is Int32 and `channel_daily`'s is UInt32, so summing the gross columns
 * yields Int64 against UInt64 — a pair ClickHouse has no least supertype for,
 * which fails the whole query with NO_COMMON_TYPE rather than degrading.
 */
export async function querySubscriberDeltas(input: {
  connectionIds: string[];
  from: string;
  to: string;
}): Promise<Array<{ connectionId: string; metricDate: string; net: number }>> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) {
    return [];
  }

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        connection_id,
        metric_date,
        sum(net) as net
      FROM (
        SELECT
          toString(connection_id) as connection_id,
          toString(metric_date)   as metric_date,
          toInt64(sum(gained) - sum(lost)) as net
        FROM (
          SELECT
            d.connection_id      as connection_id,
            m.metric_date        as metric_date,
            m.subscribers_gained as gained,
            m.subscribers_lost   as lost
          FROM video_metrics AS m FINAL
          INNER JOIN (
            SELECT video_id, connection_id FROM video_dim FINAL
          ) AS d ON d.video_id = m.video_id
          WHERE d.connection_id IN {connectionIds: Array(String)}
            AND m.metric_date >= {from: Date}
            AND m.metric_date <= {to: Date}
        )
        GROUP BY connection_id, metric_date

        UNION ALL

        SELECT
          toString(connection_id) as connection_id,
          toString(metric_date)   as metric_date,
          toInt64(sum(gained) - sum(lost)) as net
        FROM (
          SELECT
            connection_id,
            metric_date,
            subscribers_gained as gained,
            subscribers_lost   as lost
          FROM channel_daily FINAL
          WHERE connection_id IN {connectionIds: Array(String)}
            AND metric_date >= {from: Date}
            AND metric_date <= {to: Date}
        )
        GROUP BY connection_id, metric_date
      )
      GROUP BY connection_id, metric_date
      ORDER BY connection_id, metric_date
    `,
    query_params: {
      connectionIds: input.connectionIds,
      from: input.from,
      to: input.to,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    connection_id: string;
    metric_date: string;
    net: number;
  }>();

  return rows.map((row) => ({
    connectionId: row.connection_id,
    metricDate: row.metric_date,
    net: Number(row.net),
  }));
}

/**
 * One subscriber anchor. Idempotent per (connection_id, snapshot_date) via
 * ReplacingMergeTree, whose version is the millisecond-resolution
 * `inserted_at` — see migration 008 for why second resolution is not enough.
 */
export async function insertSubscriberSnapshot(row: {
  connectionId: string;
  snapshotDate: string;
  subscriberCount: number;
  roundingStep: number;
}): Promise<void> {
  if (!isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'channel_subscribers',
    values: [
      {
        connection_id: row.connectionId,
        snapshot_date: row.snapshotDate,
        subscriber_count: row.subscriberCount,
        rounding_step: row.roundingStep,
      },
    ],
    format: 'JSONEachRow',
  });
}
