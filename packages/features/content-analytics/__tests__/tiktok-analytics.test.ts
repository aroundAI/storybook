import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TikTokAnalyticsProvider,
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
  TikTokVideoNotFoundError,
  createTikTokAnalyticsProvider,
} from '../src/providers/tiktok/tiktok-analytics';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TikTokAnalyticsProvider', () => {
  let provider: TikTokAnalyticsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TikTokAnalyticsProvider('test-access-token');
  });

  describe('constructor', () => {
    it('should initialize with access token', () => {
      expect(provider).toBeDefined();
    });
  });

  describe('createTikTokAnalyticsProvider', () => {
    it('should create provider instance', () => {
      const newProvider = createTikTokAnalyticsProvider('another-token');
      expect(newProvider).toBeInstanceOf(TikTokAnalyticsProvider);
    });
  });

  describe('getVideoAnalytics', () => {
    it('should fetch video analytics successfully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [
                  {
                    id: 'test-video-id',
                    view_count: 1000,
                    like_count: 50,
                    comment_count: 25,
                    share_count: 10,
                    save_count: 15,
                    average_watch_time: 45.5,
                    total_play_time: 45500,
                    full_video_watched_rate: 0.65,
                    traffic_source_types: {
                      for_you: 60,
                      following: 25,
                      profile: 10,
                      search: 5,
                    },
                  },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                audience_countries: [
                  { country: 'US', percentage: 40 },
                  { country: 'UK', percentage: 20 },
                ],
                audience_genders: { male: 45, female: 50, other: 5 },
                audience_ages: [
                  { age_range: '18-24', percentage: 35 },
                  { age_range: '25-34', percentage: 40 },
                ],
              },
            }),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.videoId).toBe('test-video-id');
      expect(result.totals.views).toBe(1000);
      expect(result.totals.likes).toBe(50);
      expect(result.totals.comments).toBe(25);
      expect(result.totals.shares).toBe(10);
      expect(result.totals.saves).toBe(15);
      expect(result.totals.averageWatchTime).toBe(45.5);
      expect(result.totals.totalPlayTime).toBe(45500);
      expect(result.totals.fullVideoWatchedRate).toBe(0.65);
      expect(result.dailyData).toEqual([]);
    });

    it('should return correct totals structure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [
                  {
                    id: 'test-video-id',
                    view_count: 1000,
                    like_count: 50,
                    comment_count: 25,
                    share_count: 10,
                    save_count: 15,
                    average_watch_time: 45,
                    total_play_time: 45000,
                    full_video_watched_rate: 0.7,
                  },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.totals).toEqual({
        views: 1000,
        likes: 50,
        comments: 25,
        shares: 10,
        saves: 15,
        profileViews: 0,
        followersGained: 0,
        averageWatchTime: 45,
        totalPlayTime: 45000,
        fullVideoWatchedRate: 0.7,
      });
    });

    it('should handle empty video response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              videos: [],
            },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'non-existent' }),
      ).rejects.toThrow(TikTokVideoNotFoundError);
    });

    it('should handle missing optional fields', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [
                  {
                    id: 'test-video-id',
                    // All fields missing
                  },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.totals.views).toBe(0);
      expect(result.totals.likes).toBe(0);
      expect(result.totals.comments).toBe(0);
      expect(result.totals.shares).toBe(0);
      expect(result.totals.saves).toBe(0);
      expect(result.totals.averageWatchTime).toBe(0);
      expect(result.trafficSources).toEqual([]);
    });

    it('should parse audience data correctly', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [{ id: 'test-video-id', view_count: 100 }],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                audience_countries: [
                  { country: 'US', percentage: 50 },
                  { country: 'CA', percentage: 30 },
                ],
                audience_genders: { male: 40, female: 55, other: 5 },
                audience_ages: [
                  { age_range: '18-24', percentage: 45 },
                  { age_range: '25-34', percentage: 35 },
                ],
              },
            }),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.audience).toBeDefined();
      expect(result.audience?.countries).toEqual([
        { country: 'US', percentage: 50 },
        { country: 'CA', percentage: 30 },
      ]);
      expect(result.audience?.genderDistribution).toEqual({
        male: 40,
        female: 55,
        other: 5,
      });
      expect(result.audience?.ageGroups).toEqual([
        { ageGroup: '18-24', percentage: 45 },
        { ageGroup: '25-34', percentage: 35 },
      ]);
    });

    it('should parse traffic sources correctly', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [
                  {
                    id: 'test-video-id',
                    view_count: 100,
                    traffic_source_types: {
                      for_you: 60,
                      following: 25,
                      sound: 5,
                      hashtag: 5,
                      profile: 3,
                      search: 2,
                    },
                  },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.trafficSources).toEqual([
        { source: 'For You', percentage: 60 },
        { source: 'Following', percentage: 25 },
        { source: 'Sound', percentage: 5 },
        { source: 'Hashtag', percentage: 5 },
        { source: 'Profile', percentage: 3 },
        { source: 'Search', percentage: 2 },
      ]);
    });

    it('should handle unknown traffic sources as Other', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [
                  {
                    id: 'test-video-id',
                    traffic_source_types: {
                      for_you: 60,
                      unknown_source: 40,
                    },
                  },
                ],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.trafficSources).toContainEqual({
        source: 'Other',
        percentage: 40,
      });
    });
  });

  describe('getAccountAnalytics', () => {
    it('should fetch account analytics successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              user: {
                follower_count: 10000,
              },
            },
          }),
      });

      const result = await provider.getAccountAnalytics();

      expect(result.followers).toBe(10000);
      expect(result.followersGained).toBe(0);
      expect(result.profileViews).toBe(0);
      expect(result.videoViews).toBe(0);
    });

    it('should handle missing follower count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              user: {},
            },
          }),
      });

      const result = await provider.getAccountAnalytics();

      expect(result.followers).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw TikTokVideoNotFoundError when video not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              videos: [],
            },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'non-existent' }),
      ).rejects.toThrow(TikTokVideoNotFoundError);
    });

    it('should throw TikTokVideoNotFoundError with correct message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              videos: [],
            },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'non-existent' }),
      ).rejects.toThrow('Video not found: non-existent');
    });

    it('should throw TikTokAnalyticsScopeError for auth errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('access_token_invalid'),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'test-video' }),
      ).rejects.toThrow(TikTokAnalyticsScopeError);
    });

    it('should throw TikTokAnalyticsScopeError for forbidden errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'test-video' }),
      ).rejects.toThrow(TikTokAnalyticsScopeError);
    });

    it('should throw TikTokRateLimitError for rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('spam_risk_too_many_pending'),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'test-video' }),
      ).rejects.toThrow(TikTokRateLimitError);
    });

    it('should re-throw non-specific errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Network error'),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'test-video' }),
      ).rejects.toThrow('Network error');
    });

    it('should handle API error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              code: 'some_error',
              message: 'Something went wrong',
            },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'test-video' }),
      ).rejects.toThrow('Something went wrong');
    });

    it('should handle audience data fetch failure gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [{ id: 'test-video-id', view_count: 100 }],
              },
            }),
        })
        .mockRejectedValueOnce(new Error('Audience fetch failed'));

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      // Should still return result without audience data
      expect(result.videoId).toBe('test-video-id');
      expect(result.audience).toBeUndefined();
    });

    it('should throw TikTokAnalyticsScopeError for account analytics auth errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('unauthorized'),
      });

      await expect(provider.getAccountAnalytics()).rejects.toThrow(
        TikTokAnalyticsScopeError,
      );
    });

    it('should throw TikTokRateLimitError for account analytics rate limits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('too many requests'),
      });

      await expect(provider.getAccountAnalytics()).rejects.toThrow(
        TikTokRateLimitError,
      );
    });
  });

  describe('date range handling', () => {
    it('should use default date range of 7 days', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [{ id: 'test-video-id' }],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      expect(result.period.endDate).toBe(endDate.toISOString().split('T')[0]);
      expect(result.period.startDate).toBe(
        startDate.toISOString().split('T')[0],
      );
    });

    it('should use custom date range of 28 days', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                videos: [{ id: 'test-video-id' }],
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({}),
        });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
        dateRange: 28,
      });

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 28);

      expect(result.period.endDate).toBe(endDate.toISOString().split('T')[0]);
      expect(result.period.startDate).toBe(
        startDate.toISOString().split('T')[0],
      );
    });
  });
});
