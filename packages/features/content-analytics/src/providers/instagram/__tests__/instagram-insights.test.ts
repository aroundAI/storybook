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
        json: () => Promise.resolve({ media_type: 'REELS' }),
      });

      // Mock insights response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              { name: 'plays', values: [{ value: 1000 }] },
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
      expect(result.totals.plays).toBe(1000);
      expect(result.totals.reach).toBe(500);
      expect(result.totals.likes).toBe(100);
      expect(result.totals.comments).toBe(25);
      expect(result.totals.saved).toBe(15);
      expect(result.totals.shares).toBe(10);
      expect(result.reachBreakdown?.followerReach).toBe(300);
      expect(result.reachBreakdown?.nonFollowerReach).toBe(200);
      expect(result.reachBreakdown?.followersPercentage).toBe(60);
    });

    it('should fetch insights for a Video without plays metric', async () => {
      // Mock media type response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ media_type: 'VIDEO' }),
      });

      // Mock insights response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              { name: 'reach', values: [{ value: 500 }] },
              { name: 'impressions', values: [{ value: 800 }] },
              { name: 'total_interactions', values: [{ value: 100 }] },
              { name: 'likes', values: [{ value: 75 }] },
              { name: 'comments', values: [{ value: 15 }] },
              { name: 'saved', values: [{ value: 10 }] },
            ],
          }),
      });

      // Mock audience response (no reach breakdown for Video)
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await provider.getMediaInsights({
        mediaId: 'test-video-id',
      });

      expect(result.mediaType).toBe('VIDEO');
      expect(result.totals.plays).toBe(0); // Videos don't have plays
      expect(result.totals.impressions).toBe(800);
      expect(result.reachBreakdown).toBeUndefined(); // No breakdown for Videos
    });

    it('should throw InstagramInsightsScopeError on permission error', async () => {
      mockFetch.mockResolvedValueOnce({
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

    it('should handle missing metrics gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ media_type: 'REELS' }),
      });

      // Empty insights response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      // Empty reach breakdown
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      // Empty audience
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await provider.getMediaInsights({
        mediaId: 'test-media-id',
      });

      expect(result.totals.plays).toBe(0);
      expect(result.totals.reach).toBe(0);
      expect(result.totals.likes).toBe(0);
    });
  });

  describe('getAccountInsights', () => {
    it('should fetch account insights for a week', async () => {
      // Mock metrics response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'impressions',
                values: [{ value: 1000 }, { value: 1500 }],
              },
              { name: 'reach', values: [{ value: 500 }, { value: 700 }] },
              { name: 'profile_views', values: [{ value: 50 }, { value: 60 }] },
              {
                name: 'website_clicks',
                values: [{ value: 10 }, { value: 15 }],
              },
            ],
          }),
      });

      // Mock follower count response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ followers_count: 5000 }),
      });

      const result = await provider.getAccountInsights('week');

      expect(result.impressions).toBe(2500); // Sum of daily values
      expect(result.reach).toBe(1200);
      expect(result.profileViews).toBe(110);
      expect(result.websiteClicks).toBe(25);
      expect(result.followerCount).toBe(5000);
    });

    it('should throw InstagramInsightsScopeError on permission error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: {
              message: 'Permission denied',
              type: 'OAuthException',
            },
          }),
      });

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ followers_count: 0 }),
      });

      await expect(provider.getAccountInsights('week')).rejects.toThrow(
        InstagramInsightsScopeError,
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
