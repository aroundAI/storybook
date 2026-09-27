import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-105: an update RLS filters to no rows answers `{ data: [], error: null }`,
 * exactly like one that worked. The publish screen's shorts save told the
 * user it was saved either way; it now refuses when nothing changed.
 *
 * The fake client answers the update with the rows RLS let through.
 */

const EPISODE = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  changedRows: [] as Array<{ id: string }>,
  updates: [] as string[],
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@kit/prompt-engine/llm-job-target', () => ({
  noTenantLlmJobTarget: () => ({}),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              final_video_url: null,
              localized_videos: {},
              shorts_groups: [],
            },
            error: null,
          }),
        }),
      }),
      update: () => {
        state.updates.push(table);
        return {
          eq: () => ({
            select: async () => ({ data: state.changedRows, error: null }),
          }),
        };
      },
    }),
  }),
}));

const shortsGroups = [
  {
    id: 'group-1',
    name: 'Teaser',
    title: 'Night Ferry — teaser',
    description: '',
    tags: [],
    videos: {},
  },
];

beforeEach(() => {
  state.changedRows = [];
  state.updates = [];
});

describe('updateShortsGroupsAction', () => {
  it('saves when the update changed the episode', async () => {
    const { updateShortsGroupsAction } = await import(
      '../src/lib/server/mutations/publish-actions'
    );
    state.changedRows = [{ id: EPISODE }];

    await expect(
      updateShortsGroupsAction({ episodeId: EPISODE, shortsGroups }),
    ).resolves.toEqual({ ok: true, data: { success: true } });
    expect(state.updates).toEqual(['episodes']);
  });

  it('refuses when RLS filtered the update to no rows', async () => {
    const { updateShortsGroupsAction } = await import(
      '../src/lib/server/mutations/publish-actions'
    );

    await expect(
      updateShortsGroupsAction({ episodeId: EPISODE, shortsGroups }),
    ).resolves.toEqual({
      ok: false,
      error: "You can't change this episode's shorts.",
    });
    expect(state.updates).toEqual(['episodes']);
  });
});
