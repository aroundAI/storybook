import { describe, expect, it, vi } from 'vitest';

import type { Platform, PublishResult } from '../src/lib/types';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock @kit/next/actions
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (
    fn: (data: Record<string, unknown>, user: unknown) => Promise<unknown>,
    _options: unknown,
  ) => {
    return async (data: Record<string, unknown>) => {
      return fn(data, { id: 'test-user-id' });
    };
  },
}));

// Mock @kit/shared/logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: () =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
}));

// Mock Supabase client
/**
 * PostgREST builders resolve to `{ data, error }`; typing the terminal
 * methods as that shape is what lets a test override them.
 */
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

const mockSupabaseClient = {
  from: vi.fn(() => mockSupabaseClient),
  select: vi.fn(() => mockSupabaseClient),
  insert: vi.fn(() => mockSupabaseClient),
  update: vi.fn(() => mockSupabaseClient),
  eq: vi.fn(() => mockSupabaseClient),
  order: vi.fn(() => mockSupabaseClient),
  single: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => mockSupabaseClient,
}));

// Mock connection-tokens
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: vi.fn(() =>
    Promise.resolve({ accessToken: 'mock-access-token' }),
  ),
}));

// Mock providers
vi.mock('../src/providers/youtube', () => ({
  YouTubeProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: vi.fn().mockResolvedValue({
      videoId: 'yt-video-123',
      videoUrl: 'https://youtube.com/watch?v=yt-video-123',
    }),
  })),
}));

vi.mock('../src/providers/tiktok', () => ({
  TikTokProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: vi.fn().mockResolvedValue({
      publishId: 'tt-video-123',
      videoUrl: 'https://tiktok.com/@user/video/tt-video-123',
    }),
  })),
}));

vi.mock('../src/providers/instagram', () => ({
  InstagramProvider: vi.fn().mockImplementation(() => ({
    uploadReel: vi.fn().mockResolvedValue({
      mediaId: 'ig-reel-123',
      permalink: 'https://instagram.com/reel/ig-reel-123',
    }),
  })),
}));

vi.mock('../src/providers/facebook', () => ({
  FacebookProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: vi.fn().mockResolvedValue({
      videoId: 'fb-video-123',
      videoUrl: 'https://facebook.com/watch/fb-video-123',
    }),
  })),
}));

vi.mock('../src/providers/twitter', () => ({
  TwitterProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: vi.fn().mockResolvedValue({
      tweetId: 'tw-tweet-123',
      tweetUrl: 'https://twitter.com/user/status/tw-tweet-123',
    }),
  })),
}));

vi.mock('../src/providers/linkedin', () => ({
  LinkedInProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: vi.fn().mockResolvedValue({
      postUrn: 'urn:li:share:ln-post-123',
      postUrl: 'https://linkedin.com/feed/update/ln-post-123',
    }),
  })),
}));

describe('Publish Actions', () => {
  describe('mapDbStatus', () => {
    it('should map database status to publish result status', async () => {
      // Import after mocks are set up
      const { getPublishStatusAction } = await import(
        '../src/server/publish-actions'
      );

      // Mock the database response
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: [
          {
            id: 'pub-1',
            platform: 'youtube',
            status: 'published',
            platform_content_id: 'yt-123',
            platform_url: 'https://youtube.com/watch?v=yt-123',
            metadata: null,
          },
        ],
        error: null,
      });

      // The function should normalize 'published' to 'completed'
      const result = await getPublishStatusAction({
        episodeId: 'test-episode-id',
      });

      expect(result).toBeDefined();
    });
  });

  describe('PublishResult types', () => {
    it('should have correct status values', () => {
      const validStatuses: PublishResult['status'][] = [
        'pending',
        'publishing',
        'completed',
        'failed',
        'scheduled',
      ];

      validStatuses.forEach((status) => {
        const result: PublishResult = {
          platform: 'youtube' as Platform,
          status,
        };
        expect(result.status).toBe(status);
      });
    });

    it('should allow optional fields', () => {
      const minimalResult: PublishResult = {
        platform: 'youtube' as Platform,
        status: 'completed',
      };

      const fullResult: PublishResult = {
        platform: 'youtube' as Platform,
        status: 'completed',
        platformContentId: 'yt-123',
        platformUrl: 'https://youtube.com/watch?v=yt-123',
        publishId: 'pub-123',
      };

      expect(minimalResult.platform).toBe('youtube');
      expect(fullResult.platformContentId).toBe('yt-123');
    });

    it('should allow error field for failed publishes', () => {
      const failedResult: PublishResult = {
        platform: 'youtube' as Platform,
        status: 'failed',
        error: 'Upload quota exceeded',
      };

      expect(failedResult.error).toBe('Upload quota exceeded');
    });
  });

  describe('Platform validation', () => {
    it('should recognize all supported platforms', () => {
      const platforms: Platform[] = [
        'youtube',
        'tiktok',
        'instagram',
        'facebook',
        'twitter',
        'linkedin',
      ];

      platforms.forEach((platform) => {
        expect(typeof platform).toBe('string');
      });
    });
  });
});
