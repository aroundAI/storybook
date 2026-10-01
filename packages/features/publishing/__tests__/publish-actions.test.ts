import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const SUPABASE = 'https://abcdefghijklmnop.supabase.co';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const CONNECTIONS = {
  twitter: '00000000-0000-4000-8000-0000000000c1',
  tiktok: '00000000-0000-4000-8000-0000000000c2',
  linkedin: '00000000-0000-4000-8000-0000000000c3',
  instagram: '00000000-0000-4000-8000-0000000000c4',
} as const;
const VIDEO = `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;

interface DbState {
  publishRows: Array<Record<string, unknown>>;
  inserted: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
}

const db: DbState = { publishRows: [], inserted: [], updates: [] };

const providers = vi.hoisted(() => ({
  twitterUpload: vi.fn(),
  tiktokUpload: vi.fn(),
  linkedinUpload: vi.fn(),
  recordUploadedFileDuration: vi.fn(),
}));

// FILM-1710: the uploaded file's duration, written with the service role
const adminClient = vi.hoisted(() => ({ service: 'role' }));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => adminClient,
}));

vi.mock('../src/lib/uploaded-file-duration', () => ({
  recordUploadedFileDuration: providers.recordUploadedFileDuration,
}));

function table(name: string) {
  let insertedId = '';
  const query = {
    select: () => query,
    eq: () => query,
    // FILM-1729: the X account holds media.write, as one connected now does
    in: () =>
      Promise.resolve({
        data: [
          {
            id: CONNECTIONS.twitter,
            platform_account_name: 'Acme',
            scopes: ['tweet.read', 'tweet.write', 'media.write', 'users.read'],
          },
        ],
        error: null,
      }),
    order: () => Promise.resolve({ data: db.publishRows, error: null as null }),
    insert: (row: Record<string, unknown>) => {
      db.inserted.push(row);
      insertedId = `publish-${db.inserted.length}`;
      return query;
    },
    update: (patch: Record<string, unknown>) => {
      db.updates.push(patch);
      return query;
    },
    single: () => {
      if (name === 'episodes') {
        return Promise.resolve({
          data: {
            final_video_url: null,
            thumbnail_url: null,
            project_id: 'p',
            project: { account_id: ACCOUNT },
            localized_videos: { en: VIDEO },
            shorts_groups: [],
            public_slug: 'slug',
            title: 'Episode',
            number: 1,
          },
          error: null,
        });
      }
      if (name === 'platform_connections') {
        return Promise.resolve({
          data: {
            platform_account_id: 'acct',
            platform_account_name: 'Acme',
            language: 'en',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { id: insertedId }, error: null });
    },
    maybeSingle: () =>
      Promise.resolve({
        data: name === 'platform_connections' ? { account_id: ACCOUNT } : null,
        error: null,
      }),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  return query;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: (name: string) => table(name) }),
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
    uploadVideo: providers.tiktokUpload,
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
    uploadVideo: providers.twitterUpload,
  })),
}));

// FILM-1729: the X video's header, within every limit X sets
vi.mock('../src/lib/mp4-facts', () => ({
  readMp4Facts: vi.fn(async () => ({
    bytes: 5_000_000,
    durationSeconds: 60,
    width: 1920,
    height: 1080,
  })),
}));

vi.mock('../src/providers/linkedin', () => ({
  LinkedInProvider: vi.fn().mockImplementation(() => ({
    uploadVideo: providers.linkedinUpload,
  })),
}));

describe('Publish Actions', () => {
  describe('getPublishStatusAction polling', () => {
    const row = (
      status: string,
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: 'pub-1',
      platform: 'twitter',
      status,
      platform_content_id: null,
      platform_url: null,
      metadata: null,
      ...extra,
    });

    it('reports each stage as the row moves from queued to published', async () => {
      const { getPublishStatusAction } = await import(
        '../src/server/publish-actions'
      );

      const polls = [
        row('queued'),
        row('publishing'),
        row('published', {
          platform_content_id: 'tw-1',
          platform_url: 'https://x.com/i/web/status/tw-1',
        }),
      ];
      const seen = [];

      for (const publishRow of polls) {
        db.publishRows = [publishRow];
        seen.push(await getPublishStatusAction({ episodeId: EPISODE }));
      }

      expect(seen).toEqual([
        {
          twitter: {
            platform: 'twitter',
            status: 'pending',
            publishId: 'pub-1',
          },
        },
        {
          twitter: {
            platform: 'twitter',
            status: 'publishing',
            publishId: 'pub-1',
          },
        },
        {
          twitter: {
            platform: 'twitter',
            status: 'completed',
            platformContentId: 'tw-1',
            platformUrl: 'https://x.com/i/web/status/tw-1',
            publishId: 'pub-1',
          },
        },
      ]);
    });

    it('carries the recorded error of a failed publish', async () => {
      const { getPublishStatusAction } = await import(
        '../src/server/publish-actions'
      );

      db.publishRows = [row('failed', { metadata: { error: 'quota' } })];

      const result = await getPublishStatusAction({ episodeId: EPISODE });

      expect(result.twitter).toMatchObject({
        status: 'failed',
        error: 'quota',
      });
    });

    it('keeps only the newest row of a platform and one entry per platform', async () => {
      const { getPublishStatusAction } = await import(
        '../src/server/publish-actions'
      );

      db.publishRows = [
        row('scheduled', { id: 'newest' }),
        row('failed', { id: 'older' }),
        row('published', { id: 'tt-1', platform: 'tiktok' }),
      ];

      const result = await getPublishStatusAction({ episodeId: EPISODE });

      expect(Object.keys(result).sort()).toEqual(['tiktok', 'twitter']);
      expect(result.twitter).toMatchObject({
        status: 'scheduled',
        publishId: 'newest',
      });
      expect(result.tiktok).toMatchObject({ status: 'completed' });
    });
  });

  describe('publishToAllAction', () => {
    const input = (
      platform: keyof typeof CONNECTIONS,
      scheduledAt?: string,
    ) => ({
      platform,
      connectionId: CONNECTIONS[platform],
      contentType: 'full' as const,
      title: `${platform} title`,
      description: '',
      tags: [],
      language: 'en',
      platformSpecific: {},
      ...(scheduledAt ? { scheduledAt } : {}),
    });

    beforeEach(() => {
      db.publishRows = [];
      db.inserted = [];
      db.updates = [];
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
      delete process.env.STORAGE_PROVIDER;
      providers.twitterUpload.mockReset().mockResolvedValue({
        tweetId: 'tw-1',
        tweetUrl: 'https://x.com/i/web/status/tw-1',
      });
      providers.tiktokUpload.mockReset().mockResolvedValue({
        publishId: 'tt-1',
        videoUrl: 'https://tiktok.com/v/tt-1',
      });
      providers.linkedinUpload.mockReset().mockResolvedValue({
        postUrn: 'urn:li:share:1',
        postUrl: 'https://linkedin.com/feed/update/1',
      });
      providers.recordUploadedFileDuration
        .mockReset()
        .mockResolvedValue({ recorded: true, seconds: 45 });
    });

    it('records the duration of the file it sent to Instagram, as the service role (FILM-1710)', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      const result = await publishToAllAction({
        episodeId: EPISODE,
        platforms: [input('instagram')],
      });

      expect(result).toMatchObject({
        ok: true,
        data: [{ platform: 'instagram', status: 'completed' }],
      });
      expect(providers.recordUploadedFileDuration).toHaveBeenCalledTimes(1);

      const [serviceClient, publish, videoUrl] =
        providers.recordUploadedFileDuration.mock.calls[0]!;

      expect(publish).toEqual({ id: 'publish-1', platform: 'instagram' });
      expect(videoUrl).toBe(VIDEO);
      expect(serviceClient()).toBe(adminClient);
    });

    it('measures nothing for a scheduled publish: the worker does, when it uploads', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      await publishToAllAction({
        episodeId: EPISODE,
        platforms: [input('instagram', '2030-01-01T10:00:00.000Z')],
      });

      expect(providers.recordUploadedFileDuration).not.toHaveBeenCalled();
    });

    it('a failed measurement does not fail the publish', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      providers.recordUploadedFileDuration.mockResolvedValue({
        recorded: false,
        reason: 'duration_unknown',
      });

      expect(
        await publishToAllAction({
          episodeId: EPISODE,
          platforms: [input('instagram')],
        }),
      ).toMatchObject({
        ok: true,
        data: [{ platform: 'instagram', status: 'completed' }],
      });
    });

    it('publishes an immediate request now and reports where it went', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      const result = await publishToAllAction({
        episodeId: EPISODE,
        platforms: [input('twitter')],
      });

      expect(result).toEqual({
        ok: true,
        data: [
          {
            platform: 'twitter',
            status: 'completed',
            platformContentId: 'tw-1',
            platformUrl: 'https://x.com/i/web/status/tw-1',
            publishId: 'publish-1',
          },
        ],
      });
      expect(db.inserted[0]).toMatchObject({
        status: 'publishing',
        scheduled_at: null,
      });
      expect(db.updates).toContainEqual(
        expect.objectContaining({
          status: 'published',
          platform_content_id: 'tw-1',
          platform_url: 'https://x.com/i/web/status/tw-1',
        }),
      );
    });

    it('stores a scheduled request as scheduled and uploads nothing', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );
      const at = '2030-01-01T10:00:00.000Z';

      const result = await publishToAllAction({
        episodeId: EPISODE,
        platforms: [input('twitter', at)],
      });

      expect(result).toEqual({
        ok: true,
        data: [
          { platform: 'twitter', status: 'scheduled', publishId: 'publish-1' },
        ],
      });
      expect(db.inserted[0]).toMatchObject({
        status: 'scheduled',
        scheduled_at: at,
      });
      expect(providers.twitterUpload).not.toHaveBeenCalled();
    });

    it('takes each platform on its own: one scheduled, one live, one failing', async () => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      providers.linkedinUpload.mockRejectedValue(new Error('LinkedIn is down'));

      const result = await publishToAllAction({
        episodeId: EPISODE,
        platforms: [
          input('twitter', '2030-01-01T10:00:00.000Z'),
          input('tiktok'),
          input('linkedin'),
        ],
      });

      expect(result).toEqual({
        ok: true,
        data: [
          { platform: 'twitter', status: 'scheduled', publishId: 'publish-1' },
          {
            platform: 'tiktok',
            status: 'completed',
            platformContentId: 'tt-1',
            platformUrl: 'https://tiktok.com/v/tt-1',
            publishId: 'publish-2',
          },
          {
            platform: 'linkedin',
            status: 'failed',
            error: 'LinkedIn is down',
          },
        ],
      });
      expect(db.inserted.map((row) => [row.platform, row.status])).toEqual([
        ['twitter', 'scheduled'],
        ['tiktok', 'publishing'],
        ['linkedin', 'publishing'],
      ]);
      expect(providers.twitterUpload).not.toHaveBeenCalled();
      expect(providers.tiktokUpload).toHaveBeenCalledTimes(1);
      expect(db.updates).toContainEqual(
        expect.objectContaining({
          status: 'failed',
          metadata: expect.objectContaining({ error: 'LinkedIn is down' }),
        }),
      );
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
