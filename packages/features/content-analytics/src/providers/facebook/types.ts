/**
 * Facebook video insights types (FILM-1720).
 *
 * Every figure is lifetime, as Meta reports it, and **null when not
 * measured**: a Reels metric on a video in the player, or a call Meta
 * refused for a reason other than permission. Never 0 for "not measured".
 *
 * There is no `views` here. Facebook counts four different kinds of view and
 * none of them is a view in YouTube's sense (FILM-1722), so each is its own
 * field, named for what it counts.
 */

export interface FacebookInsightsInput {
  /** The Page video's id: what publishing stores as the platform post id. */
  videoId: string;
}

export interface FacebookVideoTotals {
  /** Reactions of every type, summed (`…_by_reaction_type`). */
  reactions: number | null;
  comments: number | null;
  /** The video's Page post's `shares.count`. */
  shares: number | null;
  /** `post_media_view`: played or displayed. Meta's impression replacement. */
  mediaViews: number | null;
  /** `post_total_media_view_unique`: different people who viewed the post. */
  uniqueViewers: number | null;
  /** `blue_reels_play_count`: at least 1 ms, replays excluded. Reels only. */
  firstPlays: number | null;
  /** `fb_reels_replay_count`. Reels only. */
  replayCount: number | null;
  /** `total_video_views`: 3 seconds, or nearly all of a shorter video. */
  threeSecondViews: number | null;
  /** `total_video_views_organic` / `_paid`: Meta's split, never summed here. */
  threeSecondViewsOrganic: number | null;
  threeSecondViewsPaid: number | null;
  /** `total_video_views_autoplayed` / `_clicked_to_play`. */
  threeSecondViewsAutoplayed: number | null;
  threeSecondViewsClickedToPlay: number | null;
  /** `total_video_15s_views`. Not ThruPlay, which is an Ads metric. */
  fifteenSecondViews: number | null;
  /** `total_video_complete_views`: 97% or more of the video. */
  completeViews: number | null;
  /**
   * Milliseconds watched: `post_video_view_time` for a reel (replays
   * included), else `total_video_view_total_time`.
   */
  viewTimeMs: number | null;
  /** `post_video_followers`: follows Meta credits to the reel. Reels only. */
  follows: number | null;
}

/**
 * `total_video_retention_graph`: the share of 3-second views still playing
 * at each of 40 equal intervals, as a fraction of 1. Null when Meta sent no
 * graph, or one whose values are not fractions.
 */
export type FacebookRetentionGraph = readonly {
  elapsedRatio: number;
  watchRatio: number;
}[];

/**
 * The video's ad-break figures (FILM-1726), lifetime. Meta answers them
 * only to the admin of a Page that runs ad breaks.
 *
 * - `authorised`: Meta answered. A figure it left out is still null.
 * - `account_type_gated`: Meta refused for permission. The Page is not one
 *   whose earnings this token may read, which is the creator's to change.
 * - `unavailable`: refused for any other reason. Try again next sync.
 *
 * Not stored yet. `total_video_ad_break_earnings` is written nowhere until
 * a live response shows its unit and currency (FILM-1725 Check K), because
 * ClickHouse revenue is USD by construction (KB-12).
 */
export interface FacebookAdBreaks {
  access: 'authorised' | 'account_type_gated' | 'unavailable';
  /** `total_video_ad_break_earnings`: unit and currency unconfirmed. */
  earnings: number | null;
  /** `total_video_ad_break_ad_cpm`: what advertisers paid per 1,000 ad impressions. */
  cpm: number | null;
  /** `total_video_ad_break_ad_impressions`. */
  adImpressions: number | null;
  /** `creator_monetization_qualified_views`. */
  qualifiedViews: number | null;
}

/**
 * A video's 3-second views by age and gender, and by country
 * (`total_video_views_by_age_bucket_and_gender`,
 * `total_video_views_by_country_id`). Counts of 3-second views, the same
 * denominator as `threeSecondViews`; never people.
 */
export interface FacebookAudience {
  ageGender: { gender: 'F' | 'M' | 'U'; ageGroup: string; views: number }[];
  countries: { country: string; views: number }[];
}

/** One window of the Page's unique viewers, ending on the day asked for. */
export interface FacebookPageViewers {
  windowDays: 1 | 7 | 28;
  /** `page_total_media_view_unique`; null when Meta gave no figure. */
  viewers: number | null;
}

export interface FacebookInsightsResult {
  videoId: string;
  /** The Page post the video belongs to; null when Meta named none. */
  postId: string | null;
  totals: FacebookVideoTotals;
  retention: FacebookRetentionGraph | null;
  /** Null when Meta refused the read or sent neither breakdown. */
  audience: FacebookAudience | null;
  adBreaks: FacebookAdBreaks;
}
