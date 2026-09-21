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
 * `media_type` as Instagram returns it. A Reel is `VIDEO`; the surface a media
 * was published to is `InstagramMediaProductType`.
 */
export type InstagramMediaType = 'CAROUSEL_ALBUM' | 'IMAGE' | 'VIDEO';

/**
 * `media_product_type`: the surface. Decides which metrics exist — REELS has
 * watch time and skip rate, FEED and STORY have profile visits and follows.
 */
export type InstagramMediaProductType = 'AD' | 'FEED' | 'STORY' | 'REELS';

/**
 * Complete insights result for a media item
 */
export interface InstagramInsightsResult {
  mediaId: string;
  mediaType: InstagramMediaType;
  mediaProductType: InstagramMediaProductType;
  totals: InstagramTotals;
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
  /** null when the API omitted it; not zero. See FILM-1607 §2. */
  followerCount: number | null;
}

/**
 * Period for account insights queries
 */
export type InstagramInsightsPeriod = 'day' | 'week' | 'month';
