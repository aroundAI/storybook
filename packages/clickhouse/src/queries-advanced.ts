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
import type { LanguageDimension } from './lib/language-dimension';
import { fromDimLanguage } from './lib/language-dimension';
import type { SegmentConfidence } from './lib/segment-stats';
import { computeSpread, resolveConfidence } from './lib/segment-stats';
import type {
  TrafficGroupBucket,
  TrafficSourceRow,
} from './lib/traffic-groups';
import { groupTrafficRows } from './lib/traffic-groups';
import type { TrafficBucket } from './lib/traffic-groups';
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
  /**
   * The published asset's language (`video_dim.language`).
   *
   * `undefined` means no filter. LANGUAGE_NOT_SET (`''`) is a filter — it
   * selects the videos nobody set a language on — so the two must not be
   * confused: a truthiness check here would turn "show me the unlabelled
   * ones" into "show me everything", with no error.
   */
  language?: string;
  /** The channel's target language (`video_dim.channel_language`). Same rules. */
  channelLanguage?: string;
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
  /**
   * Filters on a column whose value changes over a video's life, applied
   * to the newest dim row rather than to any row. See `dimSubquery`.
   */
  latest: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const latest: string[] = [];
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
  if (scope.language !== undefined) {
    latest.push('language = {scopeLanguage: String}');
    params.scopeLanguage = scope.language;
  }
  if (scope.channelLanguage !== undefined) {
    latest.push('channel_language = {scopeChannelLanguage: String}');
    params.scopeChannelLanguage = scope.channelLanguage;
  }

  return {
    conditions: conditions.join(' AND '),
    latest: latest.join(' AND '),
    params,
  };
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
 * (project_id, platform, content_type, language, channel_language,
 * connection_id) are also
 * filter columns — so a WHERE alongside the argMax resolves the bare name
 * to the *aggregate* and ClickHouse rejects the query outright:
 * "Aggregate function argMax(...) is found in WHERE". Filtering first makes
 * the shadowing impossible rather than relying on each condition to
 * qualify its column.
 *
 * `latest` is the exception, and it is applied *after* the collapse, as a
 * HAVING over the argMax. `video_dim` is a ReplacingMergeTree read without
 * FINAL, so a video's superseded rows stay visible until a merge that is
 * never guaranteed. For a column that does not change — project, account —
 * filtering those rows first is harmless. For one that does, it is wrong in
 * a way nothing reports: a video relabelled from 'en' to not-set still has
 * an 'en' row, the inner filter keeps only that row, and the argMax over
 * what is left says 'en'. FILM-1702 relabels languages in bulk, which is
 * what turned that from a theory into every reclassified video. The alias
 * resolving to the aggregate — the thing the inner subquery exists to
 * avoid in WHERE — is exactly what HAVING needs.
 *
 * Required rather than optional, so a new call site cannot forget it.
 */
