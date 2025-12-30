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
