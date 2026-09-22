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

    it('should return correct totals structure', async () => {
      mockReportsQuery.mockResolvedValue({
        data: {
          rows: [[1000, 50, 2, 25, 10, 5000, 180, 45.5, 20, 5, 12.5]],
        },
      });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-31'),
      });

      expect(result.totals).toEqual({
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
        estimatedRevenue: 1250, // 12.5 * 100 = 1250 cents
        // The ads/Premium split added in FILM-1601. Zero here because this
        // fixture's response carries neither column — which is the case
        // that matters: a channel without monetization must report 0
        // rather than leaving the fields absent.
        estimatedAdRevenue: 0,
        estimatedRedPartnerRevenue: 0,
      });
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
      // First few calls succeed, retention call fails
      mockReportsQuery
        .mockResolvedValueOnce({
          data: { rows: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] },
        }) // totals
        .mockResolvedValueOnce({ data: { rows: [] } }) // daily
        .mockRejectedValueOnce(new Error('API Error')) // retention - fails
        .mockResolvedValueOnce({ data: { rows: [] } }) // demographics
        .mockResolvedValueOnce({ data: { rows: [] } }) // traffic
        .mockResolvedValueOnce({ data: { rows: [] } }); // geography

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
