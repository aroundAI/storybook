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
  insertChannelDaily,
  insertVideoMetrics,
  insertVideoReachDaily,
  insertVideoSnapshots,
  insertVideoTrafficSources,
  queryDailyStats,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryLatestSnapshots,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryTotals,
  queryTotalsByVideoIds,
  queryViewsForVideos,
} from '../queries';

export type {
  AggregatedTotals,
  AnalyticsPlatform,
  ChannelDaily,
  DailyDataPoint,
  DailyPlatformBreakdown,
  DailyStats,
  MetricSource,
  PlatformBreakdown,
  PlatformEngagement,
  QueryFilters,
  SnapshotTotals,
  VideoMetric,
  VideoReachDaily,
  VideoSnapshot,
  VideoTrafficSource,
} from '../types';

export { formatDateStr } from '../utils';
