import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-104. A publish took its thumbnail from the request (or the stored row)
 * and the upload downloaded it after a check that only looked at the host's
 * suffix, so another tenant's file on the same storage host, or a file on a
 * storage host the caller owns, went to the channel. A thumbnail is now used
 * only when it is one of this episode's own uploads.
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
const BASE = `${SUPABASE}/storage/v1/object/public/project-assets`;
const CONNECTION = '00000000-0000-4000-8000-0000000000c1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EPISODE = '00000000-0000-4000-8000-0000000000e2';

const OWN = `${BASE}/episodes/${EPISODE}/thumbnails/en-1790000000000.png`;
const FOREIGN = {
  "another episode's thumbnail on the same host": `${BASE}/episodes/${OTHER_EPISODE}/thumbnails/en-1.png`,
  'a storage host the caller owns': `https://attacker-owned-project.supabase.co/storage/v1/object/public/project-assets/episodes/${EPISODE}/thumbnails/x.png`,
  'a CloudFront host': `https://d1234abcdef.cloudfront.net/episodes/${EPISODE}/thumbnails/x.png`,
  'an S3 bucket': `https://any-bucket.s3.amazonaws.com/episodes/${EPISODE}/thumbnails/x.png`,
  "this episode's folder climbed out of": `${BASE}/episodes/${EPISODE}/thumbnails/../../${OTHER_EPISODE}/thumbnails/x.png`,
};

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
            localized_videos: { en: 'https://cdn.example.com/en.mp4' },
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
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  return query;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: (name: string) => table(name) }),
}));

function publishWith(thumbnailUrl: string) {
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
        thumbnailUrl,
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

describe('publishToAllAction and the thumbnail it is handed (KB-104)', () => {
  it.each(Object.entries(FOREIGN))(
    'refuses %s, writing no publish row and uploading nothing',
    async (_label, url) => {
      const { publishToAllAction } = await import(
        '../src/server/publish-actions'
      );

      const result = await publishToAllAction(publishWith(url));

      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining('thumbnail'),
      });
      expect(inserted).toEqual([]);
      expect(uploadVideo).not.toHaveBeenCalled();
    },
  );

  it("publishes with the episode's own uploaded thumbnail", async () => {
    const { publishToAllAction } = await import(
      '../src/server/publish-actions'
    );

    const result = await publishToAllAction(publishWith(OWN));

    expect(result).toMatchObject({ ok: true });
    expect(inserted[0]?.thumbnail_url).toBe(OWN);
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailPath: OWN }),
    );
  });
});

describe('every other place a stored thumbnail is used checks it (KB-104)', () => {
  const ROOT = join(__dirname, '../../../..');

  // The row a publish reads its thumbnail from is writable by any project
  // writer through the API, so the action's check alone is not enough.
  const CONSUMERS = [
    'packages/features/publishing/src/server/publish-actions.ts',
    'packages/features/publishing/src/jobs/process-scheduled-publishes.ts',
    'apps/web/lambda/publish-worker/index.ts',
  ];

  // A thumbnail taken straight from a row or a job, without the check
  const UNCHECKED = [
    /thumbnailUrl:\s*publish\.thumbnail_url/,
    /thumbnail_url:\s*platform\.thumbnailUrl\s*\?\?\s*episode\.thumbnail_url/,
    /validateContentUrl\(\s*platform\.thumbnailUrl/,
  ];

  it.each(CONSUMERS)('%s uses ownedEpisodeThumbnail', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');

    expect(source).toMatch(/ownedEpisodeThumbnail\(/);
    for (const pattern of UNCHECKED) {
      expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it('the patterns catch the shape the bug had (positive control)', () => {
    const before = `thumbnailUrl: publish.thumbnail_url ?? episode.thumbnail_url,
      thumbnail_url: platform.thumbnailUrl ?? episode.thumbnail_url,`;

    expect(UNCHECKED[0]!.test(before)).toBe(true);
    expect(UNCHECKED[1]!.test(before)).toBe(true);
  });
});
