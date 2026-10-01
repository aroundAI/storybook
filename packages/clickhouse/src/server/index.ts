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
  insertChannelReachDaily,
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
  queryDailyReachForVideos,
  queryDataDaysForVideos,
  queryFollowerStatusByUploadMonth,
  queryNetSubscribersForVideos,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryRetentionCurves,
  queryTrafficSources,
} from '../queries-detail';
export type {
  DailyReachRow,
  DataDaySource,
  FollowerStatusMonth,
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
  queryObservedCoverage,
  queryRollingViews,
  querySegmentMembership,
  querySegmentPerformance,
  queryTrafficSourceBreakdown,
  queryVideoBenchmark,
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
  insertChannelWindows,
  insertSubscriberSnapshot,
  queryCompleteChannelWindowDays,
  querySubscriberAnchors,
  querySubscriberDeltas,
} from '../queries-advanced';
export type { ChannelWindowRow } from '../queries-advanced';

// Channel experiments (FILM-1724): each video's own first days.
export { queryChannelExperimentVideoDays } from '../queries-advanced';
export type {
  ExperimentVideoDay,
  ExperimentVideoDays,
  ExperimentVideoFacts,
  ExperimentVideoReachDay,
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
  ChannelReachDaily,
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
  YouTubeVideoMetric,
  MeasuredColumns,
  PerVideoTotals,
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
  windowTrafficMix,
} from '../lib/traffic-groups';
export type {
  TrafficBucket,
  TrafficGroupBucket,
  TrafficGroupShare,
  TrafficSourceGroup,
  TrafficSourceRow,
  TrafficSourceShare,
  WindowGroupShare,
  WindowSourceShare,
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

export {
  PURGE_CHANNEL_TABLES,
  PURGE_INDEX_TABLE,
  PURGE_VIDEO_TABLES,
  purgeConnectionFromClickHouse,
  purgeStatements,
  queryConnectionVideoIds,
} from '../purge';
export type {
  PurgeOutcome,
  PurgeStatement,
  PurgeTable,
  PurgeTarget,
} from '../purge';

export {
  queryChannelNewAccounts,
  queryChannelReach,
  queryPostAccountsReached,
  queryPostsAccountsReached,
} from '../reach';
export type {
  ChannelNewAccountsDay,
  ChannelReachDay,
  PostAccountsReached,
  PostReachSummary,
  ReachPlatform,
} from '../reach';
