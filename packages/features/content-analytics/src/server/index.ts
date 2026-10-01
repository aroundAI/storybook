/**
 * Analytics Sync Server Module
 *
 * Provides cron job functionality and server actions for syncing
 * analytics from YouTube, TikTok, and Instagram into the local database.
 */

// Main cron job functions
export {
  runAnalyticsSyncJob,
  syncSinglePublishById,
} from './analytics-sync-cron';

// Historical backfill (FILM-1503)
export { runYouTubeBackfillBatch } from './backfill/youtube-backfill';
export type { BackfillBatchResult } from './backfill/youtube-backfill';

// YouTube Reporting API bulk ingest (FILM-1504)
export { runReportingIngestJob } from './reporting/report-ingest';
export type { ReportIngestResult } from './reporting/report-ingest';

// Channel dimension (FILM-1602)
export { listAccountChannels, listProjectChannels } from './channels';
export type { ChannelRef } from './channels';
export { listChannelsAction } from './channels-actions';
export { fetchAccountAnalyticsSettings } from './settings-queries';
export { UNATTRIBUTED_CONNECTION_ID } from './dim-sync';

// Video dimension sync (FILM-1506)
export { upsertVideoDims } from './dim-sync';

// Published asset duration: the single writer, and its backfill (FILM-1710)
export {
  runAssetDurationBackfillBatch,
  syncAssetDurations,
} from './asset-duration-sync';
export type {
  AssetDurationBackfillResult,
  AssetDurationGap,
  AssetDurationSyncResult,
} from './asset-duration-sync';

// Deep-dive analytics actions (FILM-1506)
export {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getReturningViewerProxyAction,
  getRollingViewsAction,
  getTrafficBreakdownAction,
  getYppProgressAction,
} from './deep-dive-actions';

// Weekly diagnostics and the retention drill-down (FILM-1616)
export {
  getEpisodeAnalyticsAction,
  getEpisodeRetentionPublishAction,
  getRetentionCurveAction,
  getWeeklyDiagnosticsAction,
} from './diagnostics-actions';

// Analytics settings writer (FILM-1608)
export {
  getAnalyticsSettingsAction,
  updateAccountAnalyticsSettingsAction,
  updateChannelAnalyticsSettingsAction,
} from './settings-actions';
export type {
  AnalyticsSettingsView,
  ChannelSettingsEntry,
  UpdateAnalyticsSettingsResult,
} from './settings-actions';

// Experiment log actions (FILM-1509)
export {
  abandonExperimentAction,
  concludeExperimentAction,
  createExperimentAction,
  deleteExperimentAction,
  getExperimentAction,
  listExperimentsAction,
  startExperimentAction,
  updateExperimentAction,
} from './experiment-actions';
export type { ExperimentSnapshot } from './experiment-actions';

// Revenue alerts (FILM-1508)
export { evaluateRevenueAlerts } from './revenue-alerts';

// Content taxonomy actions (FILM-1507)
export {
  bulkTagPublishesAction,
  createTagAction,
  deleteTagAction,
  getMedianByTagAction,
  getPublishTagsAction,
  listTagsAction,
  setPublishTagsAction,
} from './taxonomy-actions';

// Server actions
export { getSyncStatusAction, manualSyncAction } from './sync-actions';
export { generateInsightsAction } from './insights-actions';
export { calculateChanges, parseInsightsResponse } from '../lib/insights-utils';

// Revenue actions
export {
  addManualRevenueAction,
  deleteManualRevenueAction,
  generateRevenueReportAction,
  getRevenueProjectionAction,
  getRevenueSummaryAction,
  getRevenueTimeSeriesAction,
  getTopContentByRevenueAction,
  syncRevenueFromPlatformAction,
} from './revenue-actions';

// Schedule utilities
export {
  getIntervalHours,
  getSyncPriority,
  getSyncSchedule,
  shouldSyncNow,
} from './schedule';

// Rate limiter
export {
  getRateLimitConfig,
  getRateLimiter,
  resetRateLimiter,
} from './rate-limiter';

// Aggregation queries
export {
  getContentList,
  getEpisodeAnalytics,
  getProjectAnalytics,
  getSeasonAnalytics,
  type ContentListItem,
  type EpisodeAnalytics,
  type ProjectAnalytics,
  type SeasonAnalytics,
} from './aggregation-queries';

// Dashboard actions (FILM-805)
export {
  getContentListAction,
  getProjectAnalyticsAction,
  getProjectRevenueByCurrencyAction,
} from './dashboard-actions';

// Account-level dashboard actions
export {
  getAccountDashboardData,
  type AccountDashboardData,
} from './account-dashboard-actions';

// Language and content type analytics
export {
  getLanguagePerformance,
  getPlatformLanguageMatrix,
  getContentTypeComparison,
  getShortsSourcePerformance,
  getGeographyByLanguage,
  getLanguageTrend,
  getLanguageDivergence,
  type LanguageCheckpoint,
  type LanguagePerformance,
  type PlatformLanguageEntry,
  type ContentTypeComparison,
  type ShortsSourcePerformance,
  type GeographyByLanguage,
  type LanguageTrendEntry,
} from './language-analytics';

// Language AI insights
export {
  generateLanguageInsightsAction,
  type LanguageInsightsResult,
} from './language-insights-actions';
export type {
  NormalizedAnalytics,
  PublishForSync,
  PublishMetadata,
  RateLimitConfig,
  SyncJobResult,
  SyncMetadata,
  SyncPlatform,
  SyncResult,
  SyncSchedule,
  SyncStatusResponse,
} from './types';

// Report generation actions
export {
  createScheduledReportAction,
  deleteScheduledReportAction,
  generateReportAction,
  getScheduledReportsAction,
  updateScheduledReportAction,
} from './report-actions';

export { getVideoLogAction } from './video-log-actions';
export type { VideoLogRow } from './video-log-actions';

export { getSegmentPerformanceAction } from './segment-actions';
export type {
  RevenueStatus,
  SegmentPerformanceEntry,
  SegmentPerformanceResult,
} from './segment-actions';

export { getGenomeFindingsAction } from './genome-actions';
export type { GenomeFindingsResult, GenomeRefusal } from './genome-actions';

export { captureSubscriberSnapshots } from './subscriber-snapshot';
export { captureChannelReachWindows } from './channel-reach-windows';
export type { ChannelReachCaptureResult } from './channel-reach-windows';
export type { SubscriberCaptureResult } from './subscriber-snapshot';
export { runVendorDataPurges } from './vendor-data-purge';
export type { VendorDataPurgeRunResult } from './vendor-data-purge';
export { getSubscriberSeriesAction } from './subscriber-series-actions';
// From its source, not the action module: in a 'use server' file every
// export is compiled as a runtime binding, and a type has none.
export type { ConnectionSubscriberSeries } from '@kit/clickhouse/server';
