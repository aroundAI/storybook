import { describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import { createEpisodeVideoTools } from '../../src/server/tools/author/episode-production';
import {
  deleteShortsGroupTool,
  upsertShortsGroupTool,
} from '../../src/server/tools/publish/shorts';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * Shorts groups over MCP (FILM-2207): each platform's cut is a group with
 * its platforms and one video per language, edited through the Publish
 * screen's saveShortsGroups on the version read, so an edit made in
 * between is never overwritten.
 */

vi.stubEnv('STORAGE_PROVIDER', 'r2');
vi.stubEnv(
  'R2_PUBLIC_URL',
  'https://pub-0123456789abcdef0123456789abcdef.r2.dev',
);

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const HELD = `https://pub-0123456789abcdef0123456789abcdef.r2.dev/project-assets/episodes/${EPISODE}/videos/en-1.mp4`;

const YT_CUT = {
  id: 'group-1',
  name: 'YT cut',
  title: 'Pilot #shorts',
  description: 'kept',
  tags: ['kept'],
  videos: { en: HELD },
  platforms: ['youtube'],
};

/** The episode as every read sees it; an update lands unless `moved` */
function episode(options: { moved?: boolean; scheduled?: number } = {}) {
  return createFakeClient({
    episodes: (c: RecordedCall) =>
      c.op === 'update'
        ? { data: options.moved ? [] : [{ id: EPISODE, version: 6 }] }
        : {
            data: {
              id: EPISODE,
              project_id: PROJECT,
              final_video_url: null,
              localized_videos: { en: HELD },
              shorts_groups: [YT_CUT],
              version: 5,
              project: { id: PROJECT, account_id: ACCOUNT },
            },
          },
    publishes: () => ({ count: options.scheduled ?? 0 }),
  });
}

const run = (
  tool: unknown,
  input: Record<string, unknown>,
  fake: ReturnType<typeof createFakeClient>,
) =>
  (tool as McpToolDefinition).handler(
    { episodeId: EPISODE, ...input } as never,
    fakeContext(fake.client) as never,
  ) as Promise<{ structuredContent: Record<string, unknown> }>;

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof McpToolError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const savedGroups = (fake: ReturnType<typeof createFakeClient>) =>
  (
    fake.calls.find((c) => c.table === 'episodes' && c.op === 'update')
      ?.payload as { shorts_groups?: unknown } | undefined
  )?.shorts_groups;

describe('upsert_shorts_group', () => {
  it('creates a cut with its platforms, on the version read', async () => {
    const fake = episode();

    const result = await run(
      upsertShortsGroupTool,
      { name: 'IG/FB cut', platforms: ['instagram', 'facebook'] },
      fake,
    );

    expect(savedGroups(fake)).toEqual([
      YT_CUT,
      expect.objectContaining({
        name: 'IG/FB cut',
        platforms: ['instagram', 'facebook'],
        videos: {},
      }),
    ]);
    const update = fake.calls.find((c) => c.op === 'update')!;
    expect(update.filters).toContainEqual({
      method: 'eq',
      args: ['version', 5],
    });
    expect(result.structuredContent.shortsGroup).toMatchObject({
      name: 'IG/FB cut',
      languages: [],
    });
  });

  it('changes only the fields it is given', async () => {
    const fake = episode();

    await run(
      upsertShortsGroupTool,
      { shortsGroupId: 'group-1', platforms: ['youtube', 'facebook'] },
      fake,
    );

    expect(savedGroups(fake)).toEqual([
      { ...YT_CUT, platforms: ['youtube', 'facebook'] },
    ]);
  });

  it('refuses a group the episode does not have, writing nothing', async () => {
    const fake = episode();

    const error = await rejection(
      run(upsertShortsGroupTool, { shortsGroupId: 'group-9', name: 'x' }, fake),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(savedGroups(fake)).toBeUndefined();
  });

  it('a new group needs a name', async () => {
    const fake = episode();

    const error = await rejection(
      run(upsertShortsGroupTool, { platforms: ['youtube'] }, fake),
    );

    expect(error.message).toBe('A new Shorts group needs a name.');
    expect(savedGroups(fake)).toBeUndefined();
  });

  it('an episode that changed since it was read is TARGET_CHANGED, not overwritten', async () => {
    const error = await rejection(
      run(
        upsertShortsGroupTool,
        { shortsGroupId: 'group-1', name: 'Renamed' },
        episode({ moved: true }),
      ),
    );

    expect(error.code).toBe('TARGET_CHANGED');
  });
});

describe('delete_shorts_group', () => {
  it('refuses while a scheduled publish uses the group, writing nothing', async () => {
    const fake = episode({ scheduled: 1 });

    const error = await rejection(
      run(deleteShortsGroupTool, { shortsGroupId: 'group-1' }, fake),
    );

    expect(error.message).toContain('cancel_scheduled_publish');
    expect(savedGroups(fake)).toBeUndefined();
  });

  it('removes a group nothing is scheduled from', async () => {
    const fake = episode();

    await run(deleteShortsGroupTool, { shortsGroupId: 'group-1' }, fake);

    expect(savedGroups(fake)).toEqual([]);
  });
});

describe('finalize_episode_video with a Shorts group', () => {
  const key = `episodes/${EPISODE}/videos/hi-1700000000000.mp4`;
  const adapter = {
    stat: async () => ({ bytes: 2048 }),
    getPublicUrl: (_bucket: string, path: string) =>
      `https://pub-0123456789abcdef0123456789abcdef.r2.dev/project-assets/${path}`,
  } as unknown as StorageAdapter;
  const finalize = createEpisodeVideoTools({
    storage: () => adapter,
    now: () => 1700000000000,
  })[1]!;

  it('makes it the group’s short in that language, and leaves the episode video alone', async () => {
    const fake = episode();

    await run(
      finalize,
      { language: 'hi', key, shortsGroupId: 'group-1' },
      fake,
    );

    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({
      shorts_groups: [
        {
          ...YT_CUT,
          videos: {
            en: HELD,
            hi: `https://pub-0123456789abcdef0123456789abcdef.r2.dev/project-assets/${key}`,
          },
        },
      ],
    });
  });

  it('refuses a group the episode does not have, writing nothing', async () => {
    const fake = episode();

    const error = await rejection(
      run(finalize, { language: 'hi', key, shortsGroupId: 'group-9' }, fake),
    );

    expect(error.message).toContain('upsert_shorts_group');
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false);
  });
});
