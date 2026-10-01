import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1729 §4.3. An X connection made before media.write was requested
 * cannot upload video, and refresh cannot add the scope. The publish is
 * refused before anything is written or uploaded, as a value (thrown text
 * is redacted in production builds), naming the account and the way out:
 * connect X again.
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

vi.mock('../src/providers/twitter', () => ({
  TwitterProvider: vi.fn().mockImplementation(() => ({ uploadVideo })),
}));

const CONNECTION = '00000000-0000-4000-8000-0000000000c2';
const EPISODE = '00000000-0000-4000-8000-0000000000e2';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a2';
const STORAGE = 'https://abcdefghijklmnop.supabase.co';
const OWN_VIDEO = `${STORAGE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
vi.stubEnv('STORAGE_PROVIDER', '');

const POSTING = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

let connection: {
  id: string;
  platform: string;
  platform_account_name: string;
  platform_account_id: string;
  scopes: string[] | null;
};
const inserted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

function table(name: string) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => Promise.resolve({ data: [connection], error: null }),
    update: (row: Record<string, unknown>) => {
      updated.push(row);
      return query;
    },
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
          data: { ...connection, language: 'en' },
          error: null,
        });
      }
      if (name === 'publishes') {
        return Promise.resolve({
          data: {
            id: 'publish-1',
            episode_id: EPISODE,
            platform_connection_id: CONNECTION,
            platform: 'twitter',
            content_type: 'full',
            status: 'failed',
            language: 'en',
            metadata: {},
            episodes: {
              final_video_url: OWN_VIDEO,
              thumbnail_url: null,
              project_id: 'p',
              project: { account_id: ACCOUNT },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { id: 'publish-1' }, error: null });
    },
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

const publishToX = {
  episodeId: EPISODE,
  platforms: [
    {
      platform: 'twitter' as const,
      connectionId: CONNECTION,
      contentType: 'full' as const,
      title: 'Episode',
      description: '',
      tags: [],
      language: 'en',
      platformSpecific: {},
    },
  ],
};

describe('publishing to an X connection without media.write (FILM-1729)', () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
    uploadVideo.mockReset();
    uploadVideo.mockResolvedValue({
      tweetId: 't1',
      tweetUrl: 'https://x.com/i/web/status/t1',
    });
    connection = {
      id: CONNECTION,
      platform: 'twitter',
      platform_account_name: 'acme_on_x',
      platform_account_id: 'x-1',
      scopes: POSTING,
    };
  });

  it('is refused as a value naming the account and the reconnect, before anything is written', async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(publishToX);

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('@acme_on_x'),
    });
    expect(result.ok === false && result.error).toContain('media.write');
    expect(result.ok === false && result.error).toContain(
      'disconnect X and connect it again',
    );
    expect(inserted).toEqual([]);
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it('is refused the same way when the connection recorded no scopes at all', async () => {
    connection.scopes = null;
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(publishToX);

    expect(result.ok).toBe(false);
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it('goes ahead once the connection holds media.write', async () => {
    connection.scopes = [...POSTING, 'media.write'];
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(publishToX);

    expect(result.ok).toBe(true);
    expect(uploadVideo).toHaveBeenCalledTimes(1);
  });

  it('refuses a retry the same way, before the row is marked publishing', async () => {
    const { retryPublishAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await retryPublishAction({ publishId: 'publish-1' });

    expect(result.ok === false && result.error).toContain('media.write');
    expect(updated).toEqual([]);
    expect(uploadVideo).not.toHaveBeenCalled();
  });
});
