/**
 * Instagram Insights Provider Types
 *
 * Types for fetching and normalizing Instagram Insights data.
 * Uses Meta Graph API v18.0.
 */

/**
 * Input for fetching media insights
 */
export interface InstagramInsightsInput {
  mediaId: string;
  metrics?: InstagramMetric[];
}

/**
 * Available Instagram Insights metrics
 */
export type InstagramMetric =
  | 'plays'
  | 'reach'
  | 'total_interactions'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'profile_visits'
  | 'follows'
  | 'impressions';

/**
 * Media type returned by Instagram
 */
export type InstagramMediaType = 'REELS' | 'VIDEO';

/**
 * Complete insights result for a media item
 */
export interface InstagramInsightsResult {
  mediaId: string;
  mediaType: InstagramMediaType;
  totals: InstagramTotals;
  reachBreakdown?: InstagramReachBreakdown;
  audience?: InstagramAudienceData;
}

/**
 * Aggregate totals for a media item
 */
export interface InstagramTotals {
  plays: number;
  reach: number;
  impressions: number;
  totalInteractions: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  profileVisits: number;
  follows: number;
}

/**
 * Reach breakdown by follower type (Reels only)
 */
export interface InstagramReachBreakdown {
  followerReach: number;
  nonFollowerReach: number;
  followersPercentage: number;
}

/**
 * Account-level audience demographics
 */
export interface InstagramAudienceData {
  countries: Array<{
    country: string;
    count: number;
  }>;
  cities: Array<{
    city: string;
    count: number;
  }>;
  genderAge: Array<{
    dimension: string; // e.g., "F.25-34"
    count: number;
  }>;
}

/**
 * Account-level insights overview
 */
export interface InstagramAccountInsights {
  impressions: number;
  reach: number;
  profileViews: number;
  websiteClicks: number;
  followerCount: number;
}

/**
 * Period for account insights queries
 */
export type InstagramInsightsPeriod = 'day' | 'week' | 'month';
