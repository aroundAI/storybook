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
export { calculateChanges, generateInsightsAction } from './insights-actions';

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
  getEpisodeAnalytics,
  getProjectAnalytics,
  getSeasonAnalytics,
  type EpisodeAnalytics,
  type ProjectAnalytics,
  type SeasonAnalytics,
} from './aggregation-queries';

// Types
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
