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
  YouTubeDailyMetrics,
  YouTubeGender,
  YouTubeMetric,
  YouTubeTotals,
  YouTubeTrafficSource,
  YouTubeVideoInfo,
} from './types';

// Provider class and factory
export {
  createYouTubeAnalyticsProvider,
  YouTubeAnalyticsProvider,
} from './youtube-analytics';