function dimSubquery(conditions: string, latest: string): string {
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
      argMax(language, updated_at) as language,
      argMax(channel_language, updated_at) as channel_language
    FROM (SELECT * FROM video_dim WHERE ${conditions})
    GROUP BY video_id
    ${latest ? `HAVING ${latest}` : ''}
  `;
}

/**
 * The metric side of a dim join, scoped the same way the dim side is.
 *
 * `video_daily_stats` is `SELECT … FROM video_metrics FINAL` with no filter
 * of its own, so a join that names it bare builds its hash side from every
 * row in the table, for every tenant, on every read. That is the full table
 * scan `assertDimScope` exists to prevent, arriving through the join instead
 * of the WHERE — and it is invisible to every test that checks results,
 * because the join predicate still discards the other tenants' rows. It
 * costs only time, until the time exceeds the client's socket timeout.
 *
 * `project_id` is the table's primary-key prefix (`ORDER BY (project_id,
 * platform, video_id, metric_date)`), so it is the predicate that turns the
 * scan into a range read. `video_id` narrows it again for a scope that is
 * less than a whole project. Both are derived from `video_dim`, which is
 * where the scope's columns live — `video_metrics` has no `account_id`.
 *
 * `dimWhere` is built by `buildDimConditions`, never caller text.
 */
function scopedDailyStats(dimWhere: string, columns: string): string {
  return `(
      SELECT ${columns}
      FROM video_daily_stats
      WHERE project_id IN (SELECT project_id FROM video_dim WHERE ${dimWhere})
        AND video_id IN (SELECT video_id FROM video_dim WHERE ${dimWhere})
    )`;
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
  const { conditions, latest, params } = buildDimConditions(input.scope);
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
          ifNotFinite(quantileExactInclusive(0.5)(v.total_views), 0) as median_views,
          ifNotFinite(quantileExactInclusive(0.25)(v.total_views), 0) as p25_views,
          ifNotFinite(quantileExactInclusive(0.75)(v.total_views), 0) as p75_views,
          avg(v.total_views) as mean_views
        FROM (${dimSubquery(conditions, latest)}) d
        LEFT JOIN (
          SELECT video_id, sum(views) as total_views
          FROM video_daily_stats
          WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions, latest)}))
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
          ifNotFinite(quantileExactInclusive(0.5)(video_views), 0) as median_views,
          ifNotFinite(quantileExactInclusive(0.25)(video_views), 0) as p25_views,
          ifNotFinite(quantileExactInclusive(0.75)(video_views), 0) as p75_views,
          avg(video_views) as mean_views
        FROM (
          SELECT
            toString(${bucketFn}(metric_date)) as bucket,
            video_id,
            sum(views) as video_views
          FROM video_daily_stats
          WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions, latest)}))
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
 * views). Dates are zero-filled so the window covers days, not rows. WITH
 * FILL's TO bound is exclusive, hence the `+ 1`: without it a quiet final day
 * was missing rather than zero.
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
  const { conditions, latest, params } = buildDimConditions(input.scope);
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
      WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions, latest)}))
        AND metric_date >= {startDate: Date}
        AND metric_date <= {endDate: Date}
      GROUP BY metric_date
      ORDER BY metric_date ASC
        WITH FILL FROM {startDate: Date} TO {endDate: Date} + 1 STEP 1
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
 * Each granularity mapped to its ClickHouse function.
 *
 * `bucket` reaches SQL by interpolation because ClickHouse cannot bind a
 * function name as a parameter, so it must never carry caller text — the
 * same treatment VIDEO_AGE_ORDER_COLUMNS gives `orderBy`. The granularity
 * list itself lives in lib/traffic-groups.ts, which is pure, so the zod
 * schema that validates `bucket` can share it without pulling the driver
 * into a client bundle.
 */
const TRAFFIC_BUCKET_FUNCTIONS: Record<TrafficBucket, string> = {
  day: 'toDate',
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
};

/**
 * Raw per-bucket, per-source rows for a scope.
 *
 * Private, and the only SQL path to this table's grouped rows. It was
 * extracted when the browse+suggested trend also read them, so the two
 * could not drift on a date bound edited in one body and not the other;
 * that trend has since been deleted, so `queryTrafficSourceBreakdown`
 * below is the sole caller. Kept separate because the fold and the fetch
 * are worth reading apart, not because a second consumer exists.
 *
 * It groups by the raw `source`, never by a presentation group: the
 * taxonomy lives in `lib/traffic-groups.ts` so that changing it is a code
 * change rather than a migration.
 */
async function queryTrafficSourceRows(input: {
  scope: DimScope;
  bucket: TrafficBucket;
  startDate?: string;
  endDate?: string;
}): Promise<TrafficSourceRow[]> {
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);

  // Object.hasOwn, not a bare index: `TRAFFIC_BUCKET_FUNCTIONS['constructor']`
  // resolves up the prototype chain to a truthy function, which skips a
  // `??` fallback and interpolates a function body into the query.
  const bucketFn = Object.hasOwn(TRAFFIC_BUCKET_FUNCTIONS, input.bucket)
    ? TRAFFIC_BUCKET_FUNCTIONS[input.bucket]
    : TRAFFIC_BUCKET_FUNCTIONS.week;
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
      source as source,
      sum(views) as views,
      sum(watch_time_minutes) as watch_time_minutes
    FROM video_traffic_sources FINAL
    WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions, latest)}))
      AND ${dateConditions.join(' AND ')}
    GROUP BY bucket, source
    ORDER BY bucket ASC, views DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    bucket: string;
    source: string;
    views: number;
    watch_time_minutes: number;
  }>();

  return rows.map((row) => ({
    bucket: row.bucket,
    source: row.source,
    views: Number(row.views),
    watchTimeMinutes: Number(row.watch_time_minutes),
  }));
}

/**
 * Views and watch time per traffic-source group, per bucket (FILM-1605).
 *
 * Answers "where did views come from, as a share of the whole, over time"
 * — the six surfaces beyond Browse+Suggested, plus an Other residual,
 * that a single share figure cannot show.
 *
 * The denominator is matched videos only: unmatched traffic rows are
 * dropped at ingest and channel_daily has no `source` column to hold them,
 * so this share is not comparable to a channel view total and will not
 * match Studio exactly.
 */
export async function queryTrafficSourceBreakdown(input: {
  scope: DimScope;
  bucket: TrafficBucket;
  /**
   * Required, unlike the other scope queries. This one returns a row per
   * (bucket, source) rather than per bucket, so an unbounded call is ~18x
   * the payload — and the span cap lives in the action's schema, which a
   * direct importer of this export bypasses entirely. Putting the
   * requirement here is what makes the bound a property of the query
   * rather than of the caller's manners.
   */
  startDate: string;
  endDate: string;
}): Promise<TrafficGroupBucket[]> {
  if (!isClickHouseEnabled()) return [];

  return groupTrafficRows(await queryTrafficSourceRows(input));
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
  const { conditions, latest, params } = buildDimConditions(input.scope);
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
    INNER JOIN (${dimSubquery(conditions, latest)}) d ON m.video_id = d.video_id
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
 * `quantileExactInclusive`, not `quantile`: cohorts are small, and an approximate
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
  const { conditions, latest, params } = buildDimConditions(input.scope);

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
      ifNotFinite(quantileExactInclusiveIf(0.5)(v_${days}, ${eligible}), 0) as median_${days},
      ifNotFinite(quantileExactInclusiveIf(0.25)(v_${days}, ${eligible}), 0) as p25_${days},
      ifNotFinite(quantileExactInclusiveIf(0.75)(v_${days}, ${eligible}), 0) as p75_${days},
      avgIf(v_${days}, ${eligible}) as mean_${days},
      countIf(${eligible}) as mature_count_${days},
      countIf(age_days >= ${days} AND ingest_lag_days >= ${days}) as predates_ingest_count_${days}`;
    })
    .join(',');

  // Ingest start is a property of the CHANNEL, not the video: a video with
  // no rows on a well-ingested channel is a real zero and must keep
  // counting as one. One row per connection, so the join cannot multiply.
  const query = `
    WITH dim AS (${dimSubquery(conditions, latest)}),
    ingest AS (
      SELECT d.connection_id as connection_id, min(m.metric_date) as ingest_start
      FROM dim d
      INNER JOIN ${scopedDailyStats(
        conditions,
        'project_id, video_id, metric_date',
      )} m
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
      LEFT JOIN ${scopedDailyStats(
        conditions,
        'project_id, video_id, metric_date, views',
      )} m
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
  const { conditions, latest, params } = buildDimConditions(input.scope);
  params.windowDays = Math.floor(input.windowDays);

  const query = `
    SELECT
      sum(watch_time_seconds) as watch_time_seconds,
      sum(subscribers_gained) - sum(subscribers_lost) as net_subscribers
    FROM video_daily_stats
    WHERE video_id IN (SELECT video_id FROM (${dimSubquery(conditions, latest)}))
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
 * Grouping expression per segment kind.
 *
 * Closed, because this expression is interpolated into SQL — it is the one
 * thing in the query that cannot be a bound parameter, since ClickHouse
 * binds values and not identifiers. Same argument VIDEO_AGE_ORDER_COLUMNS
 * makes for ORDER BY.
 *
 * `tag` is the only kind that fans a video out across several segments;
 * the other three partition. That single difference is the whole reason
 * this generalises queryMedianByTag rather than extending it.
 */
