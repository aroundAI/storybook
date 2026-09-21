import 'server-only';

import type { SubscriberCountResult } from '@kit/shared/subscribers';

import type {
  TikTokAccountAnalytics,
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokAudienceData,
  TikTokVideoData,
} from './types';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * Error thrown when the TikTok connection is missing required scopes
 * or the access token is invalid.
 */
export class TikTokAnalyticsScopeError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'TikTok Analytics access denied. Your TikTok connection may be missing required permissions. ' +
          'Please disconnect and reconnect your TikTok account to grant the required analytics permissions.',
    );
    this.name = 'TikTokAnalyticsScopeError';
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
  constructor() {
    super(
      'TikTok API rate limit exceeded. Please try again later. (1000 requests/day limit)',
    );
    this.name = 'TikTokRateLimitError';
  }
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
        const errorText = await metricsResponse.text();
        throw new Error(errorText);
      }

      const metricsData = (await metricsResponse.json()) as TikTokApiResponse<{
        videos: TikTokVideoData[];
      }>;

      if (metricsData.error) {
        throw new Error(metricsData.error.message);
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
      const audience: TikTokAudienceData | undefined = undefined;

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
          // Everything below is structurally zero on this endpoint, not
          // measured as zero. The Display API returns none of it; saves have no
          // creator-auth surface at all, and the rest live on the Business API,
          // which needs a separate app and a TikTok Business account.
          // docs/platform-capability-reference.md
          saves: 0,
          profileViews: 0,
          followersGained: 0,
          averageWatchTime: 0,
          totalPlayTime: 0,
          fullVideoWatchedRate: 0,
        },
        dailyData: [], // TikTok doesn't provide per-video daily breakdown
        audience,
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
        throw new TikTokAnalyticsScopeError();
      }
      if (isRateLimitError(error)) {
        throw new TikTokRateLimitError();
      }
      throw error;
    }
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
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const data = (await response.json()) as TikTokApiResponse<{
        user: { follower_count?: number };
      }>;

      if (data.error) {
        throw new Error(data.error.message);
      }

      return {
        followers: data.data?.user?.follower_count ?? null,
        followersGained: 0, // Would need historical data
        profileViews: 0, // Not available in basic API
        videoViews: 0, // Would sum all videos
      };
    } catch (error) {
      if (isAuthError(error)) {
        throw new TikTokAnalyticsScopeError();
      }
      if (isRateLimitError(error)) {
        throw new TikTokRateLimitError();
      }
      throw error;
    }
  }

  /**
   * Parses audience data from TikTok API response
   */
  private parseAudienceData(data: unknown): TikTokAudienceData | undefined {
    if (!data || typeof data !== 'object') return undefined;

    const typedData = data as {
      audience_countries?: Array<{ country: string; percentage: number }>;
      audience_genders?: { male?: number; female?: number; other?: number };
      audience_ages?: Array<{ age_range: string; percentage: number }>;
    };

    return {
      countries: (typedData.audience_countries ?? []).map((c) => ({
        country: c.country,
        percentage: c.percentage,
      })),
      genderDistribution: {
        male: typedData.audience_genders?.male ?? 0,
        female: typedData.audience_genders?.female ?? 0,
        other: typedData.audience_genders?.other ?? 0,
      },
      ageGroups: (typedData.audience_ages ?? []).map((a) => ({
        ageGroup:
          a.age_range as TikTokAudienceData['ageGroups'][number]['ageGroup'],
        percentage: a.percentage,
      })),
    };
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
