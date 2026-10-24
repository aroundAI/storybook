import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-215: the Publish screen's title, description and tags were never
 * stored. saveEpisodePublishDetails renames the episode, keeps the tags in
 * metadata beside what is already there, and survives a write that moves
 * the version between its read and its update.
 *
 * The fake client holds one episode row; an update lands only when its
 * version filter matches, as the real `.eq('version', …)` does.
 */

vi.mock('server-only', () => ({}));

const EPISODE = '33333333-3333-4333-8333-333333333333';

interface Row {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  version: number;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
}

const state = vi.hoisted(() => ({
  row: null as unknown as Row,
  /** Writes made by "someone else" just before each of our updates */
  interleavedWrites: 0,
  updates: 0,
}));

function fakeClient() {
  return {
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Partial<Row> | null = null;

      const builder = {
        select: () => builder,
        update: (values: Partial<Row>) => {
          patch = values;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        is: () => builder,
        maybeSingle: async () => {
          if (!patch) {
            return {
              data: { ...state.row, project: { account_id: 'acct' } },
              error: null,
            };
          }

          state.updates++;

          if (state.interleavedWrites > 0) {
            state.interleavedWrites--;
            state.row = { ...state.row, version: state.row.version + 1 };
          }

          if (filters.version !== state.row.version) {
            return { data: null, error: null };
          }

          state.row = {
            ...state.row,
            ...patch,
            version: state.row.version + 1,
          } as Row;

          return { data: state.row, error: null };
        },
      };

      return builder;
    },
  };
}

beforeEach(() => {
  state.row = {
    id: EPISODE,
    project_id: 'project',
    title: 'Stray dogs',
    description: 'Working description',
    version: 4,
    metadata: { themes: ['ecology'], tags: ['old'] },
    deleted_at: null,
  };
  state.interleavedWrites = 0;
  state.updates = 0;
});

async function save() {
  const { saveEpisodePublishDetails } = await import(
    '../src/server/episode.service'
  );

  return saveEpisodePublishDetails(fakeClient() as never, {
    episodeId: EPISODE,
    title: 'Why India Has So Many Stray Dogs and So Few Vultures',
    description: 'Every day, dead cattle are brought to a carcass dump.',
    tags: ['vultures', 'india'],
  });
}

describe('saveEpisodePublishDetails', () => {
  it('renames the episode and keeps its other metadata', async () => {
    const result = await save();

    expect(result.ok).toBe(true);
    expect(state.row.title).toBe(
      'Why India Has So Many Stray Dogs and So Few Vultures',
    );
    expect(state.row.description).toBe(
      'Every day, dead cattle are brought to a carcass dump.',
    );
    expect(state.row.metadata).toEqual({
      themes: ['ecology'],
      tags: ['vultures', 'india'],
    });
  });

  it('re-reads and saves when another write moved the version', async () => {
    state.interleavedWrites = 1;

    const result = await save();

    expect(result.ok).toBe(true);
    expect(state.updates).toBe(2);
    expect(state.row.title).toBe(
      'Why India Has So Many Stray Dogs and So Few Vultures',
    );
  });

  it('gives up after repeated moves rather than looping', async () => {
    state.interleavedWrites = 10;

    await expect(save()).rejects.toThrow();
    expect(state.updates).toBe(3);
  });
});
