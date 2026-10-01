import 'server-only';

import { google } from 'googleapis';

import { getLogger } from '@kit/shared/logger';
import { vendorUrl } from '@kit/shared/vendors';

import {
  formatDate,
  parseDuration,
  parseIsoDurationSeconds,
} from '../../lib/utils';
import type {
  CityGeographyData,
  DemographicData,
  DeviceBreakdownData,
  GeographyData,
  OperatingSystemData,
  RetentionData,
  SubscribedStatusData,
  TrafficSourceData,
  YouTubeAnalyticsInput,
  YouTubeAnalyticsResult,
  YouTubeDailyMetrics,
  YouTubeDailyRevenue,
  YouTubeRevenueAccess,
  YouTubeTotals,
  YouTubeVideoInfo,
} from './types';

/**
 * The per-day metrics of the core daily query. All documented as valid on
 * `dimensions=day` + `filters=video==ID` (docs/platform-capability-reference.md).
 */
const DAILY_METRICS = [
  'views',
  'likes',
  'dislikes',
  'comments',
  'shares',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
] as const;

type DailyMetric = (typeof DAILY_METRICS)[number];

/**
 * Error thrown when the YouTube connection is missing the analytics scope.
 * This occurs when users connected their YouTube account before analytics
 * features were added (FILM-801).
 */
export class YouTubeAnalyticsScopeError extends Error {
  constructor() {
    super(
      'YouTube Analytics access denied. Your YouTube connection was created before analytics features were added. ' +
        'Please disconnect and reconnect your YouTube account to grant the required analytics permissions.',
    );
    this.name = 'YouTubeAnalyticsScopeError';
  }
}

/**
 * Checks if an error indicates missing analytics scope
 */
function isScopeMissingError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Google API returns these for missing scopes
    return (
      message.includes('forbidden') ||
      message.includes('insufficientpermissions') ||
      message.includes('access denied') ||
      message.includes('request had insufficient authentication scopes')
    );
  }
  return false;
}

/**
 * Google reports quota exhaustion as a 403 too. It says nothing about access.
 */
function isQuotaError(error: unknown): boolean {
  return error instanceof Error && /quota|rate ?limit/i.test(error.message);
}

type RevenueTotals = Pick<
  YouTubeTotals,
  'estimatedRevenue' | 'estimatedAdRevenue' | 'estimatedRedPartnerRevenue'
>;

interface RevenueRead {
  access: YouTubeRevenueAccess;
  totals: RevenueTotals;
  daily: YouTubeDailyRevenue[];
}

function noRevenue(
  access: Exclude<YouTubeRevenueAccess, 'authorised'>,
): RevenueRead {
  return {
    access,
    totals: {
      estimatedRevenue: 0,
      estimatedAdRevenue: 0,
      estimatedRedPartnerRevenue: 0,
    },
    daily: [],
  };
}

/**
 * YouTube Analytics Provider
 *
 * Fetches comprehensive analytics data from YouTube Analytics API v2
 * and video metadata from YouTube Data API v3.
 */
export class YouTubeAnalyticsProvider {
  private youtubeAnalytics;
  private youtube;

