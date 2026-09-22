/**
 * TikTok Analytics Provider Types
 *
 * Types for fetching and normalizing TikTok Analytics data.
 * Uses TikTok Creator Tools API.
 */

/**
 * Input for fetching video analytics
 */
export interface TikTokAnalyticsInput {
  videoId: string;
  dateRange?: 7 | 28; // Days
}

/**
 * Complete analytics result for a video
 */
export interface TikTokAnalyticsResult {
  videoId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  totals: TikTokTotals;
  dailyData: TikTokDailyMetrics[];
  audience?: TikTokAudienceData;
  trafficSources?: TikTokTrafficSource[];
}

/**
 * Aggregate totals for the period
 */
export interface TikTokTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  followersGained: number;
  averageWatchTime: number; // seconds
  totalPlayTime: number; // seconds
  fullVideoWatchedRate: number; // 0-1
}

/**
 * Daily breakdown of key metrics
 *
 * Note: TikTok API does not provide per-video daily breakdown,
 * so this is typically empty or account-level data.
 */
export interface TikTokDailyMetrics {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  profileViews: number;
}

/**
 * Audience demographic data
 */
export interface TikTokAudienceData {
  countries: Array<{
    country: string;
    percentage: number;
  }>;
  genderDistribution: {
    male: number;
    female: number;
    other: number;
  };
  ageGroups: Array<{
    ageGroup: TikTokAgeGroup;
    percentage: number;
  }>;
}

/**
 * Age group categories used by TikTok
 */
export type TikTokAgeGroup =
  | '13-17'
  | '18-24'
  | '25-34'
  | '35-44'
  | '45-54'
  | '55+';

/**
 * Traffic source breakdown
 */
export interface TikTokTrafficSource {
  source: TikTokTrafficSourceType;
  percentage: number;
}

/**
 * Traffic source categories used by TikTok
 */
export type TikTokTrafficSourceType =
  | 'For You'
  | 'Following'
  | 'Sound'
  | 'Hashtag'
  | 'Profile'
  | 'Search'
  | 'Other';

/**
 * Account-level analytics result
 */
export interface TikTokAccountAnalytics {
  /** null when the API omitted it; not zero. See FILM-1607 §2. */
  followers: number | null;
  followersGained: number;
  profileViews: number;
  videoViews: number;
}

/**
 * TikTok Display API `/v2/video/query/` response shape.
 *
 * Only fields this endpoint actually returns. It previously declared
 * `save_count`, `average_watch_time`, `total_play_time`,
 * `full_video_watched_rate` and `traffic_source_types`, none of which exist on
 * it — four metrics read as zero and looked measured. The real names, where
 * they exist at all, are on the Business API.
 * See docs/platform-capability-reference.md.
 */
export interface TikTokVideoData {
  id: string;
  /** The published asset's length in seconds (FILM-1710). */
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}
