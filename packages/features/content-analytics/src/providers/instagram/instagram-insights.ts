import 'server-only';

import type {
  InstagramAccountInsights,
  InstagramAudienceData,
  InstagramInsightsInput,
  InstagramInsightsPeriod,
  InstagramInsightsResult,
  InstagramMediaType,
  InstagramReachBreakdown,
} from './types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

/**
 * Error thrown when the Instagram connection is missing the insights scope.
 * This occurs when users connected their Instagram account before analytics
 * features were added or without the required permissions.
 */
export class InstagramInsightsScopeError extends Error {
  constructor() {
    super(
      'Instagram Insights access denied. Your Instagram connection may be missing the required insights permissions. ' +
        'Please disconnect and reconnect your Instagram account to grant the required analytics permissions.',
    );
    this.name = 'InstagramInsightsScopeError';
  }
}

/**
 * Checks if an error indicates missing insights scope or OAuth issues
 */
function isPermissionError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('oauthexception') ||
      message.includes('permission') ||
      message.includes('access denied') ||
      message.includes('invalid_token') ||
      message.includes('token has expired')
    );
  }
  return false;
}

interface GraphAPIError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

/**
 * Instagram Insights Provider
 *
 * Fetches engagement and reach metrics for Reels and videos
 * on Professional Instagram accounts using Meta Graph API v18.0.
 */
export class InstagramInsightsProvider {
  constructor(
    private accessToken: string,
    private instagramAccountId: string,
  ) {}

  /**
   * Fetches insights for a media item (Reel or Video)
   *
   * @throws {InstagramInsightsScopeError} If the connection is missing insights scope
   */
  async getMediaInsights(
    input: InstagramInsightsInput,
  ): Promise<InstagramInsightsResult> {
    const { mediaId } = input;

    try {
      // Get media type first
      const mediaInfoResponse = await fetch(
        `${GRAPH_API_BASE}/${mediaId}?fields=media_type&access_token=${this.accessToken}`,
      );

      if (!mediaInfoResponse.ok) {
        throw new Error(
          `Failed to fetch media info: HTTP ${mediaInfoResponse.status}`,
        );
      }

      const mediaInfo = (await mediaInfoResponse.json()) as {
        media_type?: InstagramMediaType;
      } & GraphAPIError;

      if (mediaInfo.error) {
        throw new Error(
          mediaInfo.error.message ?? 'Failed to fetch media info',
        );
      }

      const mediaType = mediaInfo.media_type ?? 'VIDEO';

      // Meta deprecated `plays` and `impressions` (2025-04-21, Graph v22)
      // in favor of the universal `views` metric across all media types.
      const metricsForType =
        mediaType === 'REELS'
          ? [
              'views',
              'reach',
              'total_interactions',
              'likes',
              'comments',
              'saved',
              'shares',
            ]
          : [
              'views',
              'reach',
              'total_interactions',
              'likes',
              'comments',
              'saved',
            ];

      // Fetch insights, reach breakdown, and audience in parallel
      const [insightsData, reachBreakdown, audience] = await Promise.all([
        this.fetchMediaInsights(mediaId, metricsForType),
        mediaType === 'REELS' ? this.fetchReachBreakdown(mediaId) : undefined,
        this.fetchAccountAudience(),
      ]);

      const metrics = this.parseMetrics(insightsData);

      return {
        mediaId,
        mediaType,
        totals: {
          plays: metrics.views ?? 0,
          reach: metrics.reach ?? 0,
          impressions: metrics.views ?? metrics.reach ?? 0,
          totalInteractions: metrics.total_interactions ?? 0,
          likes: metrics.likes ?? 0,
          comments: metrics.comments ?? 0,
          saved: metrics.saved ?? 0,
          shares: metrics.shares ?? 0,
          profileVisits: metrics.profile_visits ?? 0,
          follows: metrics.follows ?? 0,
        },
        reachBreakdown,
        audience,
      };
    } catch (error) {
      if (isPermissionError(error)) {
        throw new InstagramInsightsScopeError();
      }
      throw error;
    }
  }

