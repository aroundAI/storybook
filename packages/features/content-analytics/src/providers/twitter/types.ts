/**
 * X analytics on the pay-per-use tier (FILM-1727): one post read through
 * `GET /2/tweets`, with the post's `public_metrics` and its video's
 * `public_metrics` and `non_public_metrics`.
 *
 * Names follow X's, from the data dictionary
 * (https://docs.x.com/x-api/fundamentals/data-dictionary, read 2026-10-01).
 * The quartiles are `playback_N_count`, the posts-lookup vocabulary. The
 * Enterprise endpoint's `playback25` is a different vocabulary on a different
 * endpoint and has no type here: nothing calls it.
 */

/** The post's `public_metrics`. Every member is required by X. */
export interface XPostPublicMetrics {
  retweet_count: number;
  reply_count: number;
  like_count: number;
  quote_count: number;
  bookmark_count: number;
  impression_count: number;
}

/** A video's `non_public_metrics`: plays that reached each point. */
export interface XMediaNonPublicMetrics {
  playback_0_count: number;
  playback_25_count: number;
  playback_50_count: number;
  playback_75_count: number;
  playback_100_count: number;
}

export interface XMediaObject {
  media_key: string;
  type: string;
  public_metrics?: { view_count?: number };
  non_public_metrics?: Partial<XMediaNonPublicMetrics>;
}

export interface XPostLookupResponse {
  data?: Array<{
    id: string;
    public_metrics?: Partial<XPostPublicMetrics>;
    attachments?: { media_keys?: string[] };
  }>;
  includes?: { media?: XMediaObject[] };
  errors?: Array<{ title?: string; detail?: string; resource_id?: string }>;
}

/**
 * How many plays reached each point of the video, as X counts them. Null as a
 * whole when X returned no quartiles: a post without a video, or a response
 * without the non-public group.
 */
export interface XPlaybackQuartiles {
  started: number;
  quarter: number;
  half: number;
  threeQuarters: number;
  complete: number;
}

export interface XAnalyticsResult {
  postId: string;
  totals: {
    /** The video's `view_count`; null for a post without a video. */
    views: number | null;
    likes: number;
    /** X's replies: the comments of a post. */
    replies: number;
    /** `retweet_count`, which X now labels Reposts. */
    reposts: number;
    /** `bookmark_count`: X's save. */
    bookmarks: number;
  };
  quartiles: XPlaybackQuartiles | null;
}
