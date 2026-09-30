import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  buildParentContext,
  linkAsSequel,
} from '../src/lib/canon/sequel-system';

/**
 * FILM-1113. sequel-system.test.ts covers how a parent's context is written
 * into a prompt; this covers how it is built from the parent's canon (who is
 * dead and who is alive, what was resolved, where things happened) and how a
 * sequel is linked to one parent or several.
 */

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

type Tables = Record<string, unknown>;

interface Write {
  table: string;
  kind: 'update' | 'upsert';
  row: Record<string, unknown>;
}

/** Every table read answers its fixture; writes are recorded. */
function fakeClient(tables: Tables) {
  const writes: Write[] = [];

  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const pass = () => chain;

    for (const method of ['select', 'eq', 'in', 'order']) chain[method] = pass;

    chain.single = async () => ({ data: tables[table] ?? null, error: null });
    chain.update = (row: Record<string, unknown>) => {
      writes.push({ table, kind: 'update', row });
      return chain;
    };
    chain.upsert = async (row: Record<string, unknown>) => {
      writes.push({ table, kind: 'upsert', row });
      return { error: null };
    };
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: tables[table] ?? [], error: null });

    return chain;
  };

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

  return { writes };
}

const ANA = '00000000-0000-4000-8000-00000000a001';
const MARCUS = '00000000-0000-4000-8000-00000000a002';

