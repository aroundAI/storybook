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
  AllSurfaceAggregates,
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
} from './types';

export { formatDateStr } from './utils';

export {
  TRAFFIC_SOURCE_GROUPS,
  TRAFFIC_SOURCE_BUCKETS,
  groupForSource,
  groupTrafficRows,
  sourcesInGroup,
  windowTrafficMix,
} from './lib/traffic-groups';
export type {
  TrafficBucket,
  TrafficGroupBucket,
  TrafficGroupShare,
  TrafficSourceGroup,
  TrafficSourceRow,
  TrafficSourceShare,
  WindowGroupShare,
  WindowSourceShare,
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
  SUPPORT_ORDER,
  TABLE_WRITERS,
  WRITER_CALL_SITES,
  accessFor,
  allowedMetricSources,
  capabilityFor,
  coverageSummary,
  platformsWithData,
  unclaimedPlatforms,
  weakestSupport,
} from './lib/data-provenance';
export type {
  AccessPendingVerification,
  AccessState,
  AccessVerified,
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

// Every rate defined once, and velocity at the grain the data has
// (FILM-1713). Pure, so the dashboards and the server share one definition.
export {
  MEASURE_INPUT_SUPPORT,
  PREFERRED_DENOMINATOR,
  attentionEfficiency,
  computeMeasure,
  displayedEngagementRatePercent,
  engagementRatio,
} from './lib/measures';
export type {
  AttentionEfficiency,
  DenominatorStamp,
  InputSupportCell,
  InstagramMediaSurface,
  Measure,
  MeasureAbsence,
  MeasureCounts,
  MeasureId,
  MeasureInput,
  RateMeasureId,
} from './lib/measures';
export {
  ACCELERATING_AT,
  AGE_BUCKETS,
  DECELERATING_AT,
  STALLED_SHARE_OF_PEAK,
  VELOCITY_GRAIN,
  ageBucket,
  compareVelocity,
  dailyVelocities,
  growthState,
} from './lib/velocity';
export type {
  AgeBucketId,
  DailyPoint,
  GrowthState,
  VelocityReading,
} from './lib/velocity';

// A published asset's duration or the reason there is none (FILM-1710), and
// the format family axis it can refine (FILM-1716). Pure, so a card and a
// query agree on which family a video is in.
export {
  ASSET_DURATION_PLATFORMS,
  DURATION_UNKNOWN,
  normalizeAssetDurationSeconds,
  resolveAssetDuration,
} from './lib/asset-duration';
export type {
  AssetDuration,
  AssetDurationPlatform,
} from './lib/asset-duration';
export {
  CONTENT_TYPES,
  DURATION_REFINEMENTS,
  FORMAT_BY_CONTENT_TYPE,
  FORMAT_FAMILIES,
  FORMAT_FAMILY_LABEL,
  PUBLISH_PLATFORMS,
  contentTypesFor,
  formatFamilyOfDim,
  formatFamilyPredicate,
  resolveFormatFamily,
  unmappedFormatPairs,
} from './lib/format-families';
export type {
  ContentType,
  FormatFamily,
  FormatFamilyResolution,
  PublishPlatform,
} from './lib/format-families';

// The signal model (FILM-1714): five platform-independent funnel stages, and
// the per-platform x per-format map that binds signals to them. Support is
// computed from the capability matrix, never authored. Pure.
export {
  FAMILIES_OUTSIDE_THE_FUNNEL,
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_QUESTION,
  SIGNALS,
  SIGNAL_IDS,
  SIGNAL_INPUT_GAPS,
  SIGNAL_MAP,
  computeSignalSupport,
  signalSupport,
  stageReading,
  stageReadings,
} from './lib/signal-map';
export type {
  FormatStageMap,
  FunnelStage,
  PublishFormat,
  SignalComposition,
  SignalDefinition,
  SignalId,
  SignalInputGap,
  SignalInputSupport,
  SignalSupport,
  SignalUnitCheck,
  StageBinding,
  StageReading,
  UnavailableSignal,
  UnboundReason,
} from './lib/signal-map';

// What "a view" means per platform, and when it changed (FILM-1722). Pure,
// so a chart can ask where a boundary falls without reaching the server.
export {
  INSTAGRAM_AGGREGATES,
  INSTAGRAM_AGGREGATE_FIELDS,
  PLATFORM_IDS,
  VIEW_DEFINITIONS,
  comparableAcross,
  viewDefinitionAt,
  viewDefinitionChangesBetween,
  viewsDenominatorFor,
} from './lib/view-definitions';
export type {
  AllSurfaceColumn,
  ContinuousAlternative,
  InstagramAggregate,
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
  ViewsColumn,
  ViewsDenominator,
} from './lib/view-definitions';
