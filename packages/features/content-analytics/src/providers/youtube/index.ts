/**
 * YouTube Analytics Provider
 *
 * Exports for fetching analytics data from YouTube Analytics API.
 */

// Types
export type {
  DemographicData,
  GeographyData,
  RetentionData,
  TrafficSourceData,
  YouTubeAgeGroup,
  YouTubeAnalyticsInput,
  YouTubeAnalyticsResult,
  YouTubeChannelDay,
  YouTubeChannelStatistics,
  YouTubeDailyMetrics,
  YouTubeDailyTrafficSource,
  YouTubeGender,
  YouTubeMetric,
  YouTubeTotals,
  YouTubeTrafficSource,
  YouTubeVideoInfo,
  YouTubeVideoStatistics,
} from './types';

// Provider class, factory, and errors
export {
  createYouTubeAnalyticsProvider,
  YouTubeAnalyticsProvider,
  YouTubeAnalyticsScopeError,
} from './youtube-analytics';

// Reporting API (bulk reports) provider
export {
  createYouTubeReportingProvider,
  YouTubeReportingProvider,
  YOUTUBE_REPORT_TYPES,
} from './youtube-reporting';
export type {
  YouTubeReport,
  YouTubeReportJob,
  YouTubeReportTypeId,
} from './youtube-reporting';
