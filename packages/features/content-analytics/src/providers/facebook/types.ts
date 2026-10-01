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

export interface FacebookInsightsResult {
  videoId: string;
  /** The Page post the video belongs to; null when Meta named none. */
  postId: string | null;
  totals: FacebookVideoTotals;
  retention: FacebookRetentionGraph | null;
}
