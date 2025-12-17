/**
 * YouTube Analytics Provider Types
 *
 * Types for fetching and normalizing YouTube Analytics data.
 * Uses YouTube Analytics API v2 and YouTube Data API v3.
 */

/**
 * Input for fetching video analytics
 */
export interface YouTubeAnalyticsInput {
  videoId: string;
  startDate: Date;
  endDate: Date;
  metrics?: YouTubeMetric[];
}

/**
 * Available YouTube Analytics metrics
 */
export type YouTubeMetric =
  | 'views'
  | 'likes'
  | 'dislikes'
  | 'comments'
  | 'shares'
  | 'estimatedMinutesWatched'
  | 'averageViewDuration'
  | 'averageViewPercentage'
  | 'subscribersGained'
  | 'subscribersLost'
  | 'estimatedRevenue'
  | 'annotationClickThroughRate'
  | 'cardClickRate';

/**
 * Complete analytics result for a video
 */
export interface YouTubeAnalyticsResult {
  videoId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  totals: YouTubeTotals;
  dailyData: YouTubeDailyMetrics[];
  retention?: RetentionData;
  demographics?: DemographicData;
  trafficSources?: TrafficSourceData[];
  geography?: GeographyData[];
  /** Device type breakdown (mobile, desktop, tablet, TV, etc.) */
  deviceBreakdown?: DeviceBreakdownData[];
  /** Operating system breakdown (iOS, Android, Windows, etc.) */
  operatingSystem?: OperatingSystemData[];
  /** City-level geography breakdown */
  cityGeography?: CityGeographyData[];
  /** Views from subscribed vs non-subscribed viewers */
  subscribedStatus?: SubscribedStatusData;
}

/**
 * Aggregate totals for the period
 */
export interface YouTubeTotals {
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number; // seconds
  averageViewPercentage: number;
  subscribersGained: number;
  subscribersLost: number;
  estimatedRevenue: number; // cents (total)
  estimatedAdRevenue: number; // cents (ad revenue portion)
  estimatedRedPartnerRevenue: number; // cents (YouTube Premium portion)
}

/**
 * Daily breakdown of key metrics
 */
export interface YouTubeDailyMetrics {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  subscribersGained: number;
}

/**
 * Audience retention curve data
 */
export interface RetentionData {
  /** Percentage of viewers still watching at each point */
  points: Array<{
    /** Position in video (0-1, e.g., 0.5 = halfway) */
    elapsedVideoTimeRatio: number;
    /** Percentage of audience still watching (0-1) */
    audienceWatchRatio: number;
  }>;
}

/**
 * Age group categories used by YouTube
 */
export type YouTubeAgeGroup =
  | 'age13-17'
  | 'age18-24'
  | 'age25-34'
  | 'age35-44'
  | 'age45-54'
  | 'age55-64'
  | 'age65-';

/**
 * Gender categories used by YouTube
 */
export type YouTubeGender = 'male' | 'female' | 'user_specified';

/**
 * Demographic breakdown of viewers
 */
export interface DemographicData {
  ageGroups: Array<{
    ageGroup: YouTubeAgeGroup;
    viewPercentage: number;
  }>;
  genders: Array<{
    gender: YouTubeGender;
    viewPercentage: number;
  }>;
}

/**
 * Traffic source categories used by YouTube
 */
export type YouTubeTrafficSource =
  | 'ADVERTISING'
  | 'BROWSE_FEATURES'
  | 'END_SCREEN'
  | 'EXT_URL'
  | 'NOTIFICATION'
  | 'PLAYLIST'
  | 'RELATED_VIDEO'
  | 'SUBSCRIBER'
  | 'YT_SEARCH'
  | 'OTHER';

/**
 * Traffic source breakdown
 */
export interface TrafficSourceData {
  source: YouTubeTrafficSource;
  views: number;
  watchTimeMinutes: number;
}

/**
 * Geographic breakdown by country
 */
export interface GeographyData {
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  views: number;
  watchTimeMinutes: number;
  viewPercentage: number;
}

/**
 * Basic video information from YouTube Data API
 */
export interface YouTubeVideoInfo {
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  duration: number; // seconds
}

/**
 * Device type breakdown data
 */
export interface DeviceBreakdownData {
  deviceType:
    | 'DESKTOP'
    | 'MOBILE'
    | 'TABLET'
    | 'TV'
    | 'GAME_CONSOLE'
    | 'UNKNOWN_PLATFORM';
  views: number;
  watchTimeMinutes: number;
}

/**
 * Operating system breakdown data
 */
export interface OperatingSystemData {
  operatingSystem: string;
  views: number;
}

/**
 * City-level geography data
 */
export interface CityGeographyData {
  city: string;
  views: number;
}

/**
 * Subscribed status breakdown
 */
export interface SubscribedStatusData {
  subscribed: number;
  notSubscribed: number;
}
