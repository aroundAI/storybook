/**
 * @kit/clickhouse/server - Server-side API
 *
 * Exports the ClickHouse client and query functions.
 * Only import this from server-side code (API routes, server actions, cron jobs).
 */

export {
    closeClickHouseClient,
    getClickHouseClient,
    isClickHouseEnabled,
    pingClickHouse,
} from '../client';

export {
    insertVideoMetrics,
    queryDailyStats,
    queryDailyTimeSeries,
    queryPerVideoTotals,
    queryPlatformBreakdown,
    queryTotals,
    queryViewsForVideos,
} from '../queries';

export type {
    AggregatedTotals,
    AnalyticsPlatform,
    DailyDataPoint,
    DailyStats,
    PlatformBreakdown,
    QueryFilters,
    VideoMetric,
} from '../types';
