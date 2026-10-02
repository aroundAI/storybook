import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1731. The publish screen's declaration travels with the publish: the
 * row stores it (so the scheduled paths and a retry send what was declared),
 * and the upload made now sends it. Here through YouTube, whose provider
 * turns it into status.containsSyntheticMedia.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (data: unknown, user: unknown) => Promise<unknown>) =>
    (data: unknown) =>
      fn(data, { id: 'user-1' }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: () =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
}));

vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: vi.fn(() => Promise.resolve({ accessToken: 'token' })),
}));

const uploadVideo = vi.fn();

vi.mock('../src/providers/youtube', () => ({
  YouTubeProvider: vi.fn().mockImplementation(() => ({ uploadVideo })),
}));

const SUPABASE = 'https://abcdefghijklmnop.supabase.co';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const inserted: Array<Record<string, unknown>> = [];

function table(name: string) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () =>
      Promise.resolve({
        data: [
          {
            id: CONNECTION,
            platform_account_name: 'Acme',
            youtube_made_for_kids: false,
            youtube_category_id: '22',
          },
        ],
        error: null,
      }),
    update: () => query,
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
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
            localized_videos: {
              en: `${SUPABASE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`,
            },
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
            platform_account_id: 'UC-acme',
            platform_account_name: 'Acme',
            language: 'en',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { id: 'publish-1' }, error: null });
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

function publish(aiGenerated?: boolean) {
  return {
    episodeId: EPISODE,
    platforms: [
      {
        platform: 'youtube' as const,
        connectionId: CONNECTION,
        contentType: 'full' as const,
        title: 'Episode',
        description: '',
        tags: [],
        language: 'en',
        platformSpecific: {},
      },
    ],
    ...(aiGenerated === undefined ? {} : { aiGenerated }),
  };
}

beforeEach(() => {
  inserted.length = 0;
  uploadVideo.mockReset();
  uploadVideo.mockResolvedValue({
    videoId: 'v1',
    videoUrl: 'https://youtu.be/v1',
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  delete process.env.STORAGE_PROVIDER;
});

describe('the AI declaration travels with the publish (FILM-1731)', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])(
    'declared %s: the row stores %s and the upload sends it',
    async (declared, stored) => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      const result = await publishToAllAction(publish(declared));

      expect(result).toMatchObject({ ok: true });
      expect(inserted).toHaveLength(1);
      expect(inserted[0]!.ai_generated).toBe(stored);
      expect(uploadVideo).toHaveBeenCalledWith(
        expect.objectContaining({ containsSyntheticMedia: stored }),
      );
    },
  );
});
