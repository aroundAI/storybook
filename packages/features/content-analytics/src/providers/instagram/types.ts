/**
 * Instagram Insights Provider Types
 *
 * Types for fetching and normalizing Instagram Insights data.
 * Uses Meta Graph API v23.0.
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
  | 'views'
  | 'reach'
  | 'total_interactions'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  /** FEED and STORY only. Not available for REELS. */
  | 'profile_visits'
  /** FEED and STORY only. Not available for REELS. */
  | 'follows';

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
  audience?: InstagramAudienceData;
}

/**
 * Aggregate totals for a media item
 */
export interface InstagramTotals {
  views: number;
  reach: number;
  totalInteractions: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  profileVisits: number;
  follows: number;
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
  views: number;
  reach: number;
  /** null when the API omitted it; not zero. See FILM-1607 §2. */
  followerCount: number | null;
}

/**
 * Period for account insights queries
 */
export type InstagramInsightsPeriod = 'day' | 'week' | 'month';
