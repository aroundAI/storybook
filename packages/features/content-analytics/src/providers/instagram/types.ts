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
  | 'shares';
// `profile_visits` and `follows` are FEED and STORY only — not REELS, which is
// what creators publish — and we request neither. They are not declared here
// so no result can claim them (FILM-1712; provider-result-fields.test.ts).

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
  views: number;
  /** Lifetime unique accounts reached (estimated); null when Meta omits it. */
  reach: number | null;
  totalInteractions: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  /**
   * Reels only: total watch time and Meta's own average, in milliseconds
   * (observed on a live account, 2026-09-29). Null for other media, or when
   * Meta omits it. The average is Meta's — not total ÷ views, which it isn't.
   */
  watchTimeMs: number | null;
  avgWatchTimeMs: number | null;
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
  /** Meta reports age and gender as separate breakdowns (FILM-1712) */
  ages: Array<{
    ageGroup: string; // e.g., "25-34"
    count: number;
  }>;
  genders: Array<{
    gender: string; // "F", "M" or "U"
    count: number;
  }>;
}

/**
 * The account's unique reach over one window; null when Meta omits it.
 * `followers` + `nonFollowers` need not equal the total (Meta also answers
 * UNKNOWN).
 */
export interface InstagramAccountReach {
  accountsReached: number | null;
  followers: number | null;
  nonFollowers: number | null;
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