const SEGMENT_GROUPINGS = {
  tag: 'arrayJoin(d.tags)',
  language: 'd.language',
  channel_language: 'd.channel_language',
  content_type: 'd.content_type',
  connection: 'toString(d.connection_id)',
} as const;

export type SegmentKind = keyof typeof SEGMENT_GROUPINGS;

/**
 * Which segment kind answers each language dimension (FILM-1702).
 *
 * The Language tab's toggle resolves through this, so "by content
 * language" on that tab and `kind: 'language'` on the Deep Dive are the
 * same query with the same GROUP BY — not two aggregations that happen to
 * share a word.
 */
export const LANGUAGE_DIMENSION_SEGMENTS = {
  content: 'language',
  channel: 'channel_language',
} as const satisfies Record<LanguageDimension, SegmentKind>;

/**
 * Videos the figures at this checkpoint are computed over.
 *
 * Old enough to have reached it, and with a channel whose ingest covers
 * the window. Shared by both segment queries: the pooled RPM divides
 * revenue from the membership by views from the aggregate, so a video
 * admitted to one and not the other silently skews the rate.
 */
function segmentEligible(days: number): string {
  return `age_days >= ${days} AND ingest_lag_days < ${days}`;
}

/**
 * CTEs reducing a scope to one row per (video, segment) at a checkpoint.
 *
 * Ingest start is a property of the CHANNEL, not the video: a video with
 * no rows on a well-ingested channel is a real zero and must keep counting
 * as one. One row per connection, so the join cannot multiply.
 *
 * The reach leg is UNIONed rather than joined — both tables carry one row
 * per video per day, and a join would multiply views by impression days.
 *
 * Each zero-filled column must be cast to the *declared* type of the column
 * it stands in for — `views` and `watch_time_seconds` are UInt64
 * (`002_metrics_v2.ts`), `impressions` UInt64 — because ClickHouse refuses
 * to find a supertype for UInt64 and Float64: "there is no floating point
 * type that can exactly represent all required integers". A mocked client
 * cannot catch this; `pnpm verify` against a real server is what does.
 *
 * `days` is floored by both callers before it reaches here, and `grouping`
 * comes from SEGMENT_GROUPINGS, so neither is caller text.
 */
