import 'server-only';

import { google } from 'googleapis';

import { formatDate, parseDuration } from '../../lib/utils';
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
  YouTubeTotals,
  YouTubeVideoInfo,
} from './types';

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
    });
    this.youtube = google.youtube({ version: 'v3', auth: oauth2Client });
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
    const { videoId, startDate, endDate } = input;
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    try {
      // Fetch metrics in parallel for optimal performance
      const [
        totals,
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
        this.fetchTotals(videoId, startDateStr, endDateStr),
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
        totals,
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
   * Fetches aggregate totals for the date range
   */
  private async fetchTotals(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<YouTubeTotals> {
    const response = await this.youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: [
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
        'estimatedRevenue',
        'estimatedAdRevenue',
        'estimatedRedPartnerRevenue',
      ].join(','),
      filters: `video==${videoId}`,
    });

    const row = (response.data.rows?.[0] as number[] | undefined) ?? [];

    return {
      views: row[0] ?? 0,
      likes: row[1] ?? 0,
      dislikes: row[2] ?? 0,
      comments: row[3] ?? 0,
      shares: row[4] ?? 0,
      estimatedMinutesWatched: row[5] ?? 0,
      averageViewDuration: row[6] ?? 0,
      averageViewPercentage: row[7] ?? 0,
      subscribersGained: row[8] ?? 0,
      subscribersLost: row[9] ?? 0,
      estimatedRevenue: Math.round((row[10] ?? 0) * 100), // Convert to cents
      estimatedAdRevenue: Math.round((row[11] ?? 0) * 100), // Ad revenue in cents
      estimatedRedPartnerRevenue: Math.round((row[12] ?? 0) * 100), // YouTube Premium in cents
    };
  }

  /**
   * Fetches daily metrics breakdown
   */
  private async fetchDailyMetrics(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<YouTubeDailyMetrics[]> {
    const response = await this.youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics:
        'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
      dimensions: 'day',
      filters: `video==${videoId}`,
      sort: 'day',
    });

    return ((response.data.rows as Array<[string, ...number[]]>) ?? []).map(
      (row) => ({
        date: row[0],
        views: row[1] ?? 0,
        estimatedMinutesWatched: row[2] ?? 0,
        averageViewDuration: row[3] ?? 0,
        subscribersGained: row[4] ?? 0,
      }),
    );
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
}

/**
 * Creates a YouTubeAnalyticsProvider with the given access token
 */
export function createYouTubeAnalyticsProvider(
  accessToken: string,
): YouTubeAnalyticsProvider {
  return new YouTubeAnalyticsProvider(accessToken);
}
