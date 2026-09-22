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

  describe("TikTok's response envelope", () => {
    // TikTok v2 returns an `error` object on EVERY response, success included:
    // `{ data, error: { code: 'ok', message: '', log_id } }`. Only a code other
    // than 'ok' is an error. The publishing provider already knows this
    // (tiktok-provider.ts checks `error?.code !== 'ok'`); analytics did not.
    const ok = { code: 'ok', message: '', log_id: '202609211234' };

    it('treats a successful response as a success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { videos: [{ id: 'v1', view_count: 1000, like_count: 50 }] },
            error: ok,
          }),
      });

      const result = await provider.getVideoAnalytics({ videoId: 'v1' });

      expect(result.totals.views).toBe(1000);
      expect(result.totals.likes).toBe(50);
    });

    it('reports a real error with its code, never as an empty message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            error: { code: 'invalid_params', message: '', log_id: 'x' },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'v1' }),
      ).rejects.toThrow('invalid_params');
    });

    it('classifies an invalid token as a scope error by its code', async () => {
      // TikTok's human message ("The access token is invalid") does not
      // contain the code the classifier looks for; the code must reach it.
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              code: 'access_token_invalid',
              message:
                'The access token is invalid or not found in the request.',
              log_id: 'x',
            },
          }),
      });

      await expect(
        provider.getVideoAnalytics({ videoId: 'v1' }),
      ).rejects.toBeInstanceOf(TikTokAnalyticsScopeError);
    });

    it('reads account analytics from a successful envelope', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { user: { follower_count: 42 } },
            error: ok,
          }),
      });

      const result = await provider.getAccountAnalytics();

      expect(result.followers).toBe(42);
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

  // FILM-1710. `duration` is on `/v2/video/query/`'s documented field list
  // (docs/platform-capability-reference.md) and needs the `video.list` scope,
  // which no connection holds until FILM-1711 — so the scope-error path is
  // the one production takes today, and it is tested as such.
  describe('getVideoDurations', () => {
    const ok = { code: 'ok', message: '', log_id: '202609211234' };

    it('asks for id and duration only, and keys the result by video id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              videos: [
                { id: 'v1', duration: 45 },
                { id: 'v2', duration: 31 },
              ],
            },
            error: ok,
          }),
      });

      const durations = await provider.getVideoDurations(['v1', 'v2']);

      expect([...durations]).toEqual([
        ['v1', 45],
        ['v2', 31],
      ]);

      const [url, init] = mockFetch.mock.calls[0]!;

      expect(url).toBe(
        'https://open.tiktokapis.com/v2/video/query/?fields=id,duration',
      );
      expect(JSON.parse(init.body)).toEqual({
        filters: { video_ids: ['v1', 'v2'] },
      });
    });

    it('leaves out a video with no duration, or a zero one: absent is not zero', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              videos: [{ id: 'v1' }, { id: 'v2', duration: 0 }],
            },
            error: ok,
          }),
      });

      const durations = await provider.getVideoDurations(['v1', 'v2', 'v3']);

      expect(durations.size).toBe(0);
    });

    it('sends at most 20 ids a request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { videos: [] }, error: ok }),
      });

      const ids = Array.from({ length: 45 }, (_, i) => `v${i}`);

      await provider.getVideoDurations(ids);

      const sizes = mockFetch.mock.calls.map(
        ([, init]) => JSON.parse(init.body).filters.video_ids.length,
      );

      expect(sizes).toEqual([20, 20, 5]);
    });

    it('raises a refused token as a scope error, by its code, and writes nothing', async () => {
      // The one refusal code the capability reference documents. Which code
      // TikTok sends for a token that is valid but lacks `video.list` is
      // FILM-1711's to establish; whatever it is, this throws and the
      // publish stays `duration_unknown`.
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              code: 'access_token_invalid',
              message:
                'The access token is invalid or not found in the request.',
              log_id: 'x',
            },
          }),
      });

      await expect(provider.getVideoDurations(['v1'])).rejects.toThrow(
        TikTokAnalyticsScopeError,
      );
    });
  });
});
