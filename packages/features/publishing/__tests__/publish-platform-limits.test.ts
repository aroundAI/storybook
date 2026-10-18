import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';

import { platformVideoRefusal } from '../src/lib/platform-video-limits';
import { preparePublish } from '../src/server/publish-preflight';

/**
 * FILM-2212. StoryBook takes uploads up to 4.99 GB; Facebook takes 1 GB by
 * URL and Instagram 300 MB for a Reel. A video over a platform's limit is
 * refused when the publish is prepared — scheduled or published now —
 * naming the platform and the way out, never found by the worker later.
 */

vi.mock('server-only', () => ({}));
vi.mock('../src/server/connection-account', () => ({
  assertConnectionOfAccount: async () => undefined,
}));
vi.mock('../src/server/project-channels', () => ({
  assertConnectionOfProject: async () => undefined,
}));

const facts = vi.hoisted(() => ({
  byUrl: {} as Record<
    string,
    { bytes: number | null; durationSeconds: number | null }
  >,
}));

vi.mock('../src/lib/mp4-facts', () => ({
  readMp4Facts: vi.fn(async (url: string) => ({
    width: 1080,
    height: 1920,
    ...facts.byUrl[url],
  })),
}));

const EPISODE = '00000000-0000-4000-8000-0000000000e2';
const STORAGE = 'https://abcdefghijklmnop.supabase.co';
const folder = `${STORAGE}/storage/v1/object/public/project-assets/episodes/${EPISODE}/videos`;
const LONG = `${folder}/en-1.mp4`;
const SHORT = `${folder}/en-short-1.mp4`;

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
vi.stubEnv('STORAGE_PROVIDER', '');

const client = {
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: async () => ({
        data: [
          { id: 'fb', language: 'en' },
          { id: 'ig', language: 'en' },
          { id: 'yt', language: 'en' },
        ],
        error: null,
      }),
      single: async () =>
        table === 'episodes'
          ? {
              data: {
                final_video_url: null,
                thumbnail_url: null,
                project_id: 'p',
                localized_videos: { en: LONG },
                shorts_groups: [
                  {
                    id: 'g1',
                    name: 'IG/FB cut',
                    platforms: ['instagram', 'facebook'],
                    videos: { en: SHORT },
                  },
                ],
                public_slug: 'slug',
                title: 'Episode',
                number: 1,
                project: { account_id: 'a' },
              },
              error: null,
            }
          : { data: null, error: { message: 'unexpected' } },
      maybeSingle: async () => ({ data: { project_id: 'p' }, error: null }),
    };
    return query;
  },
};

const target = (
  platform: 'facebook' | 'instagram' | 'youtube',
  contentType: 'full' | 'short',
) => ({
  platform,
  connectionId: platform === 'facebook' ? 'fb' : platform.slice(0, 2),
  contentType,
  ...(contentType === 'short' && { shortsGroupId: 'g1' }),
  title: 'Episode',
  description: '',
  tags: [],
  language: 'en',
  platformSpecific:
    platform === 'youtube' ? { madeForKids: false, categoryId: '22' } : {},
});

const prepare = (targets: ReturnType<typeof target>[]) =>
  preparePublish(client as never, EPISODE, targets as never);

describe('a video over a platform’s limit is refused when the publish is prepared (FILM-2212)', () => {
  beforeEach(() => {
    facts.byUrl = {
      [LONG]: { bytes: 2_500_000_000, durationSeconds: 15 * 60 },
      [SHORT]: { bytes: 40_000_000, durationSeconds: 50 },
    };
  });

  it('refuses a 2.5 GB long video to Facebook, naming its 1 GB limit', async () => {
    await expect(prepare([target('facebook', 'full')])).rejects.toEqual(
      new ActionRefusal(
        "Facebook can't take this video: it is 2.5 GB, and Facebook takes at most 1 GB. Upload a smaller file for Facebook, or leave Facebook out.",
      ),
    );
  });

  it('lets the same 2.5 GB video go to YouTube', async () => {
    await expect(prepare([target('youtube', 'full')])).resolves.toBeTruthy();
  });

  it('refuses a 400 MB Short to Instagram and lets a 40 MB one through', async () => {
    await expect(
      prepare([target('instagram', 'short'), target('facebook', 'short')]),
    ).resolves.toBeTruthy();

    facts.byUrl[SHORT] = { bytes: 400_000_000, durationSeconds: 50 };

    await expect(prepare([target('instagram', 'short')])).rejects.toThrow(
      "Instagram can't take this video: it is 400 MB, and Instagram takes at most 300 MB.",
    );
  });

  it('refuses a long video Facebook would refuse for its length', async () => {
    facts.byUrl[LONG] = { bytes: 900_000_000, durationSeconds: 21 * 60 };

    await expect(prepare([target('facebook', 'full')])).rejects.toThrow(
      'it is 21 minutes long, and Facebook takes at most 20 minutes',
    );
  });

  it('leaves to the upload a file whose size and length it cannot read', async () => {
    facts.byUrl[LONG] = { bytes: null, durationSeconds: null };

    await expect(prepare([target('facebook', 'full')])).resolves.toBeTruthy();
  });
});

describe('platformVideoRefusal', () => {
  it('takes exactly the limit and refuses a byte over', () => {
    expect(
      platformVideoRefusal('instagram', {
        bytes: 300_000_000,
        durationSeconds: 60,
      }),
    ).toBeNull();
    expect(
      platformVideoRefusal('instagram', {
        bytes: 300_000_001,
        durationSeconds: 60,
      }),
    ).toMatch(/^Instagram can't take this video/);
  });

  it('refuses a Reel under 3 seconds', () => {
    expect(
      platformVideoRefusal('instagram', { bytes: 1_000, durationSeconds: 2 }),
    ).toContain('needs at least 3 seconds');
  });
});