  constructor(private accessToken: string) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.youtubeAnalytics = google.youtubeAnalytics({
      version: 'v2',
      auth: oauth2Client,
      rootUrl: vendorUrl('youtube-analytics'),
    });
    this.youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
      rootUrl: vendorUrl('youtube-data'),
    });
  }

  /**
   * Fetches comprehensive analytics for a video
   *
   * Makes parallel API calls for optimal performance.
   *
   * @throws {YouTubeAnalyticsScopeError} If the connection is missing analytics scope
   */
  async getVideoAnalytics(
    input: YouTubeAnalyticsInput,
  ): Promise<YouTubeAnalyticsResult> {
    const { videoId, startDate, endDate, includeRevenue = false } = input;
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    try {
      // Fetch metrics in parallel for optimal performance
      const [
        revenue,
        dailyData,
        retention,
        demographics,
        trafficSources,
        geography,
        deviceBreakdown,
        operatingSystem,
        cityGeography,
        subscribedStatus,
      ] = await Promise.all([
        includeRevenue
          ? this.fetchRevenue(videoId, startDateStr, endDateStr)
          : Promise.resolve(noRevenue('scope_missing')),
        this.fetchDailyMetrics(videoId, startDateStr, endDateStr),
        this.fetchRetention(videoId),
        this.fetchDemographics(videoId, startDateStr, endDateStr),
        this.fetchTrafficSources(videoId, startDateStr, endDateStr),
        this.fetchGeography(videoId, startDateStr, endDateStr),
        this.fetchDeviceBreakdown(videoId, startDateStr, endDateStr),
        this.fetchOperatingSystemBreakdown(videoId, startDateStr, endDateStr),
        this.fetchCityGeography(videoId, startDateStr, endDateStr),
        this.fetchSubscribedStatus(videoId, startDateStr, endDateStr),
      ]);

      return {
        videoId,
        period: { startDate: startDateStr, endDate: endDateStr },
        totals: { ...totalsFromDays(dailyData), ...revenue.totals },
        revenueAccess: revenue.access,
        dailyRevenue: revenue.daily,
        dailyData,
        retention,
        demographics,
        trafficSources,
        geography,
        deviceBreakdown:
          deviceBreakdown.length > 0 ? deviceBreakdown : undefined,
        operatingSystem:
          operatingSystem.length > 0 ? operatingSystem : undefined,
        cityGeography: cityGeography.length > 0 ? cityGeography : undefined,
        subscribedStatus,
      };
    } catch (error) {
      // Check if this is a scope/permission error from existing connections
      if (isScopeMissingError(error)) {
        throw new YouTubeAnalyticsScopeError();
      }
      throw error;
    }
  }

  /**
   * Fetches the revenue metrics, which need `yt-analytics-monetary.readonly`.
   *
   * Never throws. A refusal here says something about revenue and nothing
   * about views, so it must not take the rest of the sync down with it.
   *
   * A 403 is read as `account_type_gated` because the caller only asks when
   * the scope is held, and the documented reason left is a channel outside
   * the Partner Program. That reading has not been confirmed against a live
   * non-partner channel — FILM-1725 Check G.
   */
  private async fetchRevenue(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<RevenueRead> {
    try {
      // By day, so each day's estimate can be stored (FILM-1726). The
      // totals are those days summed, then rounded to cents once.
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: [
          'estimatedRevenue',
          'estimatedAdRevenue',
          'estimatedRedPartnerRevenue',
        ].join(','),
        dimensions: 'day',
        filters: `video==${videoId}`,
        sort: 'day',
      });

      const rows = (response.data.rows ?? []) as [
        string,
        number,
        number,
        number,
      ][];
      const sum = (column: 1 | 2 | 3) =>
        rows.reduce((total, row) => total + (row[column] ?? 0), 0);

      return {
        access: 'authorised',
        totals: {
          estimatedRevenue: Math.round(sum(1) * 100), // cents
          estimatedAdRevenue: Math.round(sum(2) * 100),
          estimatedRedPartnerRevenue: Math.round(sum(3) * 100),
        },
        daily: rows.map(([date, revenue]) => ({
          date,
          estimatedRevenue: Math.round((revenue ?? 0) * 100),
        })),
      };
    } catch (error) {
      return noRevenue(
        isScopeMissingError(error) && !isQuotaError(error)
          ? 'account_type_gated'
          : 'unavailable',
      );
    }
  }

  /**
   * Fetches only the daily metrics breakdown for a date range.
   * Used by the historical backfill, where the full getVideoAnalytics
   * payload (retention, demographics, …) would waste API quota.
   */
  async getDailyMetrics(
    videoId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<YouTubeDailyMetrics[]> {
    try {
      return await this.fetchDailyMetrics(
        videoId,
        formatDate(startDate),
        formatDate(endDate),
      );
    } catch (error) {
      if (isScopeMissingError(error)) {
        throw new YouTubeAnalyticsScopeError();
      }
      throw error;
    }
  }

  /**
   * Fetches daily metrics breakdown.
   *
   * Every metric the Reporting ingest also writes to `video_metrics` is asked
   * for here, because the row built from this answer replaces the Reporting
   * row whole (KB-94). Read by column name, and refused rather than defaulted
   * when a metric is missing: a 0 written here would land over a figure the
   * Reporting ingest measured. A refusal fails this video's sync, which the
   * next hourly run retries.
   */
  private async fetchDailyMetrics(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<YouTubeDailyMetrics[]> {
    const [response, engaged] = await Promise.all([
      this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: DAILY_METRICS.join(','),
        dimensions: 'day',
        filters: `video==${videoId}`,
        sort: 'day',
      }),
      this.fetchDailyEngagedViews(videoId, startDate, endDate),
    ]);

    const rows = (response.data.rows as unknown[][] | undefined) ?? [];
    if (rows.length === 0) return [];

    const headers = (response.data.columnHeaders ?? []).map((h) => h.name);
    const indexOf = (name: string) => {
      const index = headers.indexOf(name);
      if (index < 0) {
        throw new Error(`YouTube daily report has no ${name} column`);
      }
      return index;
    };
    const dayIndex = indexOf('day');
    const metricIndex = Object.fromEntries(
      DAILY_METRICS.map((name) => [name, indexOf(name)]),
    ) as Record<DailyMetric, number>;

    return rows.map((row) => {
      const date = String(row[dayIndex]);
      const value = (name: DailyMetric) => {
        const cell = row[metricIndex[name]];
        if (typeof cell !== 'number' || !Number.isFinite(cell)) {
          throw new Error(`YouTube daily report has no ${name} for ${date}`);
        }
        return cell;
      };

      return {
        date,
        views: value('views'),
        likes: value('likes'),
        dislikes: value('dislikes'),
        comments: value('comments'),
        shares: value('shares'),
        estimatedMinutesWatched: value('estimatedMinutesWatched'),
        averageViewDuration: value('averageViewDuration'),
        averageViewPercentage: value('averageViewPercentage'),
        subscribersGained: value('subscribersGained'),
        subscribersLost: value('subscribersLost'),
        engagedViews: engaged?.get(date) ?? null,
      };
    });
  }

  /**
   * Engaged views by day (KB-50), in a query of their own like revenue.
   *
   * Never throws. A refusal of this one metric must cost this one metric:
   * inside the core query it would fail the day's views and, through
   * `getVideoAnalytics`' Promise.all, the whole sync of the video. On
   * failure every day reads null — not reported — and the next sync retries.
   */
  private async fetchDailyEngagedViews(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<Map<string, number> | null> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'engagedViews',
        dimensions: 'day',
        filters: `video==${videoId}`,
        sort: 'day',
      });

      const rows = (response.data.rows as Array<[string, number]>) ?? [];

      return new Map(
        rows
          .filter(([, value]) => Number.isFinite(value))
          .map(([date, value]) => [date, value]),
      );
    } catch (error) {
      const logger = await getLogger();
      logger.warn(
        {
          name: 'youtube-analytics.engaged-views',
          videoId,
          error: error instanceof Error ? error.message : String(error),
        },
        'engagedViews query failed; stored as not reported',
      );
      return null;
    }
  }

  /**
   * Fetches audience retention data
   *
   * Uses lifetime data (from 2020-01-01 to today) as retention
   * is calculated across all views.
   */
  private async fetchRetention(
    videoId: string,
  ): Promise<RetentionData | undefined> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate: '2020-01-01', // Lifetime
        endDate: formatDate(new Date()),
        metrics: 'audienceWatchRatio',
        dimensions: 'elapsedVideoTimeRatio',
        filters: `video==${videoId}`,
        sort: 'elapsedVideoTimeRatio',
      });

      return {
        points: ((response.data.rows as number[][]) ?? []).map((row) => ({
          elapsedVideoTimeRatio: row[0]!,
          audienceWatchRatio: row[1]!,
        })),
      };
    } catch {
      // Retention data may not be available for all videos
      return undefined;
    }
  }

  /**
   * Fetches demographic breakdown (age and gender)
   */
  private async fetchDemographics(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<DemographicData | undefined> {
    try {
      const [ageResponse, genderResponse] = await Promise.all([
        this.youtubeAnalytics.reports.query({
          ids: 'channel==MINE',
          startDate,
          endDate,
          metrics: 'viewerPercentage',
          dimensions: 'ageGroup',
          filters: `video==${videoId}`,
        }),
        this.youtubeAnalytics.reports.query({
          ids: 'channel==MINE',
          startDate,
          endDate,
          metrics: 'viewerPercentage',
          dimensions: 'gender',
          filters: `video==${videoId}`,
        }),
      ]);

      return {
        ageGroups: ((ageResponse.data.rows as [string, number][]) ?? []).map(
          (row) => ({
            ageGroup:
              row[0] as DemographicData['ageGroups'][number]['ageGroup'],
            viewPercentage: row[1],
          }),
        ),
        genders: ((genderResponse.data.rows as [string, number][]) ?? []).map(
          (row) => ({
            gender: row[0] as DemographicData['genders'][number]['gender'],
            viewPercentage: row[1],
          }),
        ),
      };
    } catch {
      // Demographics may not be available for all videos (requires sufficient views)
      return undefined;
    }
  }

  /**
   * Fetches traffic source breakdown
   */
  private async fetchTrafficSources(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<TrafficSourceData[]> {
    const response = await this.youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'insightTrafficSourceType',
      filters: `video==${videoId}`,
      sort: '-views',
    });

    return ((response.data.rows as [string, number, number][]) ?? []).map(
      (row) => ({
        source: row[0] as TrafficSourceData['source'],
        views: row[1] ?? 0,
        watchTimeMinutes: row[2] ?? 0,
      }),
    );
  }

  /**
   * Fetches geographic breakdown by country
   */
  private async fetchGeography(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<GeographyData[]> {
    const response = await this.youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,viewerPercentage',
      dimensions: 'country',
      filters: `video==${videoId}`,
      sort: '-views',
      maxResults: 25,
    });

    return (
      (response.data.rows as [string, number, number, number][]) ?? []
    ).map((row) => ({
      country: row[0],
      views: row[1] ?? 0,
      watchTimeMinutes: row[2] ?? 0,
      viewPercentage: row[3] ?? 0,
    }));
  }

  /**
   * Fetches device type breakdown (mobile, desktop, tablet, TV, etc.)
   */
  private async fetchDeviceBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<DeviceBreakdownData[]> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType',
        filters: `video==${videoId}`,
        sort: '-views',
      });

      return ((response.data.rows as [string, number, number][]) ?? []).map(
        (row) => ({
          deviceType: row[0] as DeviceBreakdownData['deviceType'],
          views: row[1] ?? 0,
          watchTimeMinutes: row[2] ?? 0,
        }),
      );
    } catch {
      // Device breakdown may not be available for all videos
      return [];
    }
  }

  /**
   * Fetches operating system breakdown (iOS, Android, Windows, etc.)
   */
  private async fetchOperatingSystemBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<OperatingSystemData[]> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'operatingSystem',
        filters: `video==${videoId}`,
        sort: '-views',
        maxResults: 20,
      });

      return ((response.data.rows as [string, number][]) ?? []).map((row) => ({
        operatingSystem: row[0],
        views: row[1] ?? 0,
      }));
    } catch {
      // Operating system breakdown may not be available for all videos
      return [];
    }
  }

  /**
   * Fetches city-level geography breakdown
   */
  private async fetchCityGeography(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<CityGeographyData[]> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'city',
        filters: `video==${videoId}`,
        sort: '-views',
        maxResults: 50,
      });

      return ((response.data.rows as [string, number][]) ?? []).map((row) => ({
        city: row[0],
        views: row[1] ?? 0,
      }));
    } catch {
      // City geography may not be available for all videos
      return [];
    }
  }

  /**
   * Fetches subscribed status breakdown (subscribed vs non-subscribed viewers)
   */
  private async fetchSubscribedStatus(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<SubscribedStatusData | undefined> {
    try {
      const response = await this.youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'subscribedStatus',
        filters: `video==${videoId}`,
      });

      const rows = (response.data.rows as [string, number][]) ?? [];
      const subscribedRow = rows.find((r) => r[0] === 'SUBSCRIBED');
      const unsubscribedRow = rows.find((r) => r[0] === 'UNSUBSCRIBED');

      return {
        subscribed: subscribedRow?.[1] ?? 0,
        notSubscribed: unsubscribedRow?.[1] ?? 0,
      };
    } catch {
      // Subscribed status may not be available for all videos
      return undefined;
    }
  }

  /**
   * Gets basic video info from YouTube Data API v3
   */
  async getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
    const response = await this.youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    });

    const video = response.data.items?.[0];
    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    return {
      title: video.snippet?.title ?? '',
      thumbnailUrl: video.snippet?.thumbnails?.high?.url ?? '',
      publishedAt: video.snippet?.publishedAt ?? '',
      duration: parseDuration(video.contentDetails?.duration ?? ''),
    };
  }

  /**
   * The published assets' durations in whole seconds, keyed by video id
   * (FILM-1710).
   *
   * One `videos.list` call per 50 ids — the Data API's ceiling, at 1 quota
   * unit a call whatever the id count. A video missing from the result was
   * deleted, made private to this channel, or has no finished duration
   * (`P0D`, a live broadcast): all of them are "unknown", so they are left
   * out of the map rather than recorded as zero.
   */
  async getVideoDurations(videoIds: string[]): Promise<Map<string, number>> {
    const durations = new Map<string, number>();

    for (let i = 0; i < videoIds.length; i += YOUTUBE_VIDEOS_LIST_MAX_IDS) {
      const response = await this.youtube.videos.list({
        part: ['contentDetails'],
        id: videoIds.slice(i, i + YOUTUBE_VIDEOS_LIST_MAX_IDS),
        maxResults: YOUTUBE_VIDEOS_LIST_MAX_IDS,
      });

      for (const video of response.data.items ?? []) {
        const seconds = parseIsoDurationSeconds(
          video.contentDetails?.duration ?? '',
        );

        if (video.id && seconds !== null) durations.set(video.id, seconds);
      }
    }

    return durations;
  }
}

