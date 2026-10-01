import 'server-only';

import type { SubscriberCountResult } from '@kit/shared/subscribers';
import { vendorUrl } from '@kit/shared/vendors';

import { normalizeAssetDurationSeconds } from '../../lib/asset-duration';
import type {
  TikTokAccountAnalytics,
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokVideoData,
} from './types';

const TIKTOK_API_BASE = `${vendorUrl('tiktok')}/v2`;

/** `/v2/video/query/` accepts at most 20 video ids a request. */
const TIKTOK_VIDEO_QUERY_MAX_IDS = 20;

/**
 * Error thrown when the TikTok connection is missing required scopes
 * or the access token is invalid.
 */
export class TikTokAnalyticsScopeError extends Error {
  /** What TikTok said, when it said anything (KB-150). */
  readonly platformReason: string | null;

  constructor(message?: string, platformReason?: string) {
    super(
      message ??
        'TikTok Analytics access denied. Your TikTok connection may be missing required permissions. ' +
          'Please disconnect and reconnect your TikTok account to grant the required analytics permissions.',
    );
    this.name = 'TikTokAnalyticsScopeError';
    this.platformReason = platformReason ?? null;
  }
}

/**
 * Error thrown when a video is not found
 */
export class TikTokVideoNotFoundError extends Error {
  constructor(videoId: string) {
    super(`Video not found: ${videoId}`);
    this.name = 'TikTokVideoNotFoundError';
  }
}

/**
 * Error thrown when rate limited by TikTok API
 */
export class TikTokRateLimitError extends Error {
  /** What TikTok said, when it said anything (KB-150). */
  readonly platformReason: string | null;

  constructor(platformReason?: string) {
    super(
      'TikTok API rate limit exceeded. Please try again later. (1000 requests/day limit)',
    );
    this.name = 'TikTokRateLimitError';
    this.platformReason = platformReason ?? null;
  }
}

/**
 * TikTok v2 returns an `error` object on every response, success included:
 * `{ code: 'ok', message: '', log_id }`. Only a code other than 'ok' is a
 * failure. The code leads the message because the classifiers below match on
 * codes (`access_token_invalid`, `spam_risk_too_many_pending`), and TikTok's
 * human message does not contain them.
 */
function tiktokFailure(error: { code: string; message: string } | undefined) {
  if (!error || error.code === 'ok') return null;

  return error.message ? `${error.code}: ${error.message}` : error.code;
}

/**
 * A non-2xx answer's reason. TikTok sends its envelope on errors too, so its
 * own `code: message` is kept (KB-150: the creator is shown it) rather than
 * the raw JSON body; a body that is not the envelope is passed on as it came.
 */
async function httpFailure(response: Response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as TikTokApiResponse<unknown>;
    return tiktokFailure(body.error) ?? text;
  } catch {
    return text;
  }
}

function reasonOf(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

/**
 * Checks if an error indicates an invalid token or missing scope
 */
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('access_token_invalid') ||
      message.includes('invalid_token') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('scope_not_authorized') ||
      message.includes('access denied')
    );
  }
  return false;
}

/**
 * Checks if an error indicates rate limiting
 */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('spam_risk_too_many_pending') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    );
  }
  return false;
}

interface TikTokApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * TikTok Analytics Provider
 *
 * Fetches analytics data from TikTok Creator Tools API.
 */
export class TikTokAnalyticsProvider {
  constructor(private accessToken: string) {}

  /**
   * Fetches video analytics
   *
   * @throws {TikTokAnalyticsScopeError} If the connection is missing required scopes
   * @throws {TikTokVideoNotFoundError} If the video is not found
   * @throws {TikTokRateLimitError} If rate limited
   */
  async getVideoAnalytics(
    input: TikTokAnalyticsInput,
  ): Promise<TikTokAnalyticsResult> {
    const { videoId, dateRange = 7 } = input;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dateRange);