const canon = (over: Tables = {}): Tables => ({
  immutable_events: [
    {
      event_key: `character:${MARCUS}:dead`,
      event_type: 'death',
      description: 'Marcus falls',
    },
    {
      event_key: 'world:gate:open',
      event_type: 'world_fact',
      description: 'The gate is open',
    },
    {
      // Names Ana but is not a death, so Ana lives.
      event_key: `character:${ANA}:promoted`,
      event_type: 'timeline',
      description: 'Ana is promoted',
    },
  ],
  narrative_threads: [
    { thread_name: 'The gate', description: 'It was opened' },
    { thread_name: 'The crown', description: null },
  ],
  world_states: [
    {
      location: 'Harbour',
      environment_data: { visualDescription: 'grey water' },
    },
    { location: 'Harbour', environment_data: { visualDescription: 'older' } },
    { location: 'Keep', environment_data: null },
  ],
  episodes: [{ id: 'e1' }, { id: 'e2' }],
  // Newest first, as the query orders them: Ana's earlier state is dropped.
  character_states: [
    {
      character_id: ANA,
      state_value: {
        emotionalState: 'determined',
        location: 'Station',
        knownFacts: ['the plot'],
      },
      state_type: 'x',
      created_at: '2026-02',
      episode_id: 'e2',
    },
    {
      character_id: MARCUS,
      state_value: {},
      state_type: 'x',
      created_at: '2026-02',
      episode_id: 'e2',
    },
    {
      character_id: ANA,
      state_value: { emotionalState: 'afraid', location: 'Old' },
      state_type: 'x',
      created_at: '2026-01',
      episode_id: 'e1',
    },
  ],
  assets: [
    { id: ANA, name: 'Ana', metadata: { visualDescription: 'red coat' } },
    { id: MARCUS, name: 'Marcus', metadata: null },
  ],
  episode_summaries: [{ plot_summary: 'One.' }, { plot_summary: 'Two.' }],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('buildParentContext', () => {
  it('marks a character dead only by a death event that names them', async () => {
    fakeClient(canon());

    const context = await buildParentContext('p1', 'First');
    const byName = Object.fromEntries(
      context.finalCharacterStates.map((c) => [c.characterName, c.isAlive]),
    );

    expect(byName).toEqual({ Ana: true, Marcus: false });
  });

  it('keeps every character alive when the parent has no deaths', async () => {
    fakeClient(
      canon({
        immutable_events: [
          {
            event_key: 'world:gate:open',
            event_type: 'world_fact',
            description: 'x',
          },
        ],
      }),
    );

    const context = await buildParentContext('p1', 'First');

    expect(context.finalCharacterStates.every((c) => c.isAlive)).toBe(true);
  });

  it('takes each character’s latest state and defaults what it lacks', async () => {
    fakeClient(canon());

    const { finalCharacterStates } = await buildParentContext('p1', 'First');

    expect(finalCharacterStates).toHaveLength(2);
    expect(finalCharacterStates[0]).toMatchObject({
      characterName: 'Ana',
      finalEmotionalState: 'determined',
      finalLocation: 'Station',
      knownFacts: ['the plot'],
    });
    expect(finalCharacterStates[1]).toMatchObject({
      characterName: 'Marcus',
      finalEmotionalState: 'neutral',
      finalLocation: 'unknown',
      knownFacts: [],
    });
  });

  it('carries resolved threads, world facts and a visual registry', async () => {
    fakeClient(canon());

    const context = await buildParentContext('p1', 'First');

    expect(context.resolvedThreads).toEqual([
      { threadName: 'The gate', resolution: 'It was opened' },
      { threadName: 'The crown', resolution: '' },
    ]);
    expect(context.worldFacts).toEqual([
      { factKey: 'world:gate:open', description: 'The gate is open' },
    ]);
    expect(context.characterVisualRegistry[ANA]).toEqual({
      characterName: 'Ana',
      visualDescription: 'red coat',
      assetId: ANA,
    });
    expect(context.characterVisualRegistry[MARCUS]?.visualDescription).toBe(
      'Marcus',
    );
  });

  it('lists each location once, the newest description first', async () => {
    fakeClient(canon());

    const { locationRegistry } = await buildParentContext('p1', 'First');

    expect(locationRegistry).toEqual([
      { locationName: 'Harbour', visualDescription: 'grey water' },
      { locationName: 'Keep', visualDescription: 'Keep' },
    ]);
  });

  it('joins the episode summaries, or says there is none', async () => {
    fakeClient(canon());
    expect((await buildParentContext('p1', 'First')).parentSummary).toBe(
      'One. Two.',
    );

    fakeClient(canon({ episode_summaries: [] }));
    expect((await buildParentContext('p1', 'First')).parentSummary).toBe(
      'No summary available',
    );
  });

  it('builds an empty context for a parent with no canon at all', async () => {
    fakeClient({});

    const context = await buildParentContext('p1', 'First');

    expect(context).toMatchObject({
      parentProjectId: 'p1',
      parentProjectName: 'First',
      parentSummary: 'No summary available',
      immutableEvents: [],
      finalCharacterStates: [],
      resolvedThreads: [],
      worldFacts: [],
    });
  });
});

describe('linkAsSequel', () => {
  const project = (id: string, sequelOf: string[] = []) => ({
    id,
    name: `Project ${id}`,
    metadata: null,
    sequel_of: sequelOf,
  });

  /** `single()` answers the same row for both project reads, so the two are told apart by id. */
  function clientForProjects(
    projects: Record<string, unknown>,
    rest: Tables = canon(),
  ) {
    const writes: Write[] = [];
    let lastEq = '';

    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      const pass = () => chain;

      for (const method of ['select', 'in', 'order']) chain[method] = pass;

      chain.eq = (column: string, value: string) => {
        if (table === 'projects' && column === 'id') lastEq = value;
        return chain;
      };
      chain.single = async () => ({
        data: table === 'projects' ? (projects[lastEq] ?? null) : null,
        error: null,
      });
      chain.update = (row: Record<string, unknown>) => {
        writes.push({ table, kind: 'update', row });
        return chain;
      };
      chain.upsert = async (row: Record<string, unknown>) => {
        writes.push({ table, kind: 'upsert', row });
        return { error: null };
      };
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rest[table] ?? [], error: null });

      return chain;
    };

    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    return { writes };
  }

  it('links a first parent: records it on the sequel and caches its context', async () => {
    const { writes } = clientForProjects({
      s1: project('s1'),
      p1: project('p1'),
    });

    const context = await linkAsSequel('s1', 'p1');

    expect(context.parentProjectId).toBe('p1');
    expect(writes.find((w) => w.kind === 'update')?.row).toEqual({
      sequel_of: ['p1'],
    });
    expect(writes.find((w) => w.kind === 'upsert')?.row).toMatchObject({
      sequel_project_id: 's1',
      parent_project_id: 'p1',
      parent_project_name: 'Project p1',
      parent_summary: 'One. Two.',
      is_stale: false,
    });
  });

  it('adds a second parent beside the first', async () => {
    const { writes } = clientForProjects({
      s1: project('s1', ['p1']),
      p2: project('p2'),
    });

    await linkAsSequel('s1', 'p2');

    expect(writes.find((w) => w.kind === 'update')?.row).toEqual({
      sequel_of: ['p1', 'p2'],
    });
  });

  it('does not list a parent twice, but still refreshes its cached context', async () => {
    const { writes } = clientForProjects({
      s1: project('s1', ['p1']),
      p1: project('p1'),
    });

    await linkAsSequel('s1', 'p1');

    expect(writes.filter((w) => w.kind === 'update')).toEqual([]);
    expect(writes.filter((w) => w.kind === 'upsert')).toHaveLength(1);
  });

  it('refuses a circular link and writes nothing', async () => {
    const { writes } = clientForProjects({
      s1: project('s1'),
      p1: project('p1', ['s1']),
    });

    await expect(linkAsSequel('s1', 'p1')).rejects.toThrow(
      'Circular sequel reference detected',
    );
    expect(writes).toEqual([]);
  });

  it('refuses when either project does not exist', async () => {
    clientForProjects({ s1: project('s1') });

    await expect(linkAsSequel('s1', 'missing')).rejects.toThrow(
      'Project not found',
    );
  });
});
