/**
 * ClickHouse Query Helpers
 *
 * Typed query functions for inserting and querying analytics data.
 * All queries target the video_metrics / video_daily_stats tables.
 */

import { getClickHouseClient } from './client';
import type {
    AggregatedTotals,
    DailyDataPoint,
    DailyStats,
    PlatformBreakdown,
    QueryFilters,
    VideoMetric,
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
    if (metrics.length === 0) return;

    const client = getClickHouseClient();

    await client.insert({
        table: 'video_metrics',
        values: metrics,
        format: 'JSONEachRow',
    });
}

// ==========================================
// QUERY OPERATIONS
// ==========================================

/**
 * Validate that at least one scoping filter is provided to prevent
 * accidental full-table scans.
 */
function assertScopedFilters(filters: QueryFilters): void {
    if (!filters.projectId && (!filters.videoIds || filters.videoIds.length === 0)) {
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

    if (filters.projectId) {
        conditions.push('project_id = {projectId: UUID}');
        params.projectId = filters.projectId;
    }

    if (filters.videoIds && filters.videoIds.length > 0) {
        conditions.push('video_id IN {videoIds: Array(String)}');
        params.videoIds = filters.videoIds;
    }

    if (filters.platforms && filters.platforms.length > 0) {
        conditions.push(
            `platform IN {platforms: Array(Enum('youtube', 'tiktok', 'instagram'))}`,
        );
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
        clause:
            conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '',
        params,
    };
}

/**
 * Query aggregated totals from video_daily_stats.
 * Returns summed views, likes, comments, shares, etc.
 */
export async function queryTotals(
    filters: QueryFilters & { projectId: string } | QueryFilters & { videoIds: string[] },
): Promise<AggregatedTotals> {
    const client = getClickHouseClient();
    assertScopedFilters(filters);
    const { clause, params } = buildWhereClause(filters);

    const query = `
    SELECT
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      sum(saves) as saves,
      sum(watch_time_seconds) as watch_time_seconds,
      sum(revenue_cents) as revenue_cents,
      sum(subscribers_gained) as subscribers_gained
    FROM video_daily_stats
    ${clause}
  `;

    const result = await client.query({
        query,
        query_params: params,
        format: 'JSONEachRow',
    });

    const rows = await result.json<AggregatedTotals>();

    if (rows.length === 0) {
        return {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            saves: 0,
            watch_time_seconds: 0,
            revenue_cents: 0,
            subscribers_gained: 0,
        };
    }

    // ClickHouse returns numbers as strings, ensure they're numeric
    const row = rows[0]!;

    return {
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        shares: Number(row.shares),
        saves: Number(row.saves),
        watch_time_seconds: Number(row.watch_time_seconds),
        revenue_cents: Number(row.revenue_cents),
        subscribers_gained: Number(row.subscribers_gained),
    };
}

/**
 * Query daily time series data from video_daily_stats.
 * Groups by date and returns sorted daily data points.
 */
export async function queryDailyTimeSeries(
    filters: QueryFilters,
): Promise<DailyDataPoint[]> {
    const client = getClickHouseClient();
    const { clause, params } = buildWhereClause(filters);

    const query = `
    SELECT
      toString(metric_date) as date,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      sum(saves) as saves,
      sum(watch_time_seconds) as watch_time_seconds,
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
    });

    const rows = await result.json<DailyDataPoint>();

    return rows.map((row) => ({
        date: row.date,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        shares: Number(row.shares),
        saves: Number(row.saves),
        watch_time_seconds: Number(row.watch_time_seconds),
        revenue_cents: Number(row.revenue_cents),
    }));
}

/**
 * Query platform breakdown from video_daily_stats.
 * Groups metrics by platform.
 */
export async function queryPlatformBreakdown(
    filters: QueryFilters,
): Promise<PlatformBreakdown[]> {
    const client = getClickHouseClient();
    const { clause, params } = buildWhereClause(filters);

    const query = `
    SELECT
      platform,
      sum(views) as views,
      sum(likes) as likes,
      sum(comments) as comments,
      sum(shares) as shares,
      sum(saves) as saves,
      sum(revenue_cents) as revenue_cents
    FROM video_daily_stats
    ${clause}
    GROUP BY platform
    ORDER BY views DESC
  `;

    const result = await client.query({
        query,
        query_params: params,
        format: 'JSONEachRow',
    });

    const rows = await result.json<PlatformBreakdown>();

    return rows.map((row) => ({
        platform: row.platform,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        shares: Number(row.shares),
        saves: Number(row.saves),
        revenue_cents: Number(row.revenue_cents),
    }));
}

/**
 * Query per-video totals from video_daily_stats.
 * Returns totals grouped by video_id for a set of video IDs.
 */
export async function queryPerVideoTotals(
    filters: QueryFilters & { videoIds: string[] },
): Promise<Map<string, AggregatedTotals>> {
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
      sum(subscribers_gained) as subscribers_gained
    FROM video_daily_stats
    ${clause}
    GROUP BY video_id
  `;

    const result = await client.query({
        query,
        query_params: params,
        format: 'JSONEachRow',
    });

    const rows = await result.json<AggregatedTotals & { video_id: string }>();
    const map = new Map<string, AggregatedTotals>();

    for (const row of rows) {
        map.set(row.video_id, {
            views: Number(row.views),
            likes: Number(row.likes),
            comments: Number(row.comments),
            shares: Number(row.shares),
            saves: Number(row.saves),
            watch_time_seconds: Number(row.watch_time_seconds),
            revenue_cents: Number(row.revenue_cents),
            subscribers_gained: Number(row.subscribers_gained),
        });
    }

    return map;
}

/**
 * Query raw daily stats rows (not aggregated).
 * Useful for detailed per-video per-day data.
 */
export async function queryDailyStats(
    filters: QueryFilters,
): Promise<DailyStats[]> {
    const client = getClickHouseClient();
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
      sum(subscribers_gained) as subscribers_gained
    FROM video_daily_stats
    ${clause}
    GROUP BY project_id, video_id, platform, metric_date
    ORDER BY metric_date DESC
  `;

    const result = await client.query({
        query,
        query_params: params,
        format: 'JSONEachRow',
    });

    const rows = await result.json<DailyStats>();

    return rows.map((row) => ({
        project_id: row.project_id,
        video_id: row.video_id,
        platform: row.platform,
        metric_date: row.metric_date,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        shares: Number(row.shares),
        saves: Number(row.saves),
        watch_time_seconds: Number(row.watch_time_seconds),
        revenue_cents: Number(row.revenue_cents),
        subscribers_gained: Number(row.subscribers_gained),
    }));
}

/**
 * Query total views for specific video IDs (lightweight).
 * Used for RPM calculations in revenue actions.
 */
export async function queryViewsForVideos(
    projectId: string,
    videoIds: string[],
): Promise<number> {
    if (videoIds.length === 0) return 0;

    const client = getClickHouseClient();

    const query = `
    SELECT sum(views) as total_views
    FROM video_daily_stats
    WHERE project_id = {projectId: UUID}
      AND video_id IN {videoIds: Array(String)}
  `;

    const result = await client.query({
        query,
        query_params: { projectId, videoIds },
        format: 'JSONEachRow',
    });

    const rows = await result.json<{ total_views: number }>();

    return rows.length > 0 ? Number(rows[0]!.total_views) : 0;
}

/**
 * Query daily time series with per-platform breakdown.
 * Returns both aggregate daily totals and per-platform splits.
 */
export async function queryDailyTimeSeriesByPlatform(
    filters: QueryFilters,
): Promise<
    {
        date: string;
        views: number;
        likes: number;
        comments: number;
        shares: number;
        byPlatform: Record<
            string,
            { views: number; likes: number; comments: number; shares: number }
        >;
    }[]
> {
    const client = getClickHouseClient();
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

    const rows = await result.json<{
        date: string;
        platform: string;
        views: number;
        likes: number;
        comments: number;
        shares: number;
    }>();

    // Group by date, aggregate totals and platform splits
    const dateMap = new Map<
        string,
        {
            views: number;
            likes: number;
            comments: number;
            shares: number;
            byPlatform: Record<
                string,
                {
                    views: number;
                    likes: number;
                    comments: number;
                    shares: number;
                }
            >;
        }
    >();

    for (const row of rows) {
        const existing = dateMap.get(row.date) || {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            byPlatform: {},
        };

        const v = Number(row.views);
        const l = Number(row.likes);
        const c = Number(row.comments);
        const s = Number(row.shares);

        existing.views += v;
        existing.likes += l;
        existing.comments += c;
        existing.shares += s;
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
    options?: { startDate?: string; endDate?: string },
): Promise<Map<string, AggregatedTotals>> {
    if (videoIds.length === 0) return new Map();

    const filters: QueryFilters & { videoIds: string[] } = {
        videoIds,
        startDate: options?.startDate,
        endDate: options?.endDate,
    };

    return queryPerVideoTotals(filters);
}
