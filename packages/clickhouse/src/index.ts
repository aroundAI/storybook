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

// The capability matrix (FILM-1703). Pure for the same reason as the traffic
// groups above, and it has to stay in code: a copy in the database could not
// be bound to the writers, which is the only thing that keeps it true.
export {
  ANALYTICS_PLATFORMS,
  AUDIENCE_FAMILY_DIMENSIONS,
  CAPABILITY_MATRIX,
  INGESTION_MARKERS,
  METRIC_FAMILIES,
  TABLE_WRITERS,
  WRITER_CALL_SITES,
  accessFor,
  allowedMetricSources,
  capabilityFor,
  coverageSummary,
  platformsWithData,
  unclaimedPlatforms,
} from './lib/data-provenance';
export type {
  AccessState,
  AccountTypeGate,
  Availability,
  CapabilityCitation,
  CoverageCaveat,
  CoverageSummary,
  DataWindow,
  DerivationMethod,
  IngestionMarker,
  MetricFamily,
  OurAccessState,
  PlatformCapability,
  SourceTable,
  SupportLevel,
} from './lib/data-provenance';

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

// The two language dimensions and the not-set sentinel (FILM-1702). Shared
// with the browser so a card never restates what an empty language means.
export {
  LANGUAGE_DIMENSIONS,
  LANGUAGE_NOT_SET,
  fromDimLanguage,
  toDimLanguage,
} from './lib/language-dimension';
export type { LanguageDimension } from './lib/language-dimension';

// What "a view" means per platform, and when it changed (FILM-1722). Pure,
// so a chart can ask where a boundary falls without reaching the server.
export {
  PLATFORM_IDS,
  VIEW_DEFINITIONS,
  comparableAcross,
  viewDefinitionAt,
  viewDefinitionChangesBetween,
} from './lib/view-definitions';
export type {
  ContinuousAlternative,
  PlatformId,
  VendorFact,
  ViewComparability,
  ViewComparisonSuppressionReason,
  ViewCountsFrom,
  ViewDefinition,
  ViewDefinitionChange,
  ViewDefinitionLookup,
  ViewDefinitionOptions,
  ViewFormat,
} from './lib/view-definitions';
