/**
 * ClickHouse Query Helpers
 *
 * Typed query functions for inserting and querying analytics data.
 * All queries target the video_metrics / video_daily_stats tables.
 */
import {
  concatByChunk,
  fitsOneChunk,
  mergeMapsByChunk,
  sumByChunk,
  sumTotalsByChunk,
} from './chunked';
import { getClickHouseClient, isClickHouseEnabled } from './client';
import { assertPlatformSelection } from './lib/data-provenance';
import { PLATFORM_ENUM_TYPE } from './lib/platform-enum';
import { addMeasured, addViews } from './lib/views';
import { FACEBOOK_DENOMINATOR_COLUMNS } from './types';
import type {
  AggregatedTotals,
  ChannelDaily,
  ChannelReachDaily,
  DailyDataPoint,
  DailyPlatformBreakdown,
  DailyPlatformMetricsRow,
  DailyStats,
  MeasuredColumns,
  PerVideoTotals,
  PlatformBreakdown,
  QueryFilters,
  ScopeTotals,
  SnapshotTotals,
  VideoMetric,
  VideoReachDaily,
  VideoSnapshot,
  VideoTrafficSource,
} from './types';

// ==========================================
// INSERT OPERATIONS
// ==========================================

/**
 * Insert a batch of video metric events into ClickHouse.
 * Used by the analytics sync cron to dual-write during migration.
 */
export async function insertVideoMetrics(
  metrics: VideoMetric[],
): Promise<void> {
  if (metrics.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_metrics',
    values: metrics,
    format: 'JSONEachRow',
  });
}

/**
 * Insert lifetime cumulative snapshot rows into video_snapshots.
 * One retained row per (video, platform, day) — ReplacingMergeTree keeps the
 * latest fetch.
 */
export async function insertVideoSnapshots(
  snapshots: VideoSnapshot[],
): Promise<void> {
  if (snapshots.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_snapshots',
    values: snapshots,
    format: 'JSONEachRow',
  });
}

/**
 * Insert thumbnail reach rows (impressions/CTR) per video/day.
 */
