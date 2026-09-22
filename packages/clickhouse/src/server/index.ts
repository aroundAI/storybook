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
  queryDataDaysForVideos,
  queryNetSubscribersForVideos,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryRetentionCurves,
  queryTrafficSources,
} from '../queries-detail';
export type {
  DataDaySource,
  RetentionPoint,
  VideoQualityMetrics,
  VideoSubscriberTotals,
} from '../queries-detail';

export {
  insertVideoDims,
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortMedians,
  queryMedianViewsPerVideo,
  queryRollingViews,
  querySegmentMembership,
  querySegmentPerformance,
  queryTrafficSourceBreakdown,
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
  SegmentKind,
  SegmentMembershipRow,
  SegmentPerformanceRow,
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

export {
  queryLatestSubscriberLevels,
  querySubscriberSeries,
} from '../subscriber-levels';
export type {
  ConnectionSubscriberSeries,
  LatestSubscriberLevel,
} from '../subscriber-levels';
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

export {
  CONFIDENCE_DIRECTIONAL_MIN,
  CONFIDENCE_REPORTABLE_MIN,
  SPREAD_CARRIED_ABOVE,
  SPREAD_CONSISTENT_BELOW,
  computeSpread,
  interpretSpread,
  pooledRpmCents,
  resolveConfidence,
} from '../lib/segment-stats';
export type {
  SegmentConfidence,
  SpreadInterpretation,
} from '../lib/segment-stats';

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
  TRAFFIC_SOURCE_BUCKETS,
  groupForSource,
  groupTrafficRows,
  sourcesInGroup,
} from '../lib/traffic-groups';
export type {
  TrafficBucket,
  TrafficGroupBucket,
  TrafficGroupShare,
  TrafficSourceGroup,
  TrafficSourceRow,
} from '../lib/traffic-groups';

// Language dimensions (FILM-1702).
export {
  LANGUAGE_DIMENSION_SEGMENTS,
  queryLanguagePairs,
  queryVideoLanguages,
} from '../queries-advanced';
export type { LanguagePairRow, VideoLanguageRow } from '../queries-advanced';
export {
  LANGUAGE_DIMENSIONS,
  LANGUAGE_NOT_SET,
  fromDimLanguage,
  toDimLanguage,
} from '../lib/language-dimension';
export type { LanguageDimension } from '../lib/language-dimension';
