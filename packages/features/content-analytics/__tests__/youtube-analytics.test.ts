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
      const oauth2Instance = (google.auth.OAuth2 as ReturnType<typeof vi.fn>)
        .mock.results[0]?.value;
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
