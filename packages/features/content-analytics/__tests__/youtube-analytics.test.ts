import { google } from 'googleapis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  YouTubeAnalyticsProvider,
  YouTubeAnalyticsScopeError,
  createYouTubeAnalyticsProvider,
} from '../src/providers/youtube/youtube-analytics';

// Mock googleapis before importing the provider
vi.mock('googleapis', () => {
  const mockReportsQuery = vi.fn();
  const mockVideosList = vi.fn();

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      youtubeAnalytics: vi.fn(() => ({
        reports: {
          query: mockReportsQuery,
        },
      })),
      youtube: vi.fn(() => ({
        videos: {
          list: mockVideosList,
        },
      })),
    },
  };
});

describe('YouTubeAnalyticsProvider', () => {
  let provider: YouTubeAnalyticsProvider;
  let mockReportsQuery: ReturnType<typeof vi.fn>;
  let mockVideosList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new YouTubeAnalyticsProvider('test-access-token');

    // Get the mocked functions
    const analyticsClient = (
      google.youtubeAnalytics as ReturnType<typeof vi.fn>
    )();
    mockReportsQuery = analyticsClient.reports.query as ReturnType<
      typeof vi.fn
    >;

    const youtubeClient = (google.youtube as ReturnType<typeof vi.fn>)();
    mockVideosList = youtubeClient.videos.list as ReturnType<typeof vi.fn>;
  });

  describe('constructor', () => {
    it('should initialize with access token', () => {
      expect(provider).toBeDefined();
      expect(google.auth.OAuth2).toHaveBeenCalled();
    });

    it('should create OAuth2 client with credentials', () => {
      // Through `unknown`: the googleapis constructor type and vitest's
      // Mock share no members, so TypeScript rejects the direct assertion.
      // This only surfaced once __tests__ entered the type net — the
      // directory was in both `include` and `exclude`, and exclude wins.
      const oauth2Instance = (
        google.auth.OAuth2 as unknown as ReturnType<typeof vi.fn>
      ).mock.results[0]?.value;
      expect(oauth2Instance.setCredentials).toHaveBeenCalledWith({
        access_token: 'test-access-token',
      });
    });
  });

  describe('createYouTubeAnalyticsProvider', () => {
    it('should create provider instance', () => {
      const newProvider = createYouTubeAnalyticsProvider('another-token');
      expect(newProvider).toBeInstanceOf(YouTubeAnalyticsProvider);
    });
  });

  describe('getVideoAnalytics', () => {
    it('should fetch all analytics in parallel', async () => {
      // Setup mock responses for all API calls
      mockReportsQuery.mockResolvedValue({
        data: { rows: [[1000, 50, 2, 25, 10, 5000, 180, 45.5, 20, 5, 12.5]] },
      });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result.videoId).toBe('test-video-id');
      expect(result.period.startDate).toBe('2025-01-01');
      expect(result.period.endDate).toBe('2025-01-31');
      expect(result.totals).toBeDefined();
      expect(result.dailyData).toBeDefined();
    });

    // Every reports.query answers by what it was asked for, so a test can tell
    // the totals call from the revenue call the way YouTube does.
    const TOTALS_ROW = [1000, 50, 2, 25, 10, 5000, 180, 45.5, 20, 5];

    function answerByMetrics(revenue: () => Promise<unknown>) {
      mockReportsQuery.mockImplementation(({ metrics }: { metrics: string }) =>
        metrics.includes('estimatedRevenue')
          ? revenue()
          : Promise.resolve({
              data: {
                rows: metrics.startsWith('views,likes,dislikes')
                  ? [TOTALS_ROW]
                  : [],
              },
            }),
      );
    }

    const input = {
      videoId: 'test-video-id',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-01-31'),
    };

    const NON_REVENUE_TOTALS = {
      views: 1000,
      likes: 50,
      dislikes: 2,
      comments: 25,
      shares: 10,
      estimatedMinutesWatched: 5000,
      averageViewDuration: 180,
      averageViewPercentage: 45.5,
      subscribersGained: 20,
      subscribersLost: 5,
    };

    it('does not ask for revenue unless told the monetary scope is held', async () => {
      answerByMetrics(() => Promise.reject(new Error('must not be called')));

      const result = await provider.getVideoAnalytics(input);

      const asked = mockReportsQuery.mock.calls.map(
        ([params]) => (params as { metrics: string }).metrics,
      );

      expect(asked.filter((metrics) => /revenue/i.test(metrics))).toEqual([]);
      expect(result.revenueAccess).toBe('scope_missing');
      expect(result.totals).toEqual({
        ...NON_REVENUE_TOTALS,
        estimatedRevenue: 0,
        estimatedAdRevenue: 0,
        estimatedRedPartnerRevenue: 0,
      });
    });

    it('fetches revenue in its own query and merges it into the totals', async () => {
      answerByMetrics(() =>
        Promise.resolve({ data: { rows: [[12.5, 10, 2.5]] } }),
      );

      const result = await provider.getVideoAnalytics({
        ...input,
        includeRevenue: true,
      });

      const revenueCalls = mockReportsQuery.mock.calls
        .map(([params]) => (params as { metrics: string }).metrics)
        .filter((metrics) => /revenue/i.test(metrics));

      expect(revenueCalls).toEqual([
        'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue',
      ]);
      expect(result.revenueAccess).toBe('authorised');
      expect(result.totals).toEqual({
        ...NON_REVENUE_TOTALS,
        estimatedRevenue: 1250, // 12.5 * 100 = 1250 cents
        estimatedAdRevenue: 1000,
        estimatedRedPartnerRevenue: 250,
      });
    });

    it('keeps the totals when the revenue query is forbidden', async () => {
      answerByMetrics(() => Promise.reject(new Error('Forbidden')));

      const result = await provider.getVideoAnalytics({
        ...input,
        includeRevenue: true,
      });

      expect(result.revenueAccess).toBe('account_type_gated');
      expect(result.totals.views).toBe(1000);
      expect(result.totals.estimatedRevenue).toBe(0);
    });

    it('does not read a quota 403 on revenue as an access state', async () => {
      answerByMetrics(() =>
        Promise.reject(new Error('Forbidden: quotaExceeded for this project')),
      );

      const result = await provider.getVideoAnalytics({
        ...input,
        includeRevenue: true,
      });

      expect(result.revenueAccess).toBe('unavailable');
      expect(result.totals.views).toBe(1000);
    });

    it('should handle empty API response', async () => {
      mockReportsQuery.mockResolvedValue({
        data: { rows: [] },
      });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result.totals.views).toBe(0);
      expect(result.totals.likes).toBe(0);
      expect(result.dailyData).toEqual([]);
    });
  });

  // KB-50. Engaged views travel in their own query, like revenue: a refusal
  // of that one metric must cost that one metric, not the day's views.
  describe('daily engaged views', () => {
    const CORE_DAY = [400, 20, 5, 2, 30, 60, 3];

    function answerDaily(engaged: () => Promise<unknown>) {
      mockReportsQuery.mockImplementation(
        ({ metrics, dimensions }: { metrics: string; dimensions?: string }) => {
          if (metrics === 'engagedViews') return engaged();
          if (dimensions === 'day') {
            return Promise.resolve({
              data: {
                rows: [
                  ['2026-09-20', ...CORE_DAY],
                  ['2026-09-21', ...CORE_DAY],
                ],
              },
            });
          }
          return Promise.resolve({ data: { rows: [] } });
        },
      );
    }

    const from = new Date('2026-09-20');
    const to = new Date('2026-09-21');

    it('asks for engagedViews by day in a query of its own, and merges it by date', async () => {
      answerDaily(() =>
        Promise.resolve({ data: { rows: [['2026-09-20', 330]] } }),
      );

      const daily = await provider.getDailyMetrics('vid', from, to);

      const engagedCalls = mockReportsQuery.mock.calls
        .map(([params]) => params as { metrics: string; dimensions?: string })
        .filter((params) => params.metrics.includes('engagedViews'));

      expect(engagedCalls).toEqual([
        expect.objectContaining({
          metrics: 'engagedViews',
          dimensions: 'day',
          filters: 'video==vid',
        }),
      ]);
      expect(daily.map((d) => [d.date, d.views, d.engagedViews])).toEqual([
        ['2026-09-20', 400, 330],
        ['2026-09-21', 400, null], // not in YouTube's answer: not reported
      ]);
    });

    it('keeps the daily views when the engagedViews query is refused', async () => {
      answerDaily(() => Promise.reject(new Error('Bad Request')));

      const daily = await provider.getDailyMetrics('vid', from, to);

      expect(daily.map((d) => [d.date, d.views, d.engagedViews])).toEqual([
        ['2026-09-20', 400, null],
        ['2026-09-21', 400, null],
      ]);
    });

    it('keeps the whole sync when the engagedViews query is refused', async () => {
      answerDaily(() => Promise.reject(new Error('Bad Request')));

      const result = await provider.getVideoAnalytics({
        videoId: 'vid',
        startDate: from,
        endDate: to,
      });

      expect(result.dailyData).toHaveLength(2);
      expect(result.dailyData.every((d) => d.engagedViews === null)).toBe(true);
    });
  });

  // FILM-1710
  describe('getVideoDurations', () => {
    it('reads contentDetails.duration, keyed by video id', async () => {
      mockVideosList.mockResolvedValue({
        data: {
          items: [
            { id: 'short-1', contentDetails: { duration: 'PT45S' } },
            { id: 'full-1', contentDetails: { duration: 'PT15M33S' } },
          ],
        },
      });

      const durations = await provider.getVideoDurations(['short-1', 'full-1']);

      expect([...durations]).toEqual([
        ['short-1', 45],
        ['full-1', 933],
      ]);
      expect(mockVideosList).toHaveBeenCalledWith({
        part: ['contentDetails'],
        id: ['short-1', 'full-1'],
        maxResults: 50,
      });
    });

    it('leaves out a video the API omits, and one with no finished length', async () => {
      // `P0D` is a live broadcast still running. Both are unknown — neither
      // is a zero-second video.
      mockVideosList.mockResolvedValue({
        data: {
          items: [{ id: 'live-1', contentDetails: { duration: 'P0D' } }],
        },
      });

      const durations = await provider.getVideoDurations(['live-1', 'gone-1']);

      expect(durations.size).toBe(0);
    });

    it('asks for at most 50 ids a call', async () => {
      mockVideosList.mockResolvedValue({ data: { items: [] } });

      const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);

      await provider.getVideoDurations(ids);

      expect(
        mockVideosList.mock.calls.map(([params]) => params.id.length),
      ).toEqual([50, 50, 20]);
    });
  });

  describe('getVideoInfo', () => {
    it('should return video info', async () => {
      mockVideosList.mockResolvedValue({
        data: {
          items: [
            {
              snippet: {
                title: 'Test Video',
                thumbnails: {
                  high: { url: 'https://example.com/thumb.jpg' },
                },
                publishedAt: '2025-01-15T12:00:00Z',
              },
              contentDetails: {
                duration: 'PT10M30S',
              },
            },
          ],
        },
      });

      const result = await provider.getVideoInfo('test-video-id');

      expect(result.title).toBe('Test Video');
      expect(result.thumbnailUrl).toBe('https://example.com/thumb.jpg');
      expect(result.publishedAt).toBe('2025-01-15T12:00:00Z');
      expect(result.duration).toBe(630); // 10*60 + 30 = 630 seconds
    });

    it('should throw error when video not found', async () => {
      mockVideosList.mockResolvedValue({
        data: { items: [] },
      });

      await expect(provider.getVideoInfo('non-existent')).rejects.toThrow(
        'Video not found: non-existent',
      );
    });

    it('should handle missing optional fields', async () => {
      mockVideosList.mockResolvedValue({
        data: {
          items: [
            {
              snippet: {},
              contentDetails: {},
            },
          ],
        },
      });

      const result = await provider.getVideoInfo('test-video-id');

      expect(result.title).toBe('');
      expect(result.thumbnailUrl).toBe('');
      expect(result.publishedAt).toBe('');
      expect(result.duration).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully for retention data', async () => {
      // Only the retention query fails. Answered by what is asked, not by
      // call order, which shifts whenever a query is added.
      mockReportsQuery.mockImplementation(({ metrics }: { metrics: string }) =>
        metrics === 'audienceWatchRatio'
          ? Promise.reject(new Error('API Error'))
          : Promise.resolve({ data: { rows: [] } }),
      );

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      // Retention should be undefined on error
      expect(result.retention).toBeUndefined();
      // Other data should still be present
      expect(result.totals).toBeDefined();
    });

    it('should handle API errors gracefully for demographics data', async () => {
      mockReportsQuery
        .mockResolvedValueOnce({
          data: { rows: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
        }) // totals
        .mockResolvedValueOnce({ data: { rows: [] } }) // daily
        .mockResolvedValueOnce({ data: { rows: [] } }) // retention
        .mockRejectedValueOnce(new Error('Insufficient views')) // demographics - fails
        .mockRejectedValueOnce(new Error('Insufficient views')) // demographics gender - fails
        .mockResolvedValueOnce({ data: { rows: [] } }) // traffic
        .mockResolvedValueOnce({ data: { rows: [] } }); // geography

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result.demographics).toBeUndefined();
    });

    it('should throw YouTubeAnalyticsScopeError for forbidden errors', async () => {
      mockReportsQuery.mockRejectedValueOnce(
        new Error('Request had insufficient authentication scopes'),
      );

      await expect(
        provider.getVideoAnalytics({
          videoId: 'test-video-id',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-01-31'),
        }),
      ).rejects.toThrow(YouTubeAnalyticsScopeError);
    });

    it('should throw YouTubeAnalyticsScopeError for access denied errors', async () => {
      mockReportsQuery.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(
        provider.getVideoAnalytics({
          videoId: 'test-video-id',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-01-31'),
        }),
      ).rejects.toThrow(YouTubeAnalyticsScopeError);
    });

    it('should re-throw non-scope errors', async () => {
      mockReportsQuery.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.getVideoAnalytics({
          videoId: 'test-video-id',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-01-31'),
        }),
      ).rejects.toThrow('Network error');
    });
  });
});