function segmentPerVideoSql(
  conditions: string,
  latest: string,
  grouping: string,
  days: number,
): string {
  return `
    WITH dim AS (${dimSubquery(conditions, latest)}),
    ingest AS (
      SELECT d.connection_id as connection_id, min(s.metric_date) as ingest_start
      FROM dim d
      INNER JOIN ${scopedDailyStats(
        conditions,
        'project_id, video_id, metric_date',
      )} s
        ON s.video_id = d.video_id AND s.project_id = d.project_id
      GROUP BY d.connection_id
    ),
    metrics AS (
      SELECT
        video_id, project_id, metric_date,
        views, watch_time_seconds,
        toUInt64(0) as impressions, toFloat64(0) as ctr_weighted
      FROM video_daily_stats
      WHERE video_id IN (SELECT video_id FROM dim)

      UNION ALL

      SELECT
        video_id, project_id, metric_date,
        toUInt64(0) as views, toUInt64(0) as watch_time_seconds,
        impressions, impressions_ctr * impressions as ctr_weighted
      FROM video_reach_daily FINAL
      WHERE video_id IN (SELECT video_id FROM dim)
    ),
    per_video AS (
      SELECT
        d.video_id as video_id,
        ${grouping} as segment,
        d.published_at as published_at,
        dateDiff('day', d.published_at, {asOf: DateTime}) as age_days,
        if(
          any(i.ingest_start) > toDate(0),
          greatest(0, dateDiff('day', d.published_at, toDateTime(any(i.ingest_start)))),
          toInt32(100000)
        ) as ingest_lag_days,
        sumIf(m.views, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as v_views,
        sumIf(m.watch_time_seconds, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as v_watch,
        sumIf(m.impressions, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as v_impressions,
        sumIf(m.ctr_weighted, dateDiff('day', d.published_at, toDateTime(m.metric_date)) < ${days}) as v_ctr_weighted
      FROM dim d
      LEFT JOIN metrics m
        ON m.video_id = d.video_id AND m.project_id = d.project_id
      LEFT JOIN ingest i ON i.connection_id = d.connection_id
      GROUP BY video_id, segment, d.published_at
    )
  `;
}

/**
 * `LIKE` clause restricting tag segments to one dimension.
 *
 * Empty for every other kind, and empty when no dimension is given —
 * `dimension:slug` means a prefix built from an absent dimension is ':%',
 * which matches no tag in existence. Returning every tag is a defensible
 * answer; returning none with no error is not.
 */
function segmentTagFilter(
  kind: SegmentKind,
  dimension: string | undefined,
  params: Record<string, unknown>,
): string {
  if (kind !== 'tag' || !dimension) return '';

  params.tagPrefix = `${dimension}:%`;

  return 'segment LIKE {tagPrefix: String}';
}

/** Resolves a segment kind, refusing anything outside the closed lookup. */
function resolveSegmentGrouping(kind: SegmentKind): string {
  // Own-property only: a kind of 'constructor' or '__proto__' would
  // otherwise resolve up the prototype chain to a function, and splice its
  // source text into the query.
  if (!Object.prototype.hasOwnProperty.call(SEGMENT_GROUPINGS, kind)) {
    throw new Error(`Unknown segment kind: ${String(kind)}`);
  }

  return SEGMENT_GROUPINGS[kind];
}

export interface SegmentPerformanceRow {
  segment: string;
  videoCount: number;
  /** Videos that actually reached the checkpoint. Drives `confidence`. */
  matureVideoCount: number;
  /** Excluded: their checkpoint window closed before ingest began. */
  predatesIngestCount: number;
  medianViews: number;
  meanViews: number;
  p25Views: number;
  p75Views: number;
  minViews: number;
  maxViews: number;
  /** maxViews / medianViews, or null when the median is zero. */
  spread: number | null;
  medianWatchTimeSeconds: number;
  /** Impression-weighted, or null where the segment has no impressions. */
  meanCtr: number | null;
  totalViews: number;
  confidence: SegmentConfidence;
}

