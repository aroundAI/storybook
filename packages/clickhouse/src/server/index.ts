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
  insertVideoDims,
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortMedians,
  queryMedianByTag,
  queryMedianViewsPerVideo,
  queryRollingViews,
  queryTrafficSourceBreakdown,
  TRAFFIC_SOURCE_BUCKETS,
  queryVideoViewsAtAge,
  queryWatchWindowTotals,
} from '../queries-advanced';
export type {
  BackCatalogBucket,
  CohortCheckpointStats,
  CohortMedianRow,
  DimScope,
  MedianBucket,
  RollingViewsPoint,
  TagMedianRow,
  TrafficBucket,
  VideoAgeOrderBy,
  VideoAgeRow,
  WatchWindowTotals,
} from '../queries-advanced';

export {
  checkpointPredatesIngest,
  computeIngestLagDays,
  computeMaturity,
} from '../lib/video-age';

export {
  insertSubscriberSnapshot,
  querySubscriberAnchors,
  querySubscriberDeltas,
} from '../queries-advanced';

export { reconstructSeries } from '../lib/subscriber-series';
export type {
  SubscriberAnchor,
  SubscriberDelta,
  SubscriberPoint,
  SubscriberSource,
} from '../lib/subscriber-series';

export {
  MIN_MATURE_VIDEOS,
  computeCheckpointGrowth,
  computeCohortGrowth,
} from '../lib/cohort-growth';
export type {
  CohortGrowth,
  GrowthSuppressionReason,
} from '../lib/cohort-growth';

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

// FILM-1605: the traffic-source taxonomy is pure, so it is usable wherever
// grouped rows are rendered — the same split video-age and cohort-growth use.
export {
  TRAFFIC_SOURCE_GROUPS,
  groupForSource,
  groupTrafficRows,
  sourcesInGroup,
} from '../lib/traffic-groups';
export type {
  TrafficGroupBucket,
  TrafficGroupShare,
  TrafficSourceGroup,
  TrafficSourceRow,
} from '../lib/traffic-groups';