export async function insertVideoReachDaily(
  rows: VideoReachDaily[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_reach_daily',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Insert traffic-source rows per video/day/source.
 */
export async function insertVideoTrafficSources(
  rows: VideoTrafficSource[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'video_traffic_sources',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Insert channel-level daily rollup rows for unmatched channel videos.
 */
export async function insertChannelDaily(rows: ChannelDaily[]): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'channel_daily',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Insert the channel reach residual — impressions for videos not published
 * through the platform. Its own table, never `channel_daily`: the two come
 * from separately delivered reports and would erase each other on a shared
 * key (FILM-1504).
 */
export async function insertChannelReachDaily(
  rows: ChannelReachDaily[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'channel_reach_daily',
    values: rows,
    format: 'JSONEachRow',
  });
}

/**
 * Fetch the latest lifetime snapshot strictly before the given date for each
 * video. Used by the sync worker to derive daily deltas for platforms that
 * only expose cumulative counters (TikTok, Instagram).
 *
 * Returns a map keyed by video_id (a publish belongs to a single platform).
 */
async function queryLatestSnapshotsSingle(input: {
  videoIds: string[];
  beforeDate: string;
}): Promise<Map<string, SnapshotTotals>> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) return new Map();

  const client = getClickHouseClient();

  const query = `
    SELECT
      video_id,
      toString(argMax(snapshot_date, fetched_at)) as snapshot_date,
      -- Nullable since migration 020 (Facebook), so the tuple form below.
      argMax(tuple(views), fetched_at).1 as views,
      argMax(likes, fetched_at) as likes,
      argMax(comments, fetched_at) as comments,
      -- Nullable since migration 021 (X), so the tuple form.
      argMax(tuple(shares), fetched_at).1 as shares,
      -- The latest snapshot's own values, NULL included: a bare argMax skips
      -- NULLs and would hand back an older figure (migration 017).
      argMax(tuple(saves), fetched_at).1 as saves,
      argMax(tuple(watch_time_seconds), fetched_at).1 as watch_time_seconds,
      argMax(tuple(subscribers_gained), fetched_at).1 as subscribers_gained,
      -- The latest snapshot's own reach, NULL included. A bare argMax skips
      -- NULLs and would hand back an older reach, making the next delta
      -- cover several days while dated to one.
      argMax(tuple(accounts_reached), fetched_at).1 as accounts_reached,
      argMax(tuple(reposts), fetched_at).1 as reposts,
      argMax(tuple(all_surface_views), fetched_at).1 as all_surface_views,
      argMax(tuple(all_surface_likes), fetched_at).1 as all_surface_likes,
      argMax(tuple(all_surface_comments), fetched_at).1 as all_surface_comments,
      ${FACEBOOK_DENOMINATOR_COLUMNS.map(
        (column) => `argMax(tuple(${column}), fetched_at).1 as ${column}`,
      ).join(',\n      ')}
    FROM (
      SELECT * FROM video_snapshots
      WHERE video_id IN {videoIds: Array(String)}
        AND snapshot_date < {beforeDate: Date}
    )
    GROUP BY video_id
  `;

  const result = await client.query({
    query,
    query_params: { videoIds: input.videoIds, beforeDate: input.beforeDate },
    format: 'JSONEachRow',
  });

  const rows = await result.json<SnapshotTotals & { video_id: string }>();
  const map = new Map<string, SnapshotTotals>();

  for (const row of rows) {
    map.set(row.video_id, {
      snapshot_date: row.snapshot_date,
      views: nullableNumber(row.views),
      likes: Number(row.likes),
      comments: Number(row.comments),
      shares: nullableNumber(row.shares),
      saves: row.saves == null ? null : Number(row.saves),
      watch_time_seconds:
        row.watch_time_seconds == null ? null : Number(row.watch_time_seconds),
      subscribers_gained:
        row.subscribers_gained == null ? null : Number(row.subscribers_gained),
      accounts_reached:
        row.accounts_reached == null ? null : Number(row.accounts_reached),
      reposts: row.reposts == null ? null : Number(row.reposts),
      all_surface_views:
        row.all_surface_views == null ? null : Number(row.all_surface_views),
      all_surface_likes:
        row.all_surface_likes == null ? null : Number(row.all_surface_likes),
      all_surface_comments:
        row.all_surface_comments == null
          ? null
          : Number(row.all_surface_comments),
      ...Object.fromEntries(
        FACEBOOK_DENOMINATOR_COLUMNS.map((column) => [
          column,
          nullableNumber(row[column]),
        ]),
      ),
    });
  }

  return map;
}

/** ClickHouse sends UInt64 as a string; NULL stays null, never 0. */
function nullableNumber(value: number | string | null | undefined) {
  return value == null ? null : Number(value);
}

// ==========================================
// QUERY OPERATIONS
// ==========================================

/**
 * Validate that at least one scoping filter is provided to prevent
 * accidental full-table scans.
 */
function assertScopedFilters(filters: QueryFilters): void {
  if (
    !filters.projectId &&
    (!filters.projectIds || filters.projectIds.length === 0) &&
    (!filters.videoIds || filters.videoIds.length === 0)
  ) {
    throw new Error(
      'ClickHouse query requires at least projectId or videoIds to prevent full table scans',
    );
  }
}

/**
 * Build a WHERE clause from query filters.
 * Returns the clause string (including the WHERE keyword) and parameter values.
 */
function buildWhereClause(filters: QueryFilters): {
  clause: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  // Both would be ANDed — `project_id = A AND project_id IN (B)` — which is
  // empty for any A not in B and reports as "no data" rather than as the
  // mistake it is. They mean the same thing, so asking for both is a caller
  // bug worth naming.
  if (filters.projectId && filters.projectIds?.length) {
    throw new Error(
      'ClickHouse query received both projectId and projectIds; pass one',
    );
  }

  if (filters.projectId) {
    conditions.push('project_id = {projectId: UUID}');
    params.projectId = filters.projectId;
  }

  if (filters.projectIds && filters.projectIds.length > 0) {
    conditions.push('project_id IN {projectIds: Array(UUID)}');
    params.projectIds = filters.projectIds;
  }

  if (filters.videoIds && filters.videoIds.length > 0) {
    conditions.push('video_id IN {videoIds: Array(String)}');
    params.videoIds = filters.videoIds;
  }

  // Present means "these platforms": an empty list is refused, not read as
  // every platform (FILM-1709). The Enum is the column's own, built from
  // the list the guard checks against.
  if (filters.platforms !== undefined) {
    assertPlatformSelection(filters.platforms);
    conditions.push(`platform IN {platforms: Array(${PLATFORM_ENUM_TYPE})}`);
    params.platforms = filters.platforms;
  }

  if (filters.startDate) {
    conditions.push('metric_date >= {startDate: Date}');
    params.startDate = filters.startDate;
  }

  if (filters.endDate) {
    conditions.push('metric_date <= {endDate: Date}');
    params.endDate = filters.endDate;
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Totals over no rows. Nothing measured views, nor the columns a platform
 * may not report, so they are null: no row is not "nobody watched"
 * (KB-162, KB-167).
 */
const NO_ROWS_TOTALS: ScopeTotals = {
  views: null,
  likes: 0,
  comments: 0,
  shares: null,
  saves: null,
  watch_time_seconds: null,
  revenue_cents: 0,
  subscribers_gained: null,
};

/**
 * The identity when summing chunked partials. Views start null: a chunk's
 * null takes the other side's figure, and a 0 here would turn an
 * all-Facebook selection's null into 0 (KB-153).
 */
const CHUNK_SUM_IDENTITY: ScopeTotals = NO_ROWS_TOTALS;

/**
 * The SQL for a nullable column's sum over the rows that measured it, and
 * whether any did (KB-114's flag). Read back with `measuredSum`. Needs
 * `prefer_column_name_to_alias`, so `count(col)` reads the column and not
 * the `sumIf(…) as col` alias.
 */
function measuredSumSql(column: keyof MeasuredColumns): string {
  return `sumIf(${column}, ${column} IS NOT NULL) as ${column},
      count(${column}) > 0 as ${column}_measured`;
}

/** A nullable column's sum: null where no row measured it, never 0 (KB-162). */
function measuredSum(
  value: number | string | null,
  measured: number | boolean,
): number | null {
  return Number(measured) ? Number(value) : null;
}

/**
 * Account/project totals.
 *
 * A `videoIds` list longer than one request is split and the partials
 * summed — every field here is a sum, so that is exact. See `chunked.ts`
 * for why the id list cannot simply be passed through.
 */
export async function queryTotals(
  filters:
    | (QueryFilters & { projectId: string })
    | (QueryFilters & { videoIds: string[] }),
): Promise<ScopeTotals> {
  const videoIds = (filters as QueryFilters).videoIds;

  if (!videoIds || fitsOneChunk(videoIds)) return queryTotalsSingle(filters);

  return sumTotalsByChunk(
    videoIds,
    (chunk) => queryTotalsSingle({ ...filters, videoIds: chunk }),
    CHUNK_SUM_IDENTITY,
  );
}

/** Daily series, folded on date when the id list spans several requests. */
export async function queryDailyTimeSeries(
  filters: QueryFilters,
): Promise<DailyDataPoint[]> {
  const videoIds = filters.videoIds;

  if (!videoIds || fitsOneChunk(videoIds)) {
    return queryDailyTimeSeriesSingle(filters);
  }

  const merged = await sumByChunk(
    videoIds,
    (chunk) => queryDailyTimeSeriesSingle({ ...filters, videoIds: chunk }),
    (row) => row.date,
  );

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

/** Platform breakdown, folded on platform across chunks. */
export async function queryPlatformBreakdown(
  filters: QueryFilters,
): Promise<PlatformBreakdown[]> {
  const videoIds = filters.videoIds;

  if (!videoIds || fitsOneChunk(videoIds)) {
    return queryPlatformBreakdownSingle(filters);
  }

  return sumByChunk(
    videoIds,
    (chunk) => queryPlatformBreakdownSingle({ ...filters, videoIds: chunk }),
    (row) => row.platform,
  );
}

/**
 * Per-video totals. Keyed by video, so chunks are disjoint and the maps
 * merge by assignment.
 */
export async function queryPerVideoTotals(
  filters: QueryFilters & { videoIds: string[] },
): Promise<Map<string, PerVideoTotals>> {
  if (fitsOneChunk(filters.videoIds)) return queryPerVideoTotalsSingle(filters);

  return mergeMapsByChunk(filters.videoIds, (chunk) =>
    queryPerVideoTotalsSingle({ ...filters, videoIds: chunk }),
  );
}

async function queryTotalsSingle(
  filters:
    | (QueryFilters & { projectId: string })
    | (QueryFilters & { videoIds: string[] }),
): Promise<ScopeTotals> {
  if (!isClickHouseEnabled()) return { ...NO_ROWS_TOTALS };
  const client = getClickHouseClient();
  assertScopedFilters(filters);
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      ${measuredSumSql('shares')},
      ${measuredSumSql('saves')},
      ${measuredSumSql('watch_time_seconds')},
      sum(revenue_cents) as revenue_cents,
      ${measuredSumSql('subscribers_gained')},
      count() as row_count
    FROM video_daily_stats
    ${clause}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
    clickhouse_settings: { prefer_column_name_to_alias: 1 },
  });

  const rows = await result.json<
    AggregatedTotals & { row_count: number } & MeasuredFlagsRow
  >();

  if (rows.length === 0) return { ...NO_ROWS_TOTALS };

  // ClickHouse returns numbers as strings, ensure they're numeric
  const row = rows[0]!;

  return {
    // No rows, or rows that are all Facebook's: not measured (KB-167).
    views: Number(row.row_count) === 0 ? null : nullableNumber(row.views),
    likes: Number(row.likes),
    comments: Number(row.comments),
    shares: measuredSum(row.shares, row.shares_measured),
    saves: measuredSum(row.saves, row.saves_measured),
    watch_time_seconds: measuredSum(
      row.watch_time_seconds,
      row.watch_time_seconds_measured,
    ),
    revenue_cents: Number(row.revenue_cents),
    subscribers_gained: measuredSum(
      row.subscribers_gained,
      row.subscribers_gained_measured,
    ),
  };
}

/**
 * Query daily time series data from video_daily_stats.
 * Groups by date and returns sorted daily data points.
 */
async function queryDailyTimeSeriesSingle(
  filters: QueryFilters,
): Promise<DailyDataPoint[]> {
  if (!isClickHouseEnabled()) return [];
  assertScopedFilters(filters);
  const client = getClickHouseClient();
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      toString(metric_date) as date,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      ${measuredSumSql('saves')},
      ${measuredSumSql('watch_time_seconds')},
      sum(revenue_cents) as revenue_cents
    FROM video_daily_stats
    ${clause}
    GROUP BY metric_date
    ORDER BY metric_date ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
    clickhouse_settings: { prefer_column_name_to_alias: 1 },
  });

  const rows = await result.json<DailyDataPoint & MeasuredFlagsRow>();

  return rows.map((row) => ({
    date: row.date,
    views: nullableNumber(row.views),
    likes: Number(row.likes),
    comments: Number(row.comments),
    shares: Number(row.shares),
    saves: measuredSum(row.saves, row.saves_measured),
    watch_time_seconds: measuredSum(
      row.watch_time_seconds,
      row.watch_time_seconds_measured,
    ),
    revenue_cents: Number(row.revenue_cents),
  }));
}

