import 'server-only';

import type { SubscriberCountResult } from '@kit/shared/subscribers';
import { META_GRAPH_BASE } from '@kit/shared/vendors';

import {
  MetaRateLimitError,
  isMetaThrottle,
  metaUsagePercent,
} from '../../lib/meta-usage';
import type {
  InstagramAccountInsights,
  InstagramAccountReach,
  InstagramAudienceData,
  InstagramInsightsInput,
  InstagramInsightsPeriod,
  InstagramInsightsResult,
  InstagramMediaProductType,
  InstagramMediaType,
} from './types';

const GRAPH_API_BASE = META_GRAPH_BASE;

/** Meta's `follower_demographics` breakdowns, one per request (FILM-1712) */
const AUDIENCE_BREAKDOWNS = ['country', 'city', 'age', 'gender'] as const;

/** Required; `this_month` and `this_week` are all v20.0+ accepts */
const AUDIENCE_TIMEFRAME = 'this_month';

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
 * on Professional Instagram accounts using Meta Graph API v23.0.
 */
export class InstagramInsightsProvider {
  /**
   * The highest share of Meta's hourly allowance any response so far has
   * reported (`X-Business-Use-Case-Usage` / `X-App-Usage`), or null before
   * one did. Read by callers that pace many calls (the nightly reach sync).
   */
  usagePercent: number | null = null;

  constructor(
    private accessToken: string,
    private instagramAccountId: string,
  ) {}

  private noteUsage(response: Response) {
    const usage = metaUsagePercent(response.headers);
    if (usage !== null) {
      this.usagePercent = Math.max(this.usagePercent ?? 0, usage);
    }
  }

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
      // `media_type` is only ever CAROUSEL_ALBUM / IMAGE / VIDEO — a Reel is
      // VIDEO. The surface (FEED / REELS / STORY / AD) is `media_product_type`,
      // and it is what decides which metrics exist.
      const mediaInfoResponse = await fetch(
        `${GRAPH_API_BASE}/${mediaId}?fields=media_type,media_product_type&access_token=${this.accessToken}`,
      );

      if (!mediaInfoResponse.ok) {
        throw new Error(
          `Failed to fetch media info: HTTP ${mediaInfoResponse.status}`,
        );
      }

      const mediaInfo = (await mediaInfoResponse.json()) as {
        media_type?: InstagramMediaType;
        media_product_type?: InstagramMediaProductType;
      } & GraphAPIError;

      if (mediaInfo.error) {
        throw new Error(
          mediaInfo.error.message ?? 'Failed to fetch media info',
        );
      }

      const mediaType = mediaInfo.media_type ?? 'VIDEO';
      const mediaProductType = mediaInfo.media_product_type ?? 'FEED';

      // Meta deprecated `plays` and `impressions` (2025-04-21, Graph v22)
      // in favor of the universal `views` metric across all media types.
      // `shares` is documented for FEED, REELS and STORY alike; `likes`,
      // `comments` and `saved` are not documented for STORY.
      const isReels = mediaProductType === 'REELS';
      const metricsForType =
        mediaProductType === 'STORY'
          ? ['views', 'reach', 'total_interactions', 'shares']
          : [
              'views',
              'reach',
              'total_interactions',
              'likes',
              'comments',
              'saved',
              'shares',
              // Reels only, in milliseconds (confirmed on a live account
              // by the owner, 2026-09-29). The average is not total ÷ views.
              ...(isReels
                ? ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time']
                : []),
            ];

      // No follower / non-follower split here: Meta documents `follow_type`
      // for account-level reach only. The media insights reference lists two
      // breakdowns, neither of them for `reach`.
      const [insightsData, audience] = await Promise.all([
        this.fetchMediaInsights(mediaId, metricsForType),
        this.fetchAccountAudience(),
      ]);

      const metrics = this.parseMetrics(insightsData);

