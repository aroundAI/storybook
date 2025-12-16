import 'server-only';

import type {
  TikTokAccountAnalytics,
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokAudienceData,
  TikTokTrafficSource,
  TikTokTrafficSourceType,
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

      // Fetch creator insights (for audience data)
      let audience: TikTokAudienceData | undefined;
      try {
        const insightsResponse = await fetch(
          `${TIKTOK_API_BASE}/research/creator/insights/?fields=audience_countries,audience_genders,audience_ages`,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
            },
          },
        );

        if (insightsResponse.ok) {
          const insightsData =
            (await insightsResponse.json()) as TikTokApiResponse<{
              audience_countries?: Array<{
                country: string;
                percentage: number;
              }>;
              audience_genders?: {
                male: number;
                female: number;
                other: number;
              };
              audience_ages?: Array<{ age_range: string; percentage: number }>;
            }>;
          audience = this.parseAudienceData(insightsData.data);
        }
      } catch {
        // Audience data is optional - may not be available for all accounts
      }

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
          saves: video.save_count ?? 0,
          profileViews: 0, // Not available per-video
          followersGained: 0, // Not available per-video
          averageWatchTime: video.average_watch_time ?? 0,
          totalPlayTime: video.total_play_time ?? 0,
          fullVideoWatchedRate: video.full_video_watched_rate ?? 0,
        },
        dailyData: [], // TikTok doesn't provide per-video daily breakdown
        audience,
        trafficSources: this.parseTrafficSources(video.traffic_source_types),
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
        followers: data.data?.user?.follower_count ?? 0,
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

  /**
   * Parses traffic source data from TikTok API response
   */
  private parseTrafficSources(
    sources: Record<string, number> | undefined,
  ): TikTokTrafficSource[] {
    if (!sources) return [];

    const sourceMap: Record<string, TikTokTrafficSourceType> = {
      for_you: 'For You',
      following: 'Following',
      sound: 'Sound',
      hashtag: 'Hashtag',
      profile: 'Profile',
      search: 'Search',
    };

    return Object.entries(sources).map(([key, value]) => ({
      source: sourceMap[key] ?? 'Other',
      percentage: value,
    }));
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