/**
 * Per-segment view distribution at a fixed video age.
 *
 * Replaces queryMedianByTag, which answered a narrower and quietly wrong
 * version of "which kinds of video work?": it summed a lifetime with no
 * age bound, so a tag applied mostly to older uploads won on nothing but
 * time; it INNER JOINed from the metrics side, so a tag whose videos
 * mostly flopped reported the median of its survivors; and it only knew
 * tags, while language is a dim column that cannot be forced into a
 * taxonomy without making it permanently unanswerable.
 *
 * Maturity is judged per video — `age_days >= N` admits a video to the
 * "@Nd" figure only once *it* is N days old — and a video whose whole
 * checkpoint window closed before its channel's ingest began is excluded
 * rather than counted as zero, because "no data" and "no views" are
 * different facts. Both rules are expressed here in SQL, matching
 * queryCohortMedians; lib/video-age.ts holds the per-row TypeScript form
 * used by queryVideoViewsAtAge, and the two must not drift.
 *
 * CTR is weighted by impressions, not views: impressions are its
 * denominator, and views arrive from surfaces that never produced an
 * impression at all.
 */
export async function querySegmentPerformance(input: {
  scope: DimScope;
  segment: { kind: SegmentKind; dimension?: string };
  minVideos: number;
  /** Video age the figures are measured at. Defaults to 30 days. */
  checkpointDays?: number;
  /** Fixes "how old is this video"; bound so a call is reproducible. */
  asOf?: string;
}): Promise<SegmentPerformanceRow[]> {
  const kind = input.segment.kind;
  const grouping = resolveSegmentGrouping(kind);

  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);

  // Floored to an integer, so it is safe to interpolate.
  const days = Math.max(1, Math.floor(input.checkpointDays ?? 30));

  params.minVideos = Math.max(1, Math.floor(input.minVideos));
  params.asOf = input.asOf ?? formatClickHouseDateTime(new Date());

  // Only tags carry a dimension prefix; the other kinds are whole columns.
  // Omitted when no dimension is given: tags are stored as `dimension:slug`,
  // so a prefix of ':%' matches nothing and would report "no tags" for an
  // account full of them — a silent empty result, not a filter.
  const tagFilter = segmentTagFilter(kind, input.segment.dimension, params);

  const eligible = segmentEligible(days);

  const query = `
    ${segmentPerVideoSql(conditions, latest, grouping, days)}
    SELECT
      segment,
      count() as video_count,
      countIf(${eligible}) as mature_video_count,
      countIf(age_days >= ${days} AND ingest_lag_days >= ${days}) as predates_ingest_count,
      ifNotFinite(quantileExactInclusiveIf(0.5)(v_views, ${eligible}), 0) as median_views,
      avgIf(v_views, ${eligible}) as mean_views,
      ifNotFinite(quantileExactInclusiveIf(0.25)(v_views, ${eligible}), 0) as p25_views,
      ifNotFinite(quantileExactInclusiveIf(0.75)(v_views, ${eligible}), 0) as p75_views,
      minIf(v_views, ${eligible}) as min_views,
      maxIf(v_views, ${eligible}) as max_views,
      ifNotFinite(quantileExactInclusiveIf(0.5)(v_watch, ${eligible}), 0) as median_watch,
      sumIf(v_views, ${eligible}) as total_views,
      sumIf(v_impressions, ${eligible}) as impressions,
      sumIf(v_ctr_weighted, ${eligible}) as ctr_weighted
    FROM per_video
    ${tagFilter ? `WHERE ${tagFilter}` : ''}
    GROUP BY segment
    HAVING mature_video_count >= {minVideos: UInt32}
    ORDER BY median_views DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    segment: string;
    video_count: number;
    mature_video_count: number;
    predates_ingest_count: number;
    median_views: number;
    mean_views: number;
    p25_views: number;
    p75_views: number;
    min_views: number;
    max_views: number;
    median_watch: number;
    total_views: number;
    impressions: number;
    ctr_weighted: number;
  }>();

  return rows.map((row) => {
    const medianViews = Math.round(Number(row.median_views ?? 0));
    const maxViews = Math.round(Number(row.max_views ?? 0));
    const matureVideoCount = Number(row.mature_video_count ?? 0);
    const impressions = Number(row.impressions ?? 0);

    return {
      segment: String(row.segment),
      videoCount: Number(row.video_count ?? 0),
      matureVideoCount,
      predatesIngestCount: Number(row.predates_ingest_count ?? 0),
      medianViews,
      meanViews: Math.round(Number(row.mean_views ?? 0)),
      p25Views: Math.round(Number(row.p25_views ?? 0)),
      p75Views: Math.round(Number(row.p75_views ?? 0)),
      minViews: Math.round(Number(row.min_views ?? 0)),
      maxViews,
      spread: computeSpread(maxViews, medianViews),
      medianWatchTimeSeconds: Number(row.median_watch ?? 0),
      // Absent, not zero: a segment with no impressions has no CTR, and a
      // zero would read as "nobody clicked".
      meanCtr:
        impressions > 0 ? Number(row.ctr_weighted ?? 0) / impressions : null,
      totalViews: Number(row.total_views ?? 0),
      confidence: resolveConfidence(matureVideoCount),
    };
  });
}

export interface SegmentMembershipRow {
  segment: string;
  videoId: string;
  /**
   * Publish date, so revenue can be bounded to the same window the views
   * cover. Without it the two halves of the rate measure different spans.
   */
  publishedAt: string;
}

/**
 * Deliberately no `views` column. The RPM denominator is
 * querySegmentPerformance's `totalViews`, which is what keeps numerator
 * and denominator over the same set of videos; a per-video figure carried
 * here would invite a caller to sum it into a denominator that does not
 * match the aggregate — and would ship a column nothing reads for up to
 * 100k rows a render.
 */

/**
 * Which videos make up each segment, and what each contributed.
 *
 * Exists only because revenue lives in Postgres and views live here, so
 * pooling RPM per segment needs the video ids on both sides. Returning
 * groupArray(video_id) from querySegmentPerformance instead would put an
 * unbounded array in a single cell and blow memory on a large segment.
 *
 * Counts exactly the videos querySegmentPerformance counted — same
 * eligibility, same checkpoint. A video admitted here but not there would
 * put revenue over a denominator that excludes it, deflating the rate.
 *
 * Ordered by (segment, video_id), which is unique and total, so paging
 * cannot skip or repeat a row. Fixed rather than caller-chosen: there is
 * no ordering choice to whitelist, and a fixed key is stronger than a
 * validated one.
 *
 * Paged by **keyset**, not OFFSET — but note what that does and does not
 * buy. The whole CTE chain (the dim scan, the ingest join over
 * video_daily_stats, the metrics union, the arrayJoin fan-out) is
 * re-executed on every page either way; keyset removes only the
 * sort-and-discard of the rows before the cursor, and removes the
 * possibility of a concurrent write shifting rows across a page boundary.
 * It does not make paging cheap.
 *
 * The scan cost is therefore controlled by taking *few, large* pages
 * rather than many small ones — see MEMBERSHIP_PAGE_SIZE. An earlier
 * version of this comment claimed keyset avoided the repeated passes; it
 * does not, and the page size is what does.
 */
export async function querySegmentMembership(input: {
  scope: DimScope;
  segment: { kind: SegmentKind; dimension?: string };
  checkpointDays?: number;
  limit?: number;
  /** Last row of the previous page; resumes strictly after it. */
  after?: { segment: string; videoId: string };
  asOf?: string;
}): Promise<SegmentMembershipRow[]> {
  const kind = input.segment.kind;
  const grouping = resolveSegmentGrouping(kind);

  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);

  const days = Math.max(1, Math.floor(input.checkpointDays ?? 30));
  // Clamped high deliberately: each page re-runs the full CTE chain, so a
  // small page size multiplies scans rather than saving memory. The rows
  // are four small columns, so 50k of them is a few megabytes.
  const limit = Math.min(50_000, Math.max(1, Math.floor(input.limit ?? 500)));

  params.asOf = input.asOf ?? formatClickHouseDateTime(new Date());

  const tagFilter = segmentTagFilter(kind, input.segment.dimension, params);

  // Tuple comparison, so the resume point is the pair rather than either
  // column alone — a segment spanning more than one page would otherwise
  // restart at its first video.
  let keyset = '';

  if (input.after) {
    keyset =
      ' AND (segment, video_id) > ({afterSegment: String}, {afterVideoId: String})';
    params.afterSegment = input.after.segment;
    params.afterVideoId = input.after.videoId;
  }

  const query = `
    ${segmentPerVideoSql(conditions, latest, grouping, days)}
    SELECT
      segment,
      video_id,
      toString(published_at) as published_at
    FROM per_video
    WHERE ${segmentEligible(days)}${tagFilter ? ` AND ${tagFilter}` : ''}${keyset}
    ORDER BY segment ASC, video_id ASC
    LIMIT ${limit}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    segment: string;
    video_id: string;
    published_at: string;
  }>();

  return rows.map((row) => ({
    segment: String(row.segment),
    videoId: String(row.video_id),
    publishedAt: String(row.published_at),
  }));
}

