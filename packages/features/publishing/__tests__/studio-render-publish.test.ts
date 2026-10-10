import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-2003: a StorybookStudio delivery reaches the platform. deliver_edit
 * makes the primary render the episode's final video and its language's
 * publish target, and the publish page adds a 9:16 render as a Shorts
 * group; Publish Now then uploads exactly those render URLs (the platform
 * is mocked). Render keys live under the project
 * (projects/{project}/episodes/{episode}/renders/), which KB-123's publish
 * rule accepts for the episode's own project.
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

const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const RENDERS = `${BASE}/projects/${PROJECT}/episodes/${EPISODE}/renders`;
const PRIMARY = `${RENDERS}/11111111-2003-4000-8000-000000000001.mp4`;
const VERTICAL = `${RENDERS}/11111111-2003-4000-8000-000000000002.mp4`;
const inserted: Array<Record<string, unknown>> = [];
let localized: Record<string, string> = {};

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
            // what deliver_edit leaves on the episode
            final_video_url: PRIMARY,
            thumbnail_url: null,
            project_id: PROJECT,
            project: { account_id: ACCOUNT },
            localized_videos: localized,
            // what "Add as a Short" on the render picker saves
            shorts_groups: [{ id: 'group-r', videos: { en: VERTICAL } }],
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

function publish(contentType: 'full' | 'short') {
  return {
    episodeId: EPISODE,
    platforms: [
      {
        platform: 'youtube' as const,
        connectionId: CONNECTION,
        contentType,
        ...(contentType === 'short' && { shortsGroupId: 'group-r' }),
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
  localized = { en: PRIMARY };
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

describe('a delivered Studio render reaches the platform', () => {
  it('the primary render is the full video that is uploaded', async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    expect(await publishToAllAction(publish('full'))).toMatchObject({
      ok: true,
    });
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: PRIMARY }),
    );
  });

  // Why deliver_edit fills the primary's language slot: with it empty,
  // Publish Now prefers a group's short over final_video_url (KB-123's
  // precedence), so a full publish would send the vertical render.
  it('without the language slot, a full publish would send the short instead', async () => {
    localized = {};
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    await publishToAllAction(publish('full'));

    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: VERTICAL }),
    );
  });

  it('a 9:16 render added as a Short is the short that is uploaded', async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    await publishToAllAction(publish('short'));

    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoPath: VERTICAL }),
    );
  });
});