  /**
   * Fetches media insights from the Graph API
   */
  private async fetchMediaInsights(
    mediaId: string,
    metrics: string[],
  ): Promise<InsightsDataItem[]> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${mediaId}/insights?` +
        new URLSearchParams({
          metric: metrics.join(','),
          access_token: this.accessToken,
        }),
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch media insights: HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      data?: InsightsDataItem[];
    } & GraphAPIError;

    if (data.error) {
      throw new Error(data.error.message ?? 'Failed to fetch media insights');
    }

    return data.data ?? [];
  }

  /**
   * Fetches reach breakdown for Reels (follower vs non-follower)
   */
  private async fetchReachBreakdown(
    mediaId: string,
  ): Promise<InstagramReachBreakdown | undefined> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${mediaId}/insights?` +
          new URLSearchParams({
            metric: 'reach',
            breakdown: 'follow_type',
            access_token: this.accessToken,
          }),
      );

      if (!response.ok) {
        return undefined;
      }

      const data = (await response.json()) as {
        data?: Array<{
          total_value?: {
            breakdowns?: Array<{
              results?: Array<{
                dimension_values: string[];
                value: number;
              }>;
            }>;
          };
        }>;
      } & GraphAPIError;

      if (data.error) {
        return undefined;
      }

      const reachData =
        data.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];

      const followerReach =
        reachData.find((r) => r.dimension_values[0] === 'FOLLOWER')?.value ?? 0;
      const nonFollowerReach =
        reachData.find((r) => r.dimension_values[0] === 'NON_FOLLOWER')
          ?.value ?? 0;
      const totalReach = followerReach + nonFollowerReach;

      return {
        followerReach,
        nonFollowerReach,
        followersPercentage:
          totalReach > 0 ? (followerReach / totalReach) * 100 : 0,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Fetches account-level audience demographics
   */
  private async fetchAccountAudience(): Promise<
    InstagramAudienceData | undefined
  > {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
          new URLSearchParams({
            metric: 'follower_demographics',
            period: 'lifetime',
            metric_type: 'total_value',
            breakdown: 'country,city,age,gender',
            access_token: this.accessToken,
          }),
      );

      if (!response.ok) {
        return undefined;
      }

      const data = (await response.json()) as {
        data?: DemographicDataItem[];
      } & GraphAPIError;

      if (data.error) {
        return undefined;
      }

      const demographics = data.data ?? [];

      return {
        countries: this.parseCountryBreakdown(demographics),
        cities: this.parseCityBreakdown(demographics),
        genderAge: this.parseGenderAgeBreakdown(demographics),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Gets account overview metrics for a time period
   */
  async getAccountInsights(
    period: InstagramInsightsPeriod = 'week',
  ): Promise<InstagramAccountInsights> {
    const periodDays = { day: 1, week: 7, month: 28 }[period];
    const now = Math.floor(Date.now() / 1000);
    const since = now - periodDays * 86400;

    try {
      const [metricsResponse, accountResponse] = await Promise.all([
        fetch(
          `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
            new URLSearchParams({
              metric: 'impressions,reach,profile_views,website_clicks',
              period: 'day',
              since: since.toString(),
              until: now.toString(),
              access_token: this.accessToken,
            }),
        ),
        fetch(
          `${GRAPH_API_BASE}/${this.instagramAccountId}?fields=followers_count&access_token=${this.accessToken}`,
        ),
      ]);

      if (!metricsResponse.ok) {
        throw new Error(
          `Failed to fetch account insights: HTTP ${metricsResponse.status}`,
        );
      }

      if (!accountResponse.ok) {
        throw new Error(
          `Failed to fetch follower count: HTTP ${accountResponse.status}`,
        );
      }

      const metricsData = (await metricsResponse.json()) as {
        data?: Array<{
          name: string;
          values: Array<{ value: number }>;
        }>;
      } & GraphAPIError;

      const accountData = (await accountResponse.json()) as {
        followers_count?: number;
      } & GraphAPIError;

      if (metricsData.error) {
        throw new Error(
          metricsData.error.message ?? 'Failed to fetch account insights',
        );
      }

      if (accountData.error) {
        throw new Error(
          accountData.error.message ?? 'Failed to fetch follower count',
        );
      }

      const metrics = this.aggregateMetrics(metricsData.data ?? []);

      return {
        impressions: metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        profileViews: metrics.profile_views ?? 0,
        websiteClicks: metrics.website_clicks ?? 0,
        followerCount: accountData.followers_count ?? 0,
      };
    } catch (error) {
      if (isPermissionError(error)) {
        throw new InstagramInsightsScopeError();
      }
      throw error;
    }
  }

  /**
   * Parses metric values from insights response
   */
  private parseMetrics(data: InsightsDataItem[]): Record<string, number> {
    return data.reduce(
      (acc, item) => {
        acc[item.name] =
          item.values?.[0]?.value ?? item.total_value?.value ?? 0;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  /**
   * Parses country breakdown data
   */
  private parseCountryBreakdown(
    data: DemographicDataItem[],
  ): Array<{ country: string; count: number }> {
    const metric = data.find((d) => d.name === 'country');
    if (!metric?.total_value?.breakdowns?.[0]?.results) {
      return [];
    }

    return metric.total_value.breakdowns[0].results
      .map((result) => ({
        country: result.dimension_values?.[0] ?? '',
        count: result.value ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Parses city breakdown data
   */
  private parseCityBreakdown(
    data: DemographicDataItem[],
  ): Array<{ city: string; count: number }> {
    const metric = data.find((d) => d.name === 'city');
    if (!metric?.total_value?.breakdowns?.[0]?.results) {
      return [];
    }

    return metric.total_value.breakdowns[0].results
      .map((result) => ({
        city: result.dimension_values?.[0] ?? '',
        count: result.value ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Parses gender/age breakdown data
   */
  private parseGenderAgeBreakdown(
    data: DemographicDataItem[],
  ): Array<{ dimension: string; count: number }> {
    // Gender/age comes as combined breakdown
    const metric = data.find(
      (d) => d.name === 'age' || d.name === 'gender' || d.name === 'age,gender',
    );
    if (!metric?.total_value?.breakdowns?.[0]?.results) {
      return [];
    }

    return metric.total_value.breakdowns[0].results
      .map((result) => ({
        dimension: result.dimension_values?.join('.') ?? '',
        count: result.value ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aggregates daily metrics into totals
   */
  private aggregateMetrics(
    data: Array<{ name: string; values: Array<{ value: number }> }>,
  ): Record<string, number> {
    return data.reduce(
      (acc, metric) => {
        const values = metric.values ?? [];
        acc[metric.name] = values.reduce((sum, v) => sum + (v.value ?? 0), 0);
        return acc;
      },
      {} as Record<string, number>,
    );
  }
}

/**
 * Internal type for insights data items
 */
interface InsightsDataItem {
  name: string;
  values?: Array<{ value: number }>;
  total_value?: { value: number };
}

/**
 * Internal type for demographic data items
 */
interface DemographicDataItem {
  name: string;
  total_value?: {
    breakdowns?: Array<{
      results?: Array<{
        dimension_values?: string[];
        value?: number;
      }>;
    }>;
  };
}

/**
 * Creates an InstagramInsightsProvider with the given credentials
 */
export function createInstagramInsightsProvider(
  accessToken: string,
  instagramAccountId: string,
): InstagramInsightsProvider {
  return new InstagramInsightsProvider(accessToken, instagramAccountId);
}
