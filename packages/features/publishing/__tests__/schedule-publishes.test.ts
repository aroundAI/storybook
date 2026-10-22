import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleTarget } from '../src/server/schedule-publishes.service';

/**
 * Scheduling over MCP (owner, 2026-10-10): every target is checked before a
 * row is written, as the Publish screen checks it, and a scheduled publish
 * is cancelled only while it is still scheduled, by an owner or admin.
 */

// The channels' posting rules (KB-204): cadence-guard.test.ts's subject;
// here, only that a refusal stops the write
const cadence = vi.hoisted(() => ({ refusal: null as string | null }));
vi.mock('../src/server/cadence-guard.service', () => ({
  cadenceRefusal: async () => cadence.refusal,
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/x-switch', () => ({ X_ENABLED: false }));
// The team's and the project's channels: their own tests' subject
vi.mock('../src/server/connection-account', () => ({
  assertConnectionOfAccount: async () => undefined,
}));
vi.mock('../src/server/project-channels', () => ({
  assertConnectionOfProject: async () => undefined,
}));

// KB-214: what reaches YouTube when a staged upload is cancelled
const youtube = vi.hoisted(() => ({
  deleted: [] as string[],
  refuse: null as string | null,
}));
vi.mock('../src/providers/youtube/youtube-provider', () => ({
  YouTubeProvider: class {
    async deleteVideoIfPresent(videoId: string) {
      if (youtube.refuse) throw new Error(youtube.refuse);
      youtube.deleted.push(videoId);
      return 'deleted';
    }
  },
}));

const getAccessToken = vi.fn();
vi.mock('../src/server/connection-tokens', () => ({
  getAccessToken: (id: string) => getAccessToken(id),
}));

const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const YT = '00000000-0000-4000-8000-0000000000c1';
const IG = '00000000-0000-4000-8000-0000000000c2';
const VIDEO = `https://abcdefghijklmnop.supabase.co/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;
const NOW = new Date('2026-10-10T12:00:00Z');
const LATER = '2026-10-11T12:00:00.000Z';

const inserted: Array<Record<string, unknown>> = [];
/** KB-213: the episode's posts already on its channels */
let earlierPosts: Array<Record<string, unknown>>;
const deleted: string[] = [];
let publishRow: {
  status: string;
  platform?: string;
  platform_connection_id?: string;
  metadata?: unknown;
} | null;
/** The row's status when the delete runs; the scheduled job may have moved it */
let statusAtDelete: string;
let role: string | null;
let episodeThumbnail: string | null;
/** The episode's thumbnails, one per language (KB-210) */
let thumbnailRows: Array<{
  language: string;
  thumbnail_url: string;
  is_default: boolean;
}>;

function query(name: string) {
  let filters: Record<string, unknown> = {};
  let insertRows: Array<Record<string, unknown>> | null = null;
  let deleting = false;

  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      filters = { ...filters, [column]: value };
      return q;
    },
    in: () => {
      if (name === 'platform_connections') {
        return Promise.resolve({
          data: [
            {
              id: YT,
              platform: 'youtube',
              language: 'en',
              platform_account_name: 'Story YT',
              youtube_made_for_kids: false,
              youtube_category_id: '22',
            },
            {
              id: IG,
              platform: 'instagram',
              language: 'en',
              platform_account_name: 'Story IG',
            },
          ],
          error: null,
        });
      }
      return q;
    },
    insert: (rows: Array<Record<string, unknown>>) => {
      insertRows = rows;
      return q;
    },
    delete: () => {
      deleting = true;
      return q;
    },
    single: () =>
      Promise.resolve({
        data: {
          final_video_url: null,
          thumbnail_url: episodeThumbnail,
          project_id: 'p1',
          project: { account_id: 'a1' },
          localized_videos: { en: VIDEO },
          shorts_groups: [
            {
              id: 'yt-cut',
              name: 'YT cut',
              platforms: ['youtube'],
              videos: { en: VIDEO },
            },
            {
              id: 'ig-cut',
              name: 'IG cut',
              platforms: ['instagram'],
              videos: { en: VIDEO },
            },
          ],
          public_slug: null,
          title: 'Pilot',
          number: 1,
        },
        error: null,
      }),
    maybeSingle: () => {
      if (name === 'project_members') {
        return Promise.resolve({ data: role ? { role } : null, error: null });
      }
      return Promise.resolve({
        data: publishRow
          ? {
              id: 'pub-1',
              episode_id: EPISODE,
              platform: 'facebook',
              platform_connection_id: YT,
              metadata: {},
              ...publishRow,
              episodes: { project_id: 'p1' },
            }
          : null,
        error: null,
      });
    },
    then: (resolve: (value: unknown) => void) => {
      if (insertRows) {
        inserted.push(...insertRows);
        return resolve({
          data: insertRows.map((row, index) => ({
            id: `pub-${index + 1}`,
            ...row,
          })),
          error: null,
        });
      }
      if (name === 'episode_thumbnails') {
        return resolve({ data: thumbnailRows, error: null });
      }
      if (name === 'publishes' && filters.platform_connection_id) {
        return resolve({
          data: earlierPosts.filter(
            (post) =>
              post.platform_connection_id === filters.platform_connection_id &&
              post.content_type === filters.content_type,
          ),
          error: null,
        });
      }
      if (deleting) {
        const hit =
          !!publishRow &&
          (filters.status === undefined || filters.status === statusAtDelete);
        if (hit) deleted.push(String(filters.id));
        return resolve({ data: hit ? [{ id: filters.id }] : [], error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return q;
}

const client = { from: (name: string) => query(name) } as never;

function target(overrides: Partial<ScheduleTarget> = {}): ScheduleTarget {
  return {
    connectionId: YT,
    contentType: 'full',
    title: 'Pilot',
    description: '',
    tags: [],
    scheduledAt: LATER,
    platformSpecific: {},
    ...overrides,
  };
}

async function schedule(targets: ScheduleTarget[]) {
  const { schedulePublishes } = await import(
    '../src/server/schedule-publishes.service'
  );
  return schedulePublishes(client, 'user-1', {
    episodeId: EPISODE,
    targets,
    aiGenerated: false,
    now: NOW,
  });
}

beforeEach(() => {
  inserted.length = 0;
  deleted.length = 0;
  publishRow = { status: 'scheduled' };
  statusAtDelete = 'scheduled';
  role = 'owner';
  episodeThumbnail = null;
  thumbnailRows = [];
  earlierPosts = [];
  vi.unstubAllEnvs();
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue({ accessToken: 'token' });
  youtube.deleted.length = 0;
  youtube.refuse = null;
});

describe('scheduling a publish over MCP', () => {
  // KB-213: the same Short went to one Facebook Page twice
  it('schedules nothing that is already posted to the same channel, and allows another channel', async () => {
    earlierPosts = [
      {
        id: 'posted',
        status: 'published',
        platform_connection_id: YT,
        content_type: 'short',
        title: 'Would you send her through?',
        language: 'en',
        platform_url: 'https://youtube.com/shorts/abc',
        published_at: '2026-10-09T21:04:00Z',
        created_at: '2026-10-09T21:00:00Z',
        metadata: { shortsGroupId: 'yt-cut' },
      },
    ];

    const refused = await schedule([
      target({ contentType: 'short', shortsGroupId: 'yt-cut' }),
    ]);

    expect(refused).toEqual({
      ok: false,
      refusal: expect.stringMatching(
        /^Already posted to this account as https:\/\/youtube\.com\/shorts\/abc on 2026-10-09; not posted again/,
      ),
    });
    expect(inserted).toEqual([]);

    const elsewhere = await schedule([
      target({
        connectionId: IG,
        contentType: 'short',
        shortsGroupId: 'ig-cut',
      }),
    ]);

    expect(elsewhere.ok).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it('schedules nothing past the channel’s posting rules (KB-204)', async () => {
    cadence.refusal = 'Story YT has a long video on 2026-10-10.';

    try {
      const result = await schedule([target()]);

      expect(result).toEqual({
        ok: false,
        refusal: 'Story YT has a long video on 2026-10-10.',
      });
      expect(inserted).toEqual([]);
    } finally {
      cadence.refusal = null;
    }
  });

  it('gives the long video the episode thumbnail and a Short none (KB-197)', async () => {
    // The ownership check (KB-104) reads the storage host from the env
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://abcdefghijklmnop.supabase.co',
    );
    vi.stubEnv('STORAGE_PROVIDER', '');
    episodeThumbnail = `https://abcdefghijklmnop.supabase.co/storage/v1/object/public/project-assets/episodes/${EPISODE}/thumbnails/en-1.png`;

    const result = await schedule([
      target(),
      target({ contentType: 'short', shortsGroupId: 'yt-cut' }),
      target({
        connectionId: IG,
        contentType: 'short',
        shortsGroupId: 'ig-cut',
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(
      inserted.map((row) => [row.content_type, row.thumbnail_url]),
    ).toEqual([
      ['full', episodeThumbnail],
      ['short', null],
      ['short', null],
    ]);
  });

  it('gives a long video with no thumbnail the episode’s, in its language, and a Short none (KB-210)', async () => {
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://abcdefghijklmnop.supabase.co',
    );
    vi.stubEnv('STORAGE_PROVIDER', '');
    const own = (file: string) =>
      `https://abcdefghijklmnop.supabase.co/storage/v1/object/public/project-assets/episodes/${EPISODE}/thumbnails/${file}`;
    // As MCP finalize_episode_thumbnail saves them: the episode row has none
    thumbnailRows = [
      { language: 'hi', thumbnail_url: own('hi-1.png'), is_default: true },
      { language: 'en', thumbnail_url: own('en-1.png'), is_default: false },
    ];

    const result = await schedule([
      target(),
      target({ contentType: 'short', shortsGroupId: 'yt-cut' }),
    ]);

    expect(result.ok).toBe(true);
    expect(
      inserted.map((row) => [row.content_type, row.thumbnail_url]),
    ).toEqual([
      ['full', own('en-1.png')],
      ['short', null],
    ]);

    // None in the video's language: the default
    inserted.length = 0;
    thumbnailRows = [thumbnailRows[0]!];

    await schedule([target()]);

    expect(inserted[0]!.thumbnail_url).toBe(own('hi-1.png'));
  });

  it('stores no thumbnail that is not one of the episode’s own (KB-104, KB-210)', async () => {
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://abcdefghijklmnop.supabase.co',
    );
    vi.stubEnv('STORAGE_PROVIDER', '');
    thumbnailRows = [
      {
        language: 'en',
        thumbnail_url:
          'https://abcdefghijklmnop.supabase.co/storage/v1/object/public/project-assets/episodes/another/thumbnails/en-1.png',
        is_default: true,
      },
    ];

    const result = await schedule([target()]);

    expect(result.ok).toBe(true);
    expect(inserted[0]!.thumbnail_url).toBeNull();
  });

  it('writes one scheduled row per target, on the channel’s own platform', async () => {
    const result = await schedule([
      target(),
      target({
        connectionId: IG,
        contentType: 'short',
        shortsGroupId: 'ig-cut',
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(inserted).toEqual([
      expect.objectContaining({
        platform: 'youtube',
        content_type: 'full',
        status: 'scheduled',
        scheduled_at: LATER,
        language: 'en',
        metadata: expect.objectContaining({
          createdVia: 'mcp',
          createdBy: 'user-1',
          madeForKids: false,
        }),
      }),
      expect.objectContaining({
        platform: 'instagram',
        content_type: 'short',
        status: 'scheduled',
        metadata: expect.objectContaining({ shortsGroupId: 'ig-cut' }),
      }),
    ]);
  });

  it.each([
    [
      'a time that has passed',
      [target({ scheduledAt: '2026-10-10T11:59:00.000Z' })],
      'must be in the future',
    ],
    [
      'a Shorts group sent to a platform it does not go to',
      [target(), target({ contentType: 'short', shortsGroupId: 'ig-cut' })],
      'The Shorts group "IG cut" isn\'t set to go to YouTube.',
    ],
    [
      'a short with no group',
      [target({ connectionId: IG, contentType: 'short' })],
      'A short names its Shorts group',
    ],
    [
      'a language the episode has no video in',
      [target({ language: 'hi' })],
      'This episode has no hi video',
    ],
  ])('refuses %s, and writes nothing', async (_, targets, refusal) => {
    const result = await schedule(targets);

    expect(result).toEqual({
      ok: false,
      refusal: expect.stringContaining(refusal),
    });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a channel that can no longer be published to, and writes nothing', async () => {
    getAccessToken.mockResolvedValue({ error: 'CONNECTION_INACTIVE' });

    const result = await schedule([target()]);

    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});

describe('cancelling a scheduled publish', () => {
  async function cancel() {
    const { cancelScheduledPublish } = await import(
      '../src/server/schedule-publishes.service'
    );
    return cancelScheduledPublish(client, 'user-1', 'pub-1');
  }

  it('deletes it while it is still scheduled', async () => {
    expect(await cancel()).toEqual({
      ok: true,
      data: { publishId: 'pub-1', episodeId: EPISODE },
    });
    expect(deleted).toEqual(['pub-1']);
  });

  it('refuses one that has started or gone out', async () => {
    publishRow = { status: 'published' };

    expect(await cancel()).toEqual({
      ok: false,
      refusal: expect.stringContaining('published, not scheduled'),
    });
    expect(deleted).toHaveLength(0);
  });

  // KB-214: a YouTube post uploaded ahead of its time is a private video
  // on the channel; cancelling only the row would have left it there
  const staged = {
    status: 'scheduled',
    platform: 'youtube',
    metadata: {
      youtube: {
        videoId: 'yt-staged',
        stagedAt: '2026-10-10T10:00:00Z',
        publishAt: '2026-10-10T12:00:00Z',
        delays: [],
      },
    },
  };

  it('deletes a staged YouTube upload on YouTube, then the post', async () => {
    publishRow = staged;

    expect((await cancel()).ok).toBe(true);
    expect(youtube.deleted).toEqual(['yt-staged']);
    expect(deleted).toEqual(['pub-1']);
  });

  it('keeps the post and says why when YouTube refuses the delete', async () => {
    publishRow = staged;
    youtube.refuse = 'YouTube refused to delete the video: forbidden';

    expect(await cancel()).toEqual({
      ok: false,
      refusal: 'YouTube refused to delete the video: forbidden',
    });
    expect(deleted).toHaveLength(0);
  });

  it('touches YouTube for no post that was not staged', async () => {
    publishRow = { status: 'scheduled', platform: 'youtube', metadata: {} };

    expect((await cancel()).ok).toBe(true);
    expect(youtube.deleted).toEqual([]);
  });

  it('refuses one the scheduled job claimed after it was read, and deletes nothing', async () => {
    statusAtDelete = 'queued';

    expect(await cancel()).toEqual({
      ok: false,
      refusal:
        'That publish started just now, so it can no longer be cancelled.',
    });
    expect(deleted).toHaveLength(0);
  });

  it('refuses a project member who is not an owner or admin', async () => {
    role = 'member';

    expect(await cancel()).toEqual({
      ok: false,
      refusal: 'Only project owners and admins can cancel a scheduled publish.',
    });
    expect(deleted).toHaveLength(0);
  });
});
