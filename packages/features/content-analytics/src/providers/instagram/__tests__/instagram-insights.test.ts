import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InstagramInsightsProvider,
  InstagramInsightsScopeError,
  createInstagramInsightsProvider,
} from '../instagram-insights';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('InstagramInsightsProvider', () => {
  const accessToken = 'test-access-token';
  const instagramAccountId = '12345678';
  let provider: InstagramInsightsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createInstagramInsightsProvider(accessToken, instagramAccountId);
  });

  describe('createInstagramInsightsProvider', () => {
    it('should create a provider instance', () => {
      expect(provider).toBeInstanceOf(InstagramInsightsProvider);
    });
  });

  describe('getMediaInsights', () => {
    it('should fetch insights for a Reel', async () => {
      // Mock media type response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ media_type: 'REELS' }),
      });

      // Mock insights response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { name: 'views', values: [{ value: 1000 }] },
              { name: 'reach', values: [{ value: 500 }] },
              { name: 'total_interactions', values: [{ value: 150 }] },
              { name: 'likes', values: [{ value: 100 }] },
              { name: 'comments', values: [{ value: 25 }] },
              { name: 'saved', values: [{ value: 15 }] },
              { name: 'shares', values: [{ value: 10 }] },
            ],
          }),
      });

      // Mock reach breakdown response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ['FOLLOWER'], value: 300 },
                        { dimension_values: ['NON_FOLLOWER'], value: 200 },
                      ],
                    },
                  ],
                },
              },
            ],
          }),
      });

      // Mock audience response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'country',
                total_value: {
                  breakdowns: [
                    {
                      results: [
                        { dimension_values: ['US'], value: 300 },
                        { dimension_values: ['GB'], value: 100 },
                      ],
                    },
                  ],
                },
              },
            ],
          }),
      });

      const result = await provider.getMediaInsights({
        mediaId: 'test-media-id',
      });

      expect(result.mediaId).toBe('test-media-id');
      expect(result.mediaType).toBe('REELS');
      expect(result.totals.views).toBe(1000);
      expect(result.totals.reach).toBe(500);
      expect(result.totals.likes).toBe(100);
      expect(result.totals.comments).toBe(25);
      expect(result.totals.saved).toBe(15);
      expect(result.totals.shares).toBe(10);
      expect(result.reachBreakdown?.followerReach).toBe(300);
      expect(result.reachBreakdown?.nonFollowerReach).toBe(200);
      expect(result.reachBreakdown?.followersPercentage).toBe(60);
    });

    it('should fetch insights for a Video using the views metric', async () => {
      // Mock media type response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ media_type: 'VIDEO' }),
      });

      // Mock insights response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { name: 'reach', values: [{ value: 500 }] },
              { name: 'views', values: [{ value: 800 }] },
              { name: 'total_interactions', values: [{ value: 100 }] },
              { name: 'likes', values: [{ value: 75 }] },
              { name: 'comments', values: [{ value: 15 }] },
              { name: 'saved', values: [{ value: 10 }] },
            ],
          }),
      });

      // Mock audience response (no reach breakdown for Video)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await provider.getMediaInsights({
        mediaId: 'test-video-id',
      });

      expect(result.mediaType).toBe('VIDEO');
      expect(result.totals.views).toBe(800);
      expect(result.reachBreakdown).toBeUndefined(); // No breakdown for Videos
    });

    it('should throw InstagramInsightsScopeError on permission error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              message: 'OAuthException: Access denied',
              type: 'OAuthException',
              code: 190,
            },
          }),
      });

      await expect(
        provider.getMediaInsights({ mediaId: 'test-media-id' }),
      ).rejects.toThrow(InstagramInsightsScopeError);
    });

    it('should throw error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      await expect(
        provider.getMediaInsights({ mediaId: 'test-media-id' }),
      ).rejects.toThrow('Failed to fetch media info: HTTP 500');
    });

    it('should handle missing metrics gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ media_type: 'REELS' }),
      });

      // Empty insights response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      // Empty reach breakdown
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      // Empty audience
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await provider.getMediaInsights({
        mediaId: 'test-media-id',
      });

      expect(result.totals.views).toBe(0);
      expect(result.totals.reach).toBe(0);
      expect(result.totals.likes).toBe(0);
    });
  });

  describe('getAccountInsights', () => {
    // The documented account-insights contract, re-read 2026-09-21: `views`
    // is `total_value` only, and `profile_views` / `website_clicks` are gone
    // from the metrics table (their time series ended January 2025). A
    // `total_value` item carries `total_value: { value }`, not `values[]`.
    it('requests only documented metrics, as a total', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ followers_count: 5000 }),
        });

      await provider.getAccountInsights('week');

      const params = new URL(mockFetch.mock.calls[0]![0] as string)
        .searchParams;

      expect(params.get('metric')!.split(',')).toEqual(['views', 'reach']);
      expect(params.get('metric_type')).toBe('total_value');
      expect(params.get('period')).toBe('day');
    });

    it('reads the documented total_value response shape', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { name: 'views', period: 'day', total_value: { value: 2500 } },
                { name: 'reach', period: 'day', total_value: { value: 1200 } },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ followers_count: 5000 }),
        });

      const result = await provider.getAccountInsights('week');

      expect(result).toEqual({ views: 2500, reach: 1200, followerCount: 5000 });
    });

    it('reports an absent follower count as null, not zero', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const result = await provider.getAccountInsights('week');

      // FILM-1607: an absent count is unknown, and a zero would read as a
      // measurement.
      expect(result.followerCount).toBeNull();
    });

    it('should throw InstagramInsightsScopeError on permission error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              message: 'Permission denied',
              type: 'OAuthException',
            },
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ followers_count: 0 }),
      });

      await expect(provider.getAccountInsights('week')).rejects.toThrow(
        InstagramInsightsScopeError,
      );
    });

    it('should throw error on HTTP failure for metrics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ followers_count: 5000 }),
      });

      await expect(provider.getAccountInsights('week')).rejects.toThrow(
        'Failed to fetch account insights: HTTP 503',
      );
    });

    it('should throw error on HTTP failure for follower count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ name: 'views', values: [{ value: 1000 }] }],
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });

      await expect(provider.getAccountInsights('week')).rejects.toThrow(
        'Failed to fetch follower count: HTTP 404',
      );
    });

    it('should throw error on accountData error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ name: 'views', values: [{ value: 1000 }] }],
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              message: 'Account not found',
              type: 'GraphMethodException',
            },
          }),
      });

      await expect(provider.getAccountInsights('week')).rejects.toThrow(
        'Account not found',
      );
    });
  });

  describe('InstagramInsightsScopeError', () => {
    it('should have correct name and message', () => {
      const error = new InstagramInsightsScopeError();

      expect(error.name).toBe('InstagramInsightsScopeError');
      expect(error.message).toContain('Instagram Insights access denied');
      expect(error.message).toContain('disconnect and reconnect');
    });
  });
});