/**
 * Query platform breakdown from video_daily_stats.
 * Groups metrics by platform.
 */
async function queryPlatformBreakdownSingle(
  filters: QueryFilters,
): Promise<PlatformBreakdown[]> {
  if (!isClickHouseEnabled()) return [];
  assertScopedFilters(filters);
  const client = getClickHouseClient();
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      platform,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      ${measuredSumSql('shares')},
      ${measuredSumSql('saves')},
      sum(revenue_cents) as revenue_cents
    FROM video_daily_stats
    ${clause}
    GROUP BY platform
    -- The sum, not \`views\`: prefer_column_name_to_alias reads the column.
    ORDER BY sum(views) DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
    clickhouse_settings: { prefer_column_name_to_alias: 1 },
  });

  const rows = await result.json<
    PlatformBreakdown &
      Pick<MeasuredFlagsRow, 'shares_measured' | 'saves_measured'>
  >();

  return rows.map((row) => ({
    platform: row.platform,
    views: nullableNumber(row.views),
    likes: Number(row.likes),
    comments: Number(row.comments),
    // One platform's sum: null when none of its rows measured shares (X).
    shares: measuredSum(row.shares, row.shares_measured),
    saves: measuredSum(row.saves, row.saves_measured),
    revenue_cents: Number(row.revenue_cents),
  }));
}

/**
 * Query per-video totals from video_daily_stats.
 * Returns totals grouped by video_id for a set of video IDs.
 */
async function queryPerVideoTotalsSingle(
  filters: QueryFilters & { videoIds: string[] },
): Promise<Map<string, PerVideoTotals>> {
  if (!isClickHouseEnabled()) return new Map();
  assertScopedFilters(filters);
  const client = getClickHouseClient();
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      video_id,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      sum(saves) as saves,
      sum(watch_time_seconds) as watch_time_seconds,
      sum(revenue_cents) as revenue_cents,
      sum(subscribers_gained) as subscribers_gained,
      -- \`count(col)\` must read the column, not the \`sum(col) AS col\` alias
      -- above it; prefer_column_name_to_alias below makes it (KB-114).
      count(shares) > 0 as shares_measured,
      count(saves) > 0 as saves_measured,
      count(watch_time_seconds) > 0 as watch_time_seconds_measured,
      count(subscribers_gained) > 0 as subscribers_gained_measured
    FROM video_daily_stats
    ${clause}
    GROUP BY video_id
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
    clickhouse_settings: { prefer_column_name_to_alias: 1 },
  });

  const rows = await result.json<
    AggregatedTotals & { video_id: string } & MeasuredFlagsRow
  >();
  const map = new Map<string, PerVideoTotals>();

  for (const row of rows) {
    map.set(row.video_id, {
      views: nullableNumber(row.views),
      likes: Number(row.likes),
      comments: Number(row.comments),
      shares: Number(row.shares),
      // A sum over only NULLs is NULL; Number(null) is 0, and `measured`
      // says whether that 0 is one (KB-114).
      saves: Number(row.saves),
      watch_time_seconds: Number(row.watch_time_seconds),
      revenue_cents: Number(row.revenue_cents),
      subscribers_gained: Number(row.subscribers_gained),
      measured: measuredFlags(row),
    });
  }

  return map;
}

/**
 * Query raw daily stats rows (not aggregated).
 * Useful for detailed per-video per-day data.
 */
/**
 * Raw per-video per-day rows. Each row names its video, so chunks are
 * disjoint and concatenate.
 */
export async function queryDailyStats(
  filters: QueryFilters,
): Promise<DailyStats[]> {
  const videoIds = filters.videoIds;

  if (!videoIds || fitsOneChunk(videoIds))
    return queryDailyStatsSingle(filters);

  return concatByChunk(videoIds, (chunk) =>
    queryDailyStatsSingle({ ...filters, videoIds: chunk }),
  );
}

/** Latest snapshot per video — keyed by video, so maps merge by assignment. */
export async function queryLatestSnapshots(input: {
  videoIds: string[];
  beforeDate: string;
}): Promise<Map<string, SnapshotTotals>> {
  if (fitsOneChunk(input.videoIds)) return queryLatestSnapshotsSingle(input);

  return mergeMapsByChunk(input.videoIds, (chunk) =>
    queryLatestSnapshotsSingle({ ...input, videoIds: chunk }),
  );
}

/**
 * Daily series with a nested per-platform breakdown.
 *
 * This one needs its own merge: the generic fold sums top-level numbers but
 * would keep the first chunk's `byPlatform` object untouched, silently
 * dropping the other chunks' platform figures.
 */
export async function queryDailyTimeSeriesByPlatform(
  filters: QueryFilters,
): Promise<DailyPlatformBreakdown[]> {
  const videoIds = filters.videoIds;

  if (!videoIds || fitsOneChunk(videoIds)) {
    return queryDailyTimeSeriesByPlatformSingle(filters);
  }

  const rows = await concatByChunk(videoIds, (chunk) =>
    queryDailyTimeSeriesByPlatformSingle({ ...filters, videoIds: chunk }),
  );

  const byDate = new Map<string, DailyPlatformBreakdown>();

  for (const row of rows) {
    const existing = byDate.get(row.date);

    if (!existing) {
      byDate.set(row.date, { ...row, byPlatform: { ...row.byPlatform } });
      continue;
    }

    existing.views = addViews(existing.views, row.views);
    existing.likes += row.likes;
    existing.comments += row.comments;
    existing.shares += row.shares;

    for (const [platform, engagement] of Object.entries(row.byPlatform)) {
      const current = existing.byPlatform[platform];

      existing.byPlatform[platform] = current
        ? {
            views: addViews(current.views, engagement.views),
            likes: current.likes + engagement.likes,
            comments: current.comments + engagement.comments,
            shares: addMeasured(current.shares, engagement.shares),
          }
        : { ...engagement };
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

async function queryDailyStatsSingle(
  filters: QueryFilters,
): Promise<DailyStats[]> {
  if (!isClickHouseEnabled()) return [];
  const client = getClickHouseClient();
  assertScopedFilters(filters);
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      project_id,
      video_id,
      platform,
      toString(metric_date) as metric_date,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      sum(saves) as saves,
      sum(watch_time_seconds) as watch_time_seconds,
      sum(revenue_cents) as revenue_cents,
      sum(subscribers_gained) as subscribers_gained,
      -- \`count(col)\` must read the column, not the \`sum(col) AS col\` alias
      -- above it; prefer_column_name_to_alias below makes it (KB-114).
      count(shares) > 0 as shares_measured,
      count(saves) > 0 as saves_measured,
      count(watch_time_seconds) > 0 as watch_time_seconds_measured,
      count(subscribers_gained) > 0 as subscribers_gained_measured
    FROM (SELECT * FROM video_daily_stats ${clause})
    GROUP BY project_id, video_id, platform, metric_date
    ORDER BY metric_date DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
    clickhouse_settings: { prefer_column_name_to_alias: 1 },
  });

  const rows = await result.json<DailyStats & MeasuredFlagsRow>();

  return rows.map((row) => ({
    project_id: row.project_id,
    video_id: row.video_id,
    platform: row.platform,
    metric_date: row.metric_date,
    views: nullableNumber(row.views),
    likes: Number(row.likes),
    comments: Number(row.comments),
    shares: Number(row.shares),
    saves: Number(row.saves),
    watch_time_seconds: Number(row.watch_time_seconds),
    revenue_cents: Number(row.revenue_cents),
    subscribers_gained: Number(row.subscribers_gained),
    measured: measuredFlags(row),
  }));
}

/** The `<col>_measured` flags the per-video and daily reads select. */
interface MeasuredFlagsRow {
  shares_measured: number | boolean;
  saves_measured: number | boolean;
  watch_time_seconds_measured: number | boolean;
  subscribers_gained_measured: number | boolean;
}

function measuredFlags(row: MeasuredFlagsRow): MeasuredColumns {
  return {
    shares: Boolean(Number(row.shares_measured)),
    saves: Boolean(Number(row.saves_measured)),
    watch_time_seconds: Boolean(Number(row.watch_time_seconds_measured)),
    subscribers_gained: Boolean(Number(row.subscribers_gained_measured)),
  };
}

/**
 * Query total views for specific video IDs (lightweight).
 * Used for RPM calculations in revenue actions.
 */
export async function queryViewsForVideos(
  projectId: string,
  videoIds: string[],
): Promise<number> {
  if (videoIds.length === 0 || !isClickHouseEnabled()) return 0;

  const client = getClickHouseClient();
  const filters: QueryFilters = { projectId, videoIds };
  assertScopedFilters(filters);
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT sum(views) as total_views
    FROM video_daily_stats
    ${clause}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ total_views: number }>();

  return rows.length > 0 ? Number(rows[0]!.total_views) : 0;
}

/**
 * Query daily time series with per-platform breakdown.
 * Returns both aggregate daily totals and per-platform splits.
 */
async function queryDailyTimeSeriesByPlatformSingle(
  filters: QueryFilters,
): Promise<DailyPlatformBreakdown[]> {
  if (!isClickHouseEnabled()) return [];
  const client = getClickHouseClient();
  assertScopedFilters(filters);
  const { clause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      toString(metric_date) as date,
      platform,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares
    FROM video_daily_stats
    ${clause}
    GROUP BY metric_date, platform
    ORDER BY metric_date ASC, platform ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<DailyPlatformMetricsRow>();

  // Group by date, aggregate totals and platform splits
  const dateMap = new Map<string, Omit<DailyPlatformBreakdown, 'date'>>();

  for (const row of rows) {
    const existing = dateMap.get(row.date) || {
      views: null,
      likes: 0,
      comments: 0,
      shares: 0,
      byPlatform: {},
    };

    const v = nullableNumber(row.views);
    const l = Number(row.likes);
    const c = Number(row.comments);
    const s = nullableNumber(row.shares);

    existing.views = addViews(existing.views, v);
    existing.likes += l;
    existing.comments += c;
    // The day's total is the shares of the platforms that report them.
    existing.shares += s ?? 0;
    existing.byPlatform[row.platform] = {
      views: v,
      likes: l,
      comments: c,
      shares: s,
    };

    dateMap.set(row.date, existing);
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

/**
 * Query per-video totals by video IDs only (no project ID required).
 * Useful for episode-level queries where project ID isn't available.
 */
export async function queryTotalsByVideoIds(
  videoIds: string[],
  options?: {
    startDate?: string;
    endDate?: string;
    /**
     * The projects those videos belong to, when the caller knows them.
     * Bounds what is read, never what is returned — `video_metrics` is
     * `ORDER BY (project_id, …)`, so a `video_id`-only filter scans the
     * table. Opt-in, for the reason the "videoId-only reads span
     * project_id by design" note in `verify-queries.ts` records.
     */
    projectIds?: string[];
  },
): Promise<Map<string, PerVideoTotals>> {
  if (videoIds.length === 0 || !isClickHouseEnabled()) return new Map();

  const filters: QueryFilters & { videoIds: string[] } = {
    videoIds,
    startDate: options?.startDate,
    endDate: options?.endDate,
    ...(options?.projectIds?.length ? { projectIds: options.projectIds } : {}),
  };

  return queryPerVideoTotals(filters);
}