export interface VideoLanguageRow {
  videoId: string;
  episodeId: string;
  platform: string;
  contentType: string;
  title: string;
  /** The published asset's language; null when nobody set one. */
  language: string | null;
  /** The channel's target language; null for a publish with no channel. */
  channelLanguage: string | null;
}

/** One page of queryVideoLanguages. Rows are small; pages are not the cost. */
const VIDEO_LANGUAGE_PAGE_SIZE = 50_000;

/**
 * Pages read before giving up — a million videos in one scope is a data
 * problem, and the answer to it is an error, not a breakdown computed over
 * the first million.
 */
const VIDEO_LANGUAGE_MAX_PAGES = 20;

/**
 * Every video in scope with both of its languages (FILM-1702).
 *
 * This is what the Language tab's per-video folds map through — the trend,
 * the platform matrix, geography — where it used to walk Postgres from
 * seasons to episodes to publishes to `platform_connections`. That walk is
 * why the tab could only ever see the channel's language, and why it could
 * not agree with anything read from here.
 *
 * Both languages come back on every row, so switching the dimension is a
 * different key into the same result rather than a second query that could
 * be scoped differently.
 *
 * Keyset-paged on `video_id`, which is the table's sort key and unique
 * after the argMax collapse. Throws past the page budget rather than
 * returning a partial list: a language whose videos all fell past the cut
 * would vanish from the breakdown and read as "we do not publish in it".
 */
