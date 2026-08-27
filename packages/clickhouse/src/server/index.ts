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

export {
  insertRetentionCurves,
  insertVideoAudience,
  queryAudienceRows,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryTrafficSources,
} from '../queries-detail';
export type { VideoQualityMetrics } from '../queries-detail';

export {
  DEFAULT_BROWSE_SUGGESTED_SOURCES,
  insertVideoDims,
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortCurves,
  queryMedianByTag,
  queryMedianViewsPerVideo,
  queryRollingViews,
  queryTrafficShareTrend,
  queryWatchWindowTotals,
} from '../queries-advanced';
export type {
  BackCatalogBucket,
  CohortRow,
  DimScope,
  MedianBucket,
  RollingViewsPoint,
  TagMedianRow,
  TrafficShareBucket,
  WatchWindowTotals,
} from '../queries-advanced';

export type {
  AggregatedTotals,
  AnalyticsPlatform,
  AudienceDimension,
  ChannelDaily,
  DailyDataPoint,
  DailyPlatformBreakdown,
  DailyStats,
  MetricSource,
  PlatformBreakdown,
  PlatformEngagement,
  QueryFilters,
  RetentionCurvePoint,
  SnapshotTotals,
  VideoAudienceRow,
  VideoDim,
  VideoMetric,
  VideoReachDaily,
  VideoSnapshot,
  VideoTrafficSource,
} from '../types';

export { formatDateStr } from '../utils';
