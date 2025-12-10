/**
 * TikTok Analytics Provider
 *
 * Exports for fetching analytics data from TikTok Creator Tools API.
 */

// Types
export type {
  TikTokAccountAnalytics,
  TikTokAgeGroup,
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokAudienceData,
  TikTokDailyMetrics,
  TikTokTotals,
  TikTokTrafficSource,
  TikTokTrafficSourceType,
  TikTokVideoData,
} from './types';

// Provider class, factory, and errors
export {
  createTikTokAnalyticsProvider,
  TikTokAnalyticsProvider,
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
  TikTokVideoNotFoundError,
} from './tiktok-analytics';