export async function queryVideoLanguages(input: {
  scope: DimScope;
}): Promise<VideoLanguageRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);
  const rows: VideoLanguageRow[] = [];
  let after = '';

  for (let page = 0; page < VIDEO_LANGUAGE_MAX_PAGES; page++) {
    const result = await client.query({
      query: `
        SELECT
          video_id,
          toString(argMax(episode_id, updated_at)) as episode_id,
          argMax(platform, updated_at) as platform,
          argMax(content_type, updated_at) as content_type,
          argMax(title, updated_at) as title,
          argMax(language, updated_at) as language,
          argMax(channel_language, updated_at) as channel_language
        FROM (
          SELECT * FROM video_dim
          WHERE ${conditions} AND video_id > {afterVideoId: String}
        )
        GROUP BY video_id
        ${latest ? `HAVING ${latest}` : ''}
        ORDER BY video_id ASC
        LIMIT ${VIDEO_LANGUAGE_PAGE_SIZE}
      `,
      query_params: { ...params, afterVideoId: after },
      format: 'JSONEachRow',
    });

    const batch = await result.json<{
      video_id: string;
      episode_id: string;
      platform: string;
      content_type: string;
      title: string;
      language: string;
      channel_language: string;
    }>();

    for (const row of batch) {
      rows.push({
        videoId: String(row.video_id),
        episodeId: String(row.episode_id),
        platform: String(row.platform),
        contentType: String(row.content_type),
        title: String(row.title ?? ''),
        language: fromDimLanguage(String(row.language ?? '')),
        channelLanguage: fromDimLanguage(row.channel_language),
      });
    }

    if (batch.length < VIDEO_LANGUAGE_PAGE_SIZE) return rows;

    after = String(batch[batch.length - 1]!.video_id);
  }

  throw new Error(
    `queryVideoLanguages: more than ${
      VIDEO_LANGUAGE_PAGE_SIZE * VIDEO_LANGUAGE_MAX_PAGES
    } videos in scope; refusing to return a partial list`,
  );
}

export interface LanguagePairRow {
  /** The published asset's language; null when nobody set one. */
  language: string | null;
  /** The channel's target language; null for a publish with no channel. */
  channelLanguage: string | null;
  videoCount: number;
}

/**
 * How many videos carry each (content language, channel target) pair.
 *
 * The routing diagnostic FILM-1702 asks for: a publish whose language
 * differs from its channel's target landed on the wrong channel, or the
 * channel carries mixed content. Either way the two dimensions disagree
 * about it, and until now nothing could count how often.
 *
 * Pairs rather than one "divergent" total, because the caller has to keep
 * three things apart that a single number merges: pairs that differ, pairs
 * that agree, and pairs where one side was never set — which are not a
 * disagreement, only an absence. Cardinality is languages squared, so the
 * result is small whatever the library size.
 */
