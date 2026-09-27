import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-30, the server half of "publishing asks rather than defaulting". The
 * publish screen asks before it sends; this is what holds when a request
 * arrives without an answer anyway — a stale tab, or a direct call.
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

const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const STORAGE = 'https://abcdefghijklmnop.supabase.co';
const OWN_VIDEO = `${STORAGE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
vi.stubEnv('STORAGE_PROVIDER', '');

let channel: {
  id: string;
  platform_account_name: string;
  platform_account_id: string;
  youtube_made_for_kids: boolean | null;
  youtube_category_id: string | null;
};
const inserted: Array<Record<string, unknown>> = [];

/** Just enough of PostgREST's builder for the publish handler's reads and writes. */
function table(name: string) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => Promise.resolve({ data: [channel], error: null }),
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
            // An episode's own upload: a publish sends nothing else (KB-123)
            localized_videos: { en: OWN_VIDEO },
            shorts_groups: [],
            public_slug: 'slug',
            title: 'Episode',
            number: 1,
            project: { account_id: ACCOUNT },
          },
          error: null,
        });
      }
      if (name === 'platform_connections') {
        return Promise.resolve({
          data: { ...channel, language: 'en' },
          error: null,
        });
      }
      return Promise.resolve({ data: { id: 'publish-1' }, error: null });
    },
    // KB-109: the channel is the episode's account's
    maybeSingle: () =>
      Promise.resolve({ data: { account_id: ACCOUNT }, error: null }),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  return query;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: (name: string) => table(name) }),
}));

function youtube(platformSpecific: Record<string, unknown>) {
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
        platformSpecific,
      },
    ],
  };
}

describe('publishToAllAction and a YouTube channel nobody has declared', () => {
  beforeEach(() => {
    inserted.length = 0;
    uploadVideo.mockReset();
    uploadVideo.mockResolvedValue({
      videoId: 'v1',
      videoUrl: 'https://youtu.be/v1',
    });
    channel = {
      id: CONNECTION,
      platform_account_name: 'Acme Kids',
      platform_account_id: 'UC-acme',
      youtube_made_for_kids: null,
      youtube_category_id: null,
    };
  });

  it('refuses, naming the channel, and writes no publish row and uploads nothing', async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(youtube({}));

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('“Acme Kids”'),
    });
    expect(inserted).toEqual([]);
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it("snapshots the channel's answer onto the publish row when the request carries none", async () => {
    channel.youtube_made_for_kids = true;
    channel.youtube_category_id = '1';
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(youtube({}));

    expect(result).toMatchObject({ ok: true });
    expect(inserted[0]?.metadata).toMatchObject({
      madeForKids: true,
      categoryId: '1',
    });
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ madeForKids: true, categoryId: '1' }),
    );
  });

  it('sends and snapshots what the request chose', async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    await publishToAllAction(youtube({ madeForKids: false, categoryId: '27' }));

    expect(inserted[0]?.metadata).toMatchObject({
      madeForKids: false,
      categoryId: '27',
    });
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ madeForKids: false, categoryId: '27' }),
    );
  });
});
