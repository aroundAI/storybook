import 'server-only';

import { X_API_BASE } from '@kit/shared/vendors';

import type {
  XAnalyticsResult,
  XMediaObject,
  XPlaybackQuartiles,
  XPostLookupResponse,
  XPostPublicMetrics,
} from './types';

/**
 * X analytics on the pay-per-use tier (FILM-1727).
 *
 * One call: the posts lookup, asking for the post's `public_metrics` and its
 * video's `public_metrics` and `non_public_metrics`
 * (https://docs.x.com/x-api/posts/get-posts-by-ids, read 2026-10-01). Every
 * call is billed — $0.005 per post returned — so the provider makes exactly
 * one, and never decides whether to: `lib/x-read-budget.ts` does, before it is
 * constructed. X's Enterprise analytics endpoints are never called: nothing
 * here asks for watch time, shares or follows.
 */

/** Our token lacks `tweet.read` or `users.read`, or X no longer honours it. */
export class XAnalyticsScopeError extends Error {
  constructor() {
    super(
      'X refused the analytics read. Reconnect the X account from Settings → Platforms.',
    );
    this.name = 'XAnalyticsScopeError';
  }
}

export class XRateLimitError extends Error {
  constructor() {
    super('X rate limit reached. The post is read again on a later day.');
    this.name = 'XRateLimitError';
  }
}

export class XPostNotFoundError extends Error {
  constructor(postId: string) {
    super(`X has no post ${postId}; it may have been deleted.`);
    this.name = 'XPostNotFoundError';
  }
}

const POST_PUBLIC_METRICS: ReadonlyArray<keyof XPostPublicMetrics> = [
  'retweet_count',
  'reply_count',
  'like_count',
  'quote_count',
  'bookmark_count',
  'impression_count',
];

/** A required member X left out is a malformed response, never a zero. */
function requiredPublicMetrics(
  postId: string,
  metrics: Partial<XPostPublicMetrics> | undefined,
): XPostPublicMetrics {
  const missing = POST_PUBLIC_METRICS.filter(
    (name) => typeof metrics?.[name] !== 'number',
  );

  if (missing.length > 0) {
    throw new Error(
      `X returned post ${postId} without public_metrics ${missing.join(', ')}`,
    );
  }

  return metrics as XPostPublicMetrics;
}

/** The five quartile counts, or null unless X returned every one. */
function quartilesOf(
  media: XMediaObject | undefined,
): XPlaybackQuartiles | null {
  const counts = media?.non_public_metrics;

  if (
    !counts ||
    typeof counts.playback_0_count !== 'number' ||
    typeof counts.playback_25_count !== 'number' ||
    typeof counts.playback_50_count !== 'number' ||
    typeof counts.playback_75_count !== 'number' ||
    typeof counts.playback_100_count !== 'number'
  ) {
    return null;
  }

  return {
    started: counts.playback_0_count,
    quarter: counts.playback_25_count,
    half: counts.playback_50_count,
    threeQuarters: counts.playback_75_count,
    complete: counts.playback_100_count,
  };
}

export class XAnalyticsProvider {
  constructor(private accessToken: string) {}

  /**
   * @throws {XAnalyticsScopeError} on 401 or 403
   * @throws {XRateLimitError} on 429
   * @throws {XPostNotFoundError} when X answers with the post as an error
   */
  async getPostAnalytics(postId: string): Promise<XAnalyticsResult> {
    const response = await fetch(
      `${X_API_BASE}/tweets?ids=${encodeURIComponent(postId)}&tweet.fields=public_metrics&expansions=attachments.media_keys&media.fields=public_metrics,non_public_metrics`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (response.status === 401 || response.status === 403) {
      throw new XAnalyticsScopeError();
    }

    if (response.status === 429) {
      throw new XRateLimitError();
    }

    if (!response.ok) {
      throw new Error(
        `X posts lookup failed (${response.status}): ${await response.text()}`,
      );
    }

    const body = (await response.json()) as XPostLookupResponse;
    const post = body.data?.find((candidate) => candidate.id === postId);

    if (!post) {
      throw new XPostNotFoundError(postId);
    }

    const metrics = requiredPublicMetrics(postId, post.public_metrics);
    const mediaKeys = new Set(post.attachments?.media_keys ?? []);
    const video = body.includes?.media?.find(
      (media) => mediaKeys.has(media.media_key) && media.type === 'video',
    );
    const viewCount = video?.public_metrics?.view_count;

    return {
      postId,
      totals: {
        views: typeof viewCount === 'number' ? viewCount : null,
        likes: metrics.like_count,
        replies: metrics.reply_count,
        reposts: metrics.retweet_count,
        bookmarks: metrics.bookmark_count,
      },
      quartiles: quartilesOf(video),
    };
  }
}

export function createXAnalyticsProvider(accessToken: string) {
  return new XAnalyticsProvider(accessToken);
}
