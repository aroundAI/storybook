/**
 * @kit/clickhouse - Public API
 *
 * Client-safe exports (types only).
 * For server-side usage with the actual client, import from '@kit/clickhouse/server'.
 */

// Pure and dependency-free — no ClickHouse client behind it — so the
// browser bundle can share the growth threshold and the suppression
// vocabulary with the server rather than restating them and drifting.
export { MIN_MATURE_VIDEOS } from './lib/cohort-growth';
export type {
  CohortGrowth,
  GrowthSuppressionReason,
} from './lib/cohort-growth';

// Same argument for the segment vocabulary: the card decides how to render
// a directional row, so it needs the tiers the server assigned, not a
// second copy of the thresholds.
export {
  CONFIDENCE_DIRECTIONAL_MIN,
  CONFIDENCE_REPORTABLE_MIN,
  SPREAD_CARRIED_ABOVE,
  SPREAD_CONSISTENT_BELOW,
  computeSpread,
  interpretSpread,
  pooledRpmCents,
  resolveConfidence,
} from './lib/segment-stats';
export type {
  SegmentConfidence,
  SpreadInterpretation,
} from './lib/segment-stats';

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
} from './types';

export { formatDateStr } from './utils';

export {
  TRAFFIC_SOURCE_GROUPS,
  TRAFFIC_SOURCE_BUCKETS,
  groupForSource,
  groupTrafficRows,
  sourcesInGroup,
} from './lib/traffic-groups';
export type {
  TrafficBucket,
  TrafficGroupBucket,
  TrafficGroupShare,
  TrafficSourceGroup,
  TrafficSourceRow,
} from './lib/traffic-groups';
export type {
  SubscriberPoint,
  SubscriberSource,
} from './lib/subscriber-series';
export {
  buildLatestLevel,
  buildSubscriberSeries,
} from './lib/subscriber-levels-core';
export type {
  ConnectionSubscriberSeries,
  LatestSubscriberLevel,
  SubscriberInputs,
} from './lib/subscriber-levels-core';
export {
  SUBSCRIBER_LEVEL_FRESH_DAYS,
  SUBSCRIBER_SOURCE_LABEL,
  SUBSCRIBER_TRACKED_PLATFORMS,
  isLevelOutdated,
  isMeasuredSource,
  isSubscriberTracked,
  roundingErrorOf,
  weakestSource,
} from './lib/subscriber-vocabulary';
export type { SubscriberTrackedPlatform } from './lib/subscriber-vocabulary';
