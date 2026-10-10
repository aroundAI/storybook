import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  updatePublishedVideoAction,
  updateShortsGroupsAction,
} from '../src/lib/server/mutations/publish-actions';

/**
 * KB-123, save time. `updatePublishedVideoAction` stored any string, so an
 * episode's video could name another episode's upload — reproduced with the
 * real action on 2026-09-25. Now a new or changed video must be this
 * episode's own upload, a value the episode already holds is kept, and a
 * refusal comes back as a value with nothing written.
 */

const E = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const R2 = 'https://pub-0123456789abcdef0123456789abcdef.r2.dev';

const own = `${R2}/project-assets/episodes/${E}/videos/en-1.mp4`;
const foreign = `${R2}/project-assets/episodes/${OTHER}/videos/en-1.mp4`;
const legacy = `${R2}/project-assets/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/shots/s/a.mp4`;

const state: {
  stored: Record<string, unknown>;
  updates: unknown[];
} = { stored: {}, updates: [] };

vi.stubEnv('STORAGE_PROVIDER', 'r2');
vi.stubEnv('R2_PUBLIC_URL', R2);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/prompt-engine/llm-job-target', () => ({
  noTenantLlmJobTarget: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        single: async () => ({ data: state.stored, error: null }),
        maybeSingle: async () => ({ data: state.stored, error: null }),
        update: (payload: unknown) => {
          state.updates.push(payload);
          return {
            eq: () => ({
              select: async () => ({ data: [{ id: E }], error: null }),
            }),
          };
        },
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  state.stored = { status: 'draft' };
  state.updates = [];
});

describe('updatePublishedVideoAction', () => {
  it("stores this episode's own upload", async () => {
    const result = await updatePublishedVideoAction({
      episodeId: E,
      language: 'en',
      videoUrl: own,
    });

    expect(result).toEqual({ ok: true, data: { success: true } });
    // FILM-2202: an episode with a video is ready to publish, whatever its stages
    expect(state.updates).toEqual([
      { localized_videos: { en: own }, status: 'ready' },
    ]);
  });

  it('leaves a published episode published', async () => {
    state.stored = { status: 'published' };

    await updatePublishedVideoAction({
      episodeId: E,
      language: 'en',
      videoUrl: own,
    });

    expect(state.updates).toEqual([
      { localized_videos: { en: own }, status: 'published' },
    ]);
  });

  it("refuses another episode's video and writes nothing (the KB-123 reproduction)", async () => {
    const result = await updatePublishedVideoAction({
      episodeId: E,
      language: 'en',
      videoUrl: foreign,
    });

    expect(result.ok).toBe(false);
    expect(state.updates).toEqual([]);
  });

  it('keeps a video the episode already holds, and still removes one', async () => {
    state.stored = {
      status: 'editing',
      localized_videos: { hi: legacy, en: own },
    };

    expect(
      (
        await updatePublishedVideoAction({
          episodeId: E,
          language: 'es',
          videoUrl: legacy,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await updatePublishedVideoAction({
          episodeId: E,
          language: 'en',
          videoUrl: '',
        })
      ).ok,
    ).toBe(true);
    // A removal leaves the status as it was
    expect(state.updates).toEqual([
      {
        localized_videos: { hi: legacy, en: own, es: legacy },
        status: 'ready',
      },
      { localized_videos: { hi: legacy }, status: 'editing' },
    ]);
  });
});

describe('updateShortsGroupsAction', () => {
  const group = (videos: Record<string, string>) => ({
    id: 'g1',
    name: 'Group',
    title: 't',
    description: 'd',
    tags: [],
    videos,
  });

  it('saves a group edit that keeps its legacy video', async () => {
    state.stored = { shorts_groups: [group({ en: legacy })] };

    const result = await updateShortsGroupsAction({
      episodeId: E,
      shortsGroups: [{ ...group({ en: legacy }), title: 'renamed' }],
    });

    expect(result.ok).toBe(true);
    expect(state.updates).toHaveLength(1);
  });

  it("refuses a group naming another episode's video, and writes nothing", async () => {
    const result = await updateShortsGroupsAction({
      episodeId: E,
      shortsGroups: [group({ en: own, hi: foreign })],
    });

    expect(result.ok).toBe(false);
    expect(state.updates).toEqual([]);
  });
  it('keeps the platforms a group goes to', async () => {
    state.stored = { shorts_groups: [group({ en: own })] };

    const result = await updateShortsGroupsAction({
      episodeId: E,
      shortsGroups: [
        { ...group({ en: own }), platforms: ['instagram', 'facebook'] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(state.updates).toEqual([
      {
        shorts_groups: [
          { ...group({ en: own }), platforms: ['instagram', 'facebook'] },
        ],
      },
    ]);
  });
});