/** `videos.list` accepts at most 50 comma-separated ids. */
const YOUTUBE_VIDEOS_LIST_MAX_IDS = 50;

/**
 * Creates a YouTubeAnalyticsProvider with the given access token
 */
export function createYouTubeAnalyticsProvider(
  accessToken: string,
): YouTubeAnalyticsProvider {
  return new YouTubeAnalyticsProvider(accessToken);
}

/**
 * The period's non-revenue totals, from its days (FILM-1712).
 *
 * The daily query carries every metric the totals query did (KB-94 added
 * the last three), so asking YouTube again for the period was a second read
 * of the same figures. Counts are summed; the two averages are recomputed
 * from their definitions rather than averaged: duration is minutes watched ×
 * 60 / views, and percentage viewed is weighted by each day's views. A period
 * with no views has no average, and reads 0 as before.
 */
export function totalsFromDays(
  days: readonly YouTubeDailyMetrics[],
): Omit<YouTubeTotals, keyof RevenueTotals> {
  const sum = (pick: (day: YouTubeDailyMetrics) => number) =>
    days.reduce((total, day) => total + pick(day), 0);

  const views = sum((day) => day.views);
  const estimatedMinutesWatched = sum((day) => day.estimatedMinutesWatched);

  return {
    views,
    likes: sum((day) => day.likes),
    dislikes: sum((day) => day.dislikes),
    comments: sum((day) => day.comments),
    shares: sum((day) => day.shares),
    estimatedMinutesWatched,
    averageViewDuration: views > 0 ? (estimatedMinutesWatched * 60) / views : 0,
    averageViewPercentage:
      views > 0
        ? sum((day) => day.averageViewPercentage * day.views) / views
        : 0,
    subscribersGained: sum((day) => day.subscribersGained),
    subscribersLost: sum((day) => day.subscribersLost),
  };
}