export async function queryLanguagePairs(input: {
  scope: DimScope;
}): Promise<LanguagePairRow[]> {
  if (!isClickHouseEnabled()) return [];
  assertDimScope(input.scope);

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);

  const result = await client.query({
    query: `
      WITH dim AS (${dimSubquery(conditions, latest)})
      SELECT
        language,
        channel_language,
        count() as video_count
      FROM dim
      GROUP BY language, channel_language
      ORDER BY video_count DESC, language ASC, channel_language ASC
    `,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    language: string;
    channel_language: string;
    video_count: number;
  }>();

  return rows.map((row) => ({
    language: fromDimLanguage(row.language),
    channelLanguage: fromDimLanguage(row.channel_language),
    videoCount: Number(row.video_count ?? 0),
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
  /** The published asset's language; null when nobody set one. */
  language: string | null;
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

  const orderColumn = Object.hasOwn(
    VIDEO_AGE_ORDER_COLUMNS,
    input.orderBy ?? 'published_at',
  )
    ? VIDEO_AGE_ORDER_COLUMNS[input.orderBy ?? 'published_at']!
    : VIDEO_AGE_ORDER_COLUMNS.published_at;
  const orderDirection = input.orderDirection === 'asc' ? 'ASC' : 'DESC';

  const client = getClickHouseClient();
  const { conditions, latest, params } = buildDimConditions(input.scope);

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

  const dimWhere = dimConditions.join(' AND ');

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
    FROM (${dimSubquery(dimWhere, latest)}) d
    LEFT JOIN ${scopedDailyStats(
      dimWhere,
      'project_id, video_id, metric_date, views',
    )} m
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
      language: fromDimLanguage(String(row.language ?? '')),
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
}): Promise<
  Array<{
    connectionId: string;
    metricDate: string;
    net: number;
    measured: boolean;
  }>
> {
  if (input.connectionIds.length === 0 || !isClickHouseEnabled()) {
    return [];
  }

  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        connection_id,
        metric_date,
        sum(net) as net,
        min(measured) as measured
      FROM (
        SELECT
          toString(connection_id) as connection_id,
          toString(metric_date)   as metric_date,
          -- TikTok and Instagram rows carry no measured loss (NULL, KB-111),
          -- and TikTok no measured gain (KB-114). ifNull keeps the net a
          -- number; \`measured\` says whether it is a movement at all, and
          -- reconstructSeries ignores the day when it is not.
          toInt64(ifNull(sum(gained), 0) - ifNull(sum(lost), 0)) as net,
          toUInt8(countIf(gained IS NOT NULL) > 0
            AND countIf(lost IS NOT NULL) > 0) as measured
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
          toInt64(sum(gained) - sum(lost)) as net,
          -- YouTube's Reporting ingest writes both columns, always.
          toUInt8(1) as measured
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
    measured: number;
  }>();

  return rows.map((row) => ({
    connectionId: row.connection_id,
    metricDate: row.metric_date,
    net: Number(row.net),
    measured: Number(row.measured) === 1,
  }));
}

/**
 * One channel's unique reach for one window, as the platform answered it
 * (migration 016). Idempotent per (connection, platform, window, as_of) via
 * ReplacingMergeTree. Never summed: see the migration.
 */
export interface ChannelWindowRow {
  connectionId: string;
  platform: 'instagram' | 'facebook';
  /** Last complete day in the window, YYYY-MM-DD. */
  asOf: string;
  windowDays: number;
  accountsReached: number | null;
  accountsReachedFollowers: number | null;
  accountsReachedNonFollowers: number | null;
  source: string;
}

/**
 * The `as_of` days a channel already has every window for — what the nightly
 * capture skips. Reads dates only, never a reach figure.
 */
export async function queryCompleteChannelWindowDays(input: {
  connectionId: string;
  platform: ChannelWindowRow['platform'];
  windowDays: readonly number[];
  since: string;
}): Promise<Set<string>> {
  if (!isClickHouseEnabled()) return new Set();

  const result = await getClickHouseClient().query({
    query: `
      SELECT toString(as_of) AS day
      FROM channel_windows FINAL
      WHERE connection_id = {connectionId: UUID}
        AND platform = {platform: String}
        AND as_of >= {since: Date}
        AND window_days IN {windowDays: Array(UInt16)}
      GROUP BY as_of
      HAVING uniqExact(window_days) = {expected: UInt32}
    `,
    query_params: {
      connectionId: input.connectionId,
      platform: input.platform,
      since: input.since,
      windowDays: [...input.windowDays],
      expected: input.windowDays.length,
    },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ day: string }>();

  return new Set(rows.map((row) => row.day));
}

export async function insertChannelWindows(
  rows: ChannelWindowRow[],
): Promise<void> {
  if (!isClickHouseEnabled() || rows.length === 0) return;

  await getClickHouseClient().insert({
    table: 'channel_windows',
    values: rows.map((row) => ({
      connection_id: row.connectionId,
      platform: row.platform,
      as_of: row.asOf,
      window_days: row.windowDays,
      accounts_reached: row.accountsReached,
      accounts_reached_followers: row.accountsReachedFollowers,
      accounts_reached_non_followers: row.accountsReachedNonFollowers,
      source: row.source,
    })),
    format: 'JSONEachRow',
  });
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
