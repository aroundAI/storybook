import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-133. Publish Now sends each Shorts group of a language as its own
 * publish, naming the group, but uploaded the first group holding that
 * language every time: with two groups in one language, one short went out
 * twice and the other never. The scheduled paths already used the group
 * named; publish-now now does too.
 */

// Every channel is the project's here; that check is
// publish-queue-authorization.test.ts's subject
vi.mock('../src/server/project-channels', () => ({
  assertConnectionOfProject: async () => undefined,
}));
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
const BASE = `${SUPABASE}/storage/v1/object/public/project-assets`;
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';

const GROUP_A = `${BASE}/episodes/${EPISODE}/videos/en-short-a.mp4`;
const GROUP_B = `${BASE}/episodes/${EPISODE}/videos/en-short-b.mp4`;
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
            platform_account_id: 'UC-acme',
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
            // An episode's own upload: a publish sends nothing else (KB-123)
            localized_videos: {
              en: `${BASE}/episodes/${EPISODE}/videos/en-1.mp4`,
            },
            shorts_groups: [
              { id: 'group-a', videos: { en: GROUP_A } },
              { id: 'group-b', videos: { en: GROUP_B } },
            ],
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
    // KB-109: the channel belongs to the episode's account
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

function publishShort(shortsGroupId: string) {
  return {
    episodeId: EPISODE,
    platforms: [
      {
        platform: 'youtube' as const,
        connectionId: CONNECTION,
        contentType: 'short' as const,
        shortsGroupId,
        title: 'Episode',
        description: '',
        tags: [],
        language: 'en',
        platformSpecific: {},
      },
    ],
  };
}

const savedEnv = { ...process.env };

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

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('Publish Now sends the Shorts group it names (KB-133)', () => {
  it.each([
    ['group-a', GROUP_A],
    ['group-b', GROUP_B],
  ])('%s: its own short is uploaded', async (groupId, video) => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(publishShort(groupId));

    expect(result).toMatchObject({ ok: true });
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: video }),
    );
  });
});
