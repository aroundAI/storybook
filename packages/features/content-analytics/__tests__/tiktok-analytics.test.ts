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
    // reset, not clear: clearAllMocks leaves queued mockResolvedValueOnce
    // values in place, so a test that consumes one fewer response than it
    // queued silently feeds the leftover to the next test.
    mockFetch.mockReset();
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
      mockFetch.mockResolvedValueOnce({
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
                },
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
      expect(result.dailyData).toEqual([]);
    });

    it('asks the Display API only for fields it has', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { videos: [{ id: 'test-video-id', view_count: 1 }] },
          }),
      });

      await provider.getVideoAnalytics({ videoId: 'test-video-id' });

      // One request. The second call used to ask /research/creator/insights/,
      // a surface restricted to non-profit academic researchers, inside a
      // swallowing try/catch - so every sync made a request that could not
      // succeed and reported nothing.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const url = mockFetch.mock.calls[0]![0] as string;
      const fields = new URL(url).searchParams.get('fields')!.split(',');

      expect(fields).toEqual([
        'id',
        'like_count',
        'comment_count',
        'share_count',
        'view_count',
      ]);
    });

    it('reports what the Display API cannot measure as zero, not as data', async () => {
      // The endpoint has no save, watch-time or traffic-source field at all.
      // These were once read off the response as `save_count`,
      // `average_watch_time`, `total_play_time`, `full_video_watched_rate`
      // and `traffic_source_types` - five names it does not have - so four
      // metrics arrived as zero and looked measured.
      // docs/platform-capability-reference.md
      mockFetch.mockResolvedValueOnce({
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
                },
              ],
            },
          }),
      });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.totals).toEqual({
        views: 1000,
        likes: 50,
        comments: 25,
        shares: 10,
        saves: 0,
        profileViews: 0,
        followersGained: 0,
        averageWatchTime: 0,
        totalPlayTime: 0,
        fullVideoWatchedRate: 0,
      });
      expect(result.trafficSources).toEqual([]);
      expect(result.audience).toBeUndefined();
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
      mockFetch.mockResolvedValueOnce({
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
      });

      const result = await provider.getVideoAnalytics({
        videoId: 'test-video-id',
      });

      expect(result.totals.views).toBe(0);
      expect(result.totals.likes).toBe(0);
      expect(result.totals.comments).toBe(0);
      expect(result.totals.shares).toBe(0);
      expect(result.trafficSources).toEqual([]);
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

      // null, not 0. A malformed 200 used to become an exact zero, and
      // FILM-1607 stores TikTok counts as exact anchors — which are
      // authoritative — so a false zero would re-level the whole
      // reconstructed subscriber curve from that day on.
      expect(result.followers).toBeNull();
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