    try {
      // Fetch video metrics
      const metricsResponse = await fetch(
        `${TIKTOK_API_BASE}/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filters: {
              video_ids: [videoId],
            },
          }),
        },
      );

      if (!metricsResponse.ok) {
        throw new Error(await httpFailure(metricsResponse));
      }

      const metricsData = (await metricsResponse.json()) as TikTokApiResponse<{
        videos: TikTokVideoData[];
      }>;

      const videoFailure = tiktokFailure(metricsData.error);

      if (videoFailure) {
        throw new Error(videoFailure);
      }

      const video = metricsData.data?.videos?.[0];

      if (!video) {
        throw new TikTokVideoNotFoundError(videoId);
      }

      // Audience demographics are not reachable. The Display API has no
      // demographics fields, and TikTok's research scopes
      // (research.adlib.basic, research.data.basic, research.data.u18eu,
      // research.data.vra) are restricted to non-profit academic researchers.
      // `research.creator_insights` was never a real scope. FILM-1711 owns
      // finding a source. See docs/platform-capability-reference.md.

      return {
        videoId,
        period: {
          startDate: startDate.toISOString().split('T')[0]!,
          endDate: endDate.toISOString().split('T')[0]!,
        },
        totals: {
          views: video.view_count ?? 0,
          likes: video.like_count ?? 0,
          comments: video.comment_count ?? 0,
          shares: video.share_count ?? 0,
          // Nothing else is returned by this endpoint: saves have no
          // creator-auth surface, and watch time, completion and profile
          // views live on the Business API (FILM-1730).
          // docs/platform-capability-reference.md
        },
        dailyData: [], // TikTok doesn't provide per-video daily breakdown
        audience: undefined,
        // The Display API has no traffic-source field. TikTok's is
        // `impression_sources` on the Business API, which needs a separate
        // app and a TikTok Business account. The `TikTokTrafficSource` shape
        // is kept for that integration - see FILM-1703 and
        // docs/platform-capability-reference.md.
        trafficSources: [],
      };
    } catch (error) {
      if (error instanceof TikTokVideoNotFoundError) {
        throw error;
      }
      if (isAuthError(error)) {
        throw new TikTokAnalyticsScopeError(undefined, reasonOf(error));
      }
      if (isRateLimitError(error)) {
        throw new TikTokRateLimitError(reasonOf(error));
      }
      throw error;
    }
  }

  /**
   * The published assets' durations in whole seconds, keyed by video id
   * (FILM-1710).
   *
   * `duration` is on the documented field list for `/v2/video/query/`
   * (docs/platform-capability-reference.md), the endpoint already used
   * above, at 20 ids a request. It needs the `video.list` scope, which no
   * connection holds until FILM-1711 — until then this throws
   * `TikTokAnalyticsScopeError` and the publish stays `duration_unknown`.
   *
   * A video absent from the response, or one with no positive duration, is
   * left out of the map. Absent is not zero.
   *
   * @throws {TikTokAnalyticsScopeError} If the connection lacks `video.list`
   * @throws {TikTokRateLimitError} If rate limited
   */
  async getVideoDurations(videoIds: string[]): Promise<Map<string, number>> {
    const durations = new Map<string, number>();

    try {
      for (let i = 0; i < videoIds.length; i += TIKTOK_VIDEO_QUERY_MAX_IDS) {
        const response = await fetch(
          `${TIKTOK_API_BASE}/video/query/?fields=id,duration`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filters: {
                video_ids: videoIds.slice(i, i + TIKTOK_VIDEO_QUERY_MAX_IDS),
              },
            }),
          },
        );

        if (!response.ok) {
          throw new Error(await httpFailure(response));
        }

        const body = (await response.json()) as TikTokApiResponse<{
          videos: TikTokVideoData[];
        }>;

        const failure = tiktokFailure(body.error);

        if (failure) {
          throw new Error(failure);
        }

        for (const video of body.data?.videos ?? []) {
          const seconds = normalizeAssetDurationSeconds(video.duration);

          if (seconds !== null) durations.set(video.id, seconds);
        }
      }
    } catch (error) {
      if (isAuthError(error)) {
        throw new TikTokAnalyticsScopeError(undefined, reasonOf(error));
      }
      if (isRateLimitError(error)) {
        throw new TikTokRateLimitError(reasonOf(error));
      }
      throw error;
    }

    return durations;
  }

  /**
   * Fetches account-level analytics
   *
   * Note: dateRange is included for API compatibility but not currently
   * used as TikTok's basic API doesn't support historical account data.
   */
  /**
   * Current follower count on its own (FILM-1607).
   *
   * Absent is not zero. `?? 0` would write an *exact* zero anchor — TikTok
   * reports precisely, so `rounding_step` is 0 — and an exact anchor is
   * authoritative, so one malformed 200 would re-level the whole
   * reconstructed curve to zero from that day on.
   *
   * TikTok has no documented "hidden" state, so an absent field is
   * `unavailable` and does count toward the capture's shortfall alert.
   */
  async getFollowerCount(): Promise<SubscriberCountResult> {
    try {
      const response = await fetch(
        `${TIKTOK_API_BASE}/user/info/?fields=follower_count`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );

      if (!response.ok) {
        return { ok: false, reason: 'unavailable' };
      }

      const data = (await response.json()) as TikTokApiResponse<{
        user: { follower_count?: number };
      }>;

      const count = data.data?.user?.follower_count;

      return typeof count === 'number'
        ? { ok: true, count }
        : { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  async getAccountAnalytics(
    _dateRange: 7 | 28 = 7,
  ): Promise<TikTokAccountAnalytics> {
    try {
      const response = await fetch(
        `${TIKTOK_API_BASE}/user/info/?fields=follower_count`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(await httpFailure(response));
      }

      const data = (await response.json()) as TikTokApiResponse<{
        user: { follower_count?: number };
      }>;

      const accountFailure = tiktokFailure(data.error);

      if (accountFailure) {
        throw new Error(accountFailure);
      }

      return {
        followers: data.data?.user?.follower_count ?? null,
        followersGained: 0, // Would need historical data
        profileViews: 0, // Not available in basic API
        videoViews: 0, // Would sum all videos
      };
    } catch (error) {
      if (isAuthError(error)) {
        throw new TikTokAnalyticsScopeError(undefined, reasonOf(error));
      }
      if (isRateLimitError(error)) {
        throw new TikTokRateLimitError(reasonOf(error));
      }
      throw error;
    }
  }
}

/**
 * Creates a TikTokAnalyticsProvider with the given access token
 */
export function createTikTokAnalyticsProvider(
  accessToken: string,
): TikTokAnalyticsProvider {
  return new TikTokAnalyticsProvider(accessToken);
}
