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
export { UNATTRIBUTED_CONNECTION_ID } from './dim-sync';

// Video dimension sync (FILM-1506)
export { upsertVideoDims } from './dim-sync';

// Deep-dive analytics actions (FILM-1506)
export {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getReturningViewerProxyAction,
  getRollingViewsAction,
  getTrafficBreakdownAction,
  getTrafficShareTrendAction,
  getYppProgressAction,
} from './deep-dive-actions';

// Hook Lab (FILM-1510)
export {
  addHookVariantAction,
  createHookTestAction,
  getHookTestAction,
  listHookTestsAction,
  refreshHookTestAction,
} from './hook-actions';
export {
  computeVariantRetention,
  refreshTestRetention,
} from './hook-retention';
export type { VariantRetention } from './hook-retention';

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
  updateTagAction,
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

export { captureSubscriberSnapshots } from './subscriber-snapshot';
export type { SubscriberCaptureResult } from './subscriber-snapshot';
export { getSubscriberSeriesAction } from './subscriber-series-actions';
export type { ConnectionSubscriberSeries } from './subscriber-series-actions';