      return {
        mediaId,
        mediaType,
        mediaProductType,
        totals: {
          views: metrics.views ?? 0,
          // Not measured is null, never 0 (FILM-1712): a 0 reads as nobody.
          reach: metrics.reach ?? null,
          totalInteractions: metrics.total_interactions ?? 0,
          likes: metrics.likes ?? 0,
          comments: metrics.comments ?? 0,
          saved: metrics.saved ?? 0,
          shares: metrics.shares ?? 0,
          watchTimeMs: metrics.ig_reels_video_view_total_time ?? null,
          avgWatchTimeMs: metrics.ig_reels_avg_watch_time ?? null,
        },
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
   * Account-level audience demographics (FILM-1712).
   *
   * Meta documents `follower_demographics` as one breakdown per request, with
   * a required `timeframe`; from v20.0 only `this_month` and `this_week`
   * remain. Each breakdown is its own call, so one refused call loses only
   * its own list. The result is one `follower_demographics` item whose first
   * breakdown holds the rows.
   */
  private async fetchAccountAudience(): Promise<
    InstagramAudienceData | undefined
  > {
    const [countries, cities, ages, genders] = await Promise.all(
      AUDIENCE_BREAKDOWNS.map((breakdown) => this.fetchDemographic(breakdown)),
    );

    if (!countries && !cities && !ages && !genders) {
      return undefined;
    }

    const rows = (results: DemographicResult[] | undefined) =>
      (results ?? [])
        .map((result) => ({
          value: result.dimension_values?.[0] ?? '',
          count: result.value ?? 0,
        }))
        .filter((row) => row.value !== '')
        .sort((a, b) => b.count - a.count);

    return {
      countries: rows(countries).map(({ value, count }) => ({
        country: value,
        count,
      })),
      cities: rows(cities).map(({ value, count }) => ({ city: value, count })),
      ages: rows(ages).map(({ value, count }) => ({ ageGroup: value, count })),
      genders: rows(genders).map(({ value, count }) => ({
        gender: value,
        count,
      })),
    };
  }

  /** One breakdown of `follower_demographics`, or undefined when refused */
  private async fetchDemographic(
    breakdown: (typeof AUDIENCE_BREAKDOWNS)[number],
  ): Promise<DemographicResult[] | undefined> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
          new URLSearchParams({
            metric: 'follower_demographics',
            period: 'lifetime',
            metric_type: 'total_value',
            timeframe: AUDIENCE_TIMEFRAME,
            breakdown,
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

      const item = data.data?.find((d) => d.name === 'follower_demographics');

      return item?.total_value?.breakdowns?.[0]?.results ?? [];
    } catch {
      return undefined;
    }
  }

  /**
   * Gets account overview metrics for a time period
   */
  /**
   * Current follower count on its own (FILM-1607).
   *
   * Extracted because the existing request is one leg of a `Promise.all`
   * inside `getAccountInsights`, whose `/insights` call is checked first and
   * throws before the follower count is read — and a non-business account
   * cannot call `/insights` at all. Reading the count therefore failed for
   * reasons that have nothing to do with the count.
   *
   * Instagram has no documented "hidden" state, so an absent field is
   * `unavailable` and does count toward the capture's shortfall alert.
   */
  async getFollowerCount(): Promise<SubscriberCountResult> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${this.instagramAccountId}?fields=followers_count&access_token=${this.accessToken}`,
      );

      if (!response.ok) {
        return { ok: false, reason: 'unavailable' };
      }

      const data = (await response.json()) as { followers_count?: number };

      return typeof data.followers_count === 'number'
        ? { ok: true, count: data.followers_count }
        : { ok: false, reason: 'unavailable' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  /**
   * The account's unique reach over one window (cross-platform reach design,
   * 2026-09-28): one number from Meta, counted once per person across the
   * window — checked on a real account, 170 for a 30-day window against 176
   * summed daily. Meta caps a window at 30 days.
   *
   * `since`/`until` are the window's first day and the day after its last,
   * as UTC midnights. Two calls: the total, and the same reach split by
   * `follow_type`. A figure Meta leaves out is null, never 0.
   */
  async getAccountReach(window: {
    since: Date;
    until: Date;
  }): Promise<InstagramAccountReach> {
    const request = (extra: Record<string, string>) =>
      fetch(
        `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
          new URLSearchParams({
            metric: 'reach',
            metric_type: 'total_value',
            period: 'day',
            since: Math.floor(window.since.getTime() / 1000).toString(),
            until: Math.floor(window.until.getTime() / 1000).toString(),
            access_token: this.accessToken,
            ...extra,
          }),
      );

    try {
      const [totalResponse, splitResponse] = await Promise.all([
        request({}),
        request({ breakdown: 'follow_type' }),
      ]);

      for (const response of [totalResponse, splitResponse]) {
        this.noteUsage(response);
      }

      type ReachItem = {
        name: string;
        total_value?: {
          value?: number;
          breakdowns?: Array<{
            results?: Array<{ dimension_values?: string[]; value?: number }>;
          }>;
        };
      };
      const total = (await totalResponse.json()) as {
        data?: ReachItem[];
      } & GraphAPIError;
      const split = (await splitResponse.json()) as {
        data?: ReachItem[];
      } & GraphAPIError;

      for (const [body, response] of [
        [total, totalResponse],
        [split, splitResponse],
      ] as const) {
        // A throttle is not a failure: the caller stops for the night and
        // resumes, rather than counting the channel as broken.
        if (isMetaThrottle(body.error?.code)) {
          throw new MetaRateLimitError(
            body.error.code,
            body.error.message ?? 'Meta rate limit reached',
          );
        }
        if (body.error) {
          throw new Error(
            body.error.message ?? 'Failed to fetch account reach',
          );
        }
        if (!response.ok) {
          throw new Error(
            `Failed to fetch account reach: HTTP ${response.status}`,
          );
        }
      }

      const reach = total.data?.find((item) => item.name === 'reach');
      const results =
        split.data?.find((item) => item.name === 'reach')?.total_value
          ?.breakdowns?.[0]?.results ?? [];
      const byType = (type: string) =>
        results.find((r) => r.dimension_values?.[0] === type)?.value ?? null;

      return {
        accountsReached: reach?.total_value?.value ?? null,
        followers: byType('FOLLOWER'),
        nonFollowers: byType('NON_FOLLOWER'),
      };
    } catch (error) {
      if (isPermissionError(error)) {
        throw new InstagramInsightsScopeError();
      }
      throw error;
    }
  }

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
              // Account-level `views` is `total_value` only, and
              // `profile_views` / `website_clicks` left the metrics table
              // when their time series ended (January 2025).
              metric: 'views,reach',
              metric_type: 'total_value',
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
        data?: Array<{ name: string; total_value?: { value: number } }>;
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

      const totals = Object.fromEntries(
        (metricsData.data ?? []).map((item) => [
          item.name,
          item.total_value?.value ?? 0,
        ]),
      );

      return {
        views: totals.views ?? 0,
        reach: totals.reach ?? 0,
        followerCount: accountData.followers_count ?? null,
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
interface DemographicResult {
  dimension_values?: string[];
  value?: number;
}

interface DemographicDataItem {
  name: string;
  total_value?: {
    breakdowns?: Array<{ results?: DemographicResult[] }>;
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
