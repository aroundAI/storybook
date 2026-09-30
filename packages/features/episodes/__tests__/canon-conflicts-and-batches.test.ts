import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  addImmutableEventAction,
  commitCanonChangesAction,
} from '../src/server/canon-actions';

/**
 * FILM-1005. Two things the canon actions promise that nothing pinned:
 * an immutable event is never added twice under one key (conflict
 * detection), and an episode's extracted changes go in as one batch, events
 * through one atomic RPC and thread updates in as few queries as the
 * actions allow, never one round trip per thread.
 */

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: '00000000-0000-4000-8000-0000000000aa' }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** A PostgREST query builder: every call chains, and awaiting it settles. */
function query(result: Result) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (value: Result) => unknown) => unknown;
  } = {};

  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'order',
    'single',
    'upsert',
    'limit',
    'maybeSingle',
  ]) {
    chain[method] = vi.fn(() => chain);
  }

  chain.then = (resolve) => resolve(result);

  return chain;
}

type Chain = ReturnType<typeof query>;

const MEMORY_TABLES = ['episode_summaries', 'world_states'];

/**
 * Each `from()` call returns the next result; the chains are kept to inspect.
 * The memory tables (FILM-1004) are served separately, so the thread counts
 * below stay about threads; `memory` holds what was written to them.
 */
function clientReturning(
  results: Result[],
  rpc: Result = { data: null, error: null },
  memoryResults: Record<string, Result> = {},
) {
  const chains: Chain[] = [];
  const memory: Array<{ table: string; chain: Chain }> = [];
  const from = vi.fn(() => {
    const next = results[chains.length];

    if (!next) throw new Error(`unexpected from() call #${chains.length + 1}`);

    const chain = query(next);
    chains.push(chain);
    return chain;
  });
  const rpcFn = vi.fn(async () => rpc);

  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => {
      if (!MEMORY_TABLES.includes(table)) return from();

      const chain = query(memoryResults[table] ?? { data: null, error: null });
      memory.push({ table, chain });
      return chain;
    },
    rpc: rpcFn,
  } as never);

  return { from, rpc: rpcFn, chains, memory };
}

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EPISODE = '22222222-2222-4222-8222-222222222222';

const EVENT = {
  projectId: PROJECT,
  eventType: 'death' as const,
  eventKey: 'character:mara:dead',
  establishedIn: EPISODE,
  season: 1,
  episodeNumber: 1,
  description: 'Mara dies defending the gate',
};

describe('conflict detection: addImmutableEventAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an event key that already exists, and writes nothing', async () => {
    const { from, chains } = clientReturning([
      { data: { id: 'e1', event_key: EVENT.eventKey }, error: null },
    ]);

    await expect(addImmutableEventAction(EVENT)).resolves.toEqual({
      ok: false,
      error:
        'Event key "character:mara:dead" already exists. Immutable events cannot be duplicated.',
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(chains[0]!.insert).not.toHaveBeenCalled();
  });

  it('looks for the key within the same project only', async () => {
    const { chains } = clientReturning([
      { data: { id: 'e1', event_key: EVENT.eventKey }, error: null },
    ]);

    await addImmutableEventAction(EVENT);

    expect(chains[0]!.eq!.mock.calls).toEqual([
      ['project_id', PROJECT],
      ['event_key', 'character:mara:dead'],
    ]);
  });

  it('adds the event when the key is free', async () => {
    const { chains } = clientReturning([
      { data: null, error: null },
      { data: { id: 'e2', event_key: EVENT.eventKey }, error: null },
    ]);

    await expect(addImmutableEventAction(EVENT)).resolves.toMatchObject({
      ok: true,
    });

    expect(chains[1]!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT,
        event_key: 'character:mara:dead',
        event_type: 'death',
        created_by: '00000000-0000-4000-8000-0000000000aa',
      }),
    );
  });
});

describe('batch operations: commitCanonChangesAction', () => {
  beforeEach(() => vi.clearAllMocks());

  const commit = (
    changes: Partial<
      Parameters<typeof commitCanonChangesAction>[0]['changes']
    > = {},
  ) =>
    commitCanonChangesAction({
      projectId: PROJECT,
      episodeId: EPISODE,
      season: 1,
      episodeNumber: 3,
      changes: {
        immutableEvents: [],
        threadUpdates: [],
        episodeSummary: 'The gate falls.',
        sentimentScore: 0.2,
        ...changes,
      },
    });

  it('sends only the high-confidence events, in one atomic RPC', async () => {
    const { rpc, from } = clientReturning([], {
      data: { eventsCreated: 1, summaryStored: true },
      error: null,
    });

    const result = await commit({
      immutableEvents: [
        {
          type: 'death',
          eventKey: 'character:mara:dead',
          description: 'Mara dies',
          confidence: 'high',
        },
        {
          type: 'world_fact',
          eventKey: 'world:gate:open',
          description: 'maybe open',
          confidence: 'medium',
        },
        {
          type: 'timeline',
          eventKey: 'timeline:x',
          description: 'unsure',
          confidence: 'low',
        },
      ],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('commit_canon_changes', {
      p_project_id: PROJECT,
      p_episode_id: EPISODE,
      p_season: 1,
      p_episode_number: 3,
      p_events: [
        {
          type: 'death',
          eventKey: 'character:mara:dead',
          description: 'Mara dies',
        },
      ],
      p_episode_summary: 'The gate falls.',
      p_sentiment_score: 0.2,
    });
    expect(result).toEqual({
      eventsCreated: 1,
      threadsUpdated: 0,
      summaryStored: true,
      memoryStored: { episodeSummary: true, worldState: false },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('fails as a whole when the atomic RPC fails, and touches no thread', async () => {
    const { from } = clientReturning([], {
      data: null,
      error: { message: 'rolled back' },
    });

    await expect(
      commit({
        threadUpdates: [
          { threadName: 'The gate', action: 'open', description: 'd' },
        ],
      }),
    ).rejects.toThrow('Failed to commit canon changes: rolled back');

    expect(from).not.toHaveBeenCalled();
  });

  it('opens every new thread in one insert, not one per thread', async () => {
    const { from, chains } = clientReturning(
      [{ data: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], error: null }],
      { data: { eventsCreated: 0, summaryStored: true }, error: null },
    );

    const result = await commit({
      threadUpdates: ['A', 'B', 'C'].map((name) => ({
        threadName: `Thread ${name}`,
        action: 'open' as const,
        description: `about ${name}`,
        promises: name === 'A' ? ['a promise'] : undefined,
      })),
    });

    expect(from).toHaveBeenCalledTimes(1);
    const rows = chains[0]!.insert!.mock.calls[0]![0] as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      project_id: PROJECT,
      thread_name: 'Thread A',
      thread_type: 'plot',
      opened_at: EPISODE,
      promises: ['a promise'],
      episodes_touched: [EPISODE],
      status: 'open',
    });
    expect(rows[1]).toMatchObject({ promises: [] });
    expect(result.threadsUpdated).toBe(3);
  });

  it('looks up the threads to progress and resolve in one query, then updates each', async () => {
    const { from, chains } = clientReturning(
      [
        {
          data: [
            {
              id: 't-old',
              thread_name: 'The gate',
              episodes_touched: ['e-earlier'],
              payoffs: ['first payoff'],
              version: 2,
            },
            {
              id: 't-cold',
              thread_name: 'The crown',
              episodes_touched: [],
              payoffs: null,
              version: null,
            },
          ],
          error: null,
        },
        { data: [{ id: 't-old' }], error: null },
        { data: [{ id: 't-cold' }], error: null },
      ],
      { data: { eventsCreated: 0, summaryStored: true }, error: null },
    );

    const result = await commit({
      threadUpdates: [
        {
          threadName: 'The gate',
          action: 'progress',
          description: 'it cracks',
        },
        {
          threadName: 'The crown',
          action: 'resolve',
          description: 'it is worn',
        },
      ],
    });

    // One lookup for both names, then one update per thread.
    expect(from).toHaveBeenCalledTimes(3);
    expect(chains[0]!.in!.mock.calls[0]).toEqual([
      'thread_name',
      ['The gate', 'The crown'],
    ]);
    expect(chains[1]!.update).toHaveBeenCalledWith({
      status: 'progressed',
      episodes_touched: ['e-earlier', EPISODE],
      description: 'it cracks',
      version: 3,
    });
    expect(chains[2]!.update).toHaveBeenCalledWith({
      status: 'resolved',
      resolved_at: EPISODE,
      payoffs: ['it is worn'],
      episodes_touched: [EPISODE],
      version: 2,
    });
    expect(result.threadsUpdated).toBe(2);
  });

  it('does not count a thread update the row-level rules matched to no row', async () => {
    clientReturning(
      [
        {
          data: [
            {
              id: 't1',
              thread_name: 'The gate',
              episodes_touched: [],
              payoffs: [],
              version: 1,
            },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
      { data: { eventsCreated: 0, summaryStored: true }, error: null },
    );

    const result = await commit({
      threadUpdates: [
        { threadName: 'The gate', action: 'progress', description: 'x' },
      ],
    });

    expect(result.threadsUpdated).toBe(0);
  });

  it('skips a progress update for a thread that does not exist', async () => {
    const { from } = clientReturning([{ data: [], error: null }], {
      data: { eventsCreated: 0, summaryStored: true },
      error: null,
    });

    const result = await commit({
      threadUpdates: [
        { threadName: 'No such thread', action: 'resolve', description: 'x' },
      ],
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(result.threadsUpdated).toBe(0);
  });
});

describe('memory rows: commitCanonChangesAction (FILM-1004)', () => {
  beforeEach(() => vi.clearAllMocks());

  const commit = (
    changes: Partial<
      Parameters<typeof commitCanonChangesAction>[0]['changes']
    > = {},
  ) =>
    commitCanonChangesAction({
      projectId: PROJECT,
      episodeId: EPISODE,
      season: 1,
      episodeNumber: 3,
      changes: {
        immutableEvents: [],
        threadUpdates: [],
        episodeSummary: 'The gate falls.',
        sentimentScore: 0.204,
        keyEvents: ['The gate falls'],
        characterChanges: ['Mara: hopeful -> grieving'],
        ...changes,
      },
    });

  const rpcOk = {
    data: { eventsCreated: 0, summaryStored: true },
    error: null,
  };

  it('upserts the episode summary row, one per episode', async () => {
    const { memory } = clientReturning([], rpcOk);

    const result = await commit();

    expect(result.memoryStored).toEqual({
      episodeSummary: true,
      worldState: false,
    });
    expect(memory.map((m) => m.table)).toEqual(['episode_summaries']);
    expect(memory[0]!.chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        episode_id: EPISODE,
        plot_summary: 'The gate falls.',
        key_events: ['The gate falls'],
        character_changes: ['Mara: hopeful -> grieving'],
        sentiment_score: 0.2,
      }),
      { onConflict: 'episode_id' },
    );
  });

  it('writes no summary row for an empty summary', async () => {
    const { memory } = clientReturning([], rpcOk);

    const result = await commit({ episodeSummary: '   ' });

    expect(memory).toEqual([]);
    expect(result.memoryStored.episodeSummary).toBe(false);
  });

  it('inserts a world state when the extraction named a location and none exists', async () => {
    const { memory } = clientReturning([], rpcOk, {
      world_states: { data: null, error: null },
    });

    const result = await commit({
      worldState: { location: ' The north gate ', atmosphere: 'smoke' },
    });

    expect(result.memoryStored.worldState).toBe(true);
    const world = memory.filter((m) => m.table === 'world_states');
    expect(world[1]!.chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT,
        episode_id: EPISODE,
        location: 'The north gate',
        atmosphere: 'smoke',
        active_conflicts: [],
      }),
    );
  });

  it("updates the episode's world state when it already has one", async () => {
    const { memory } = clientReturning([], rpcOk, {
      world_states: { data: { id: 'w1' }, error: null },
    });

    await commit({ worldState: { location: 'The north gate' } });

    const world = memory.filter((m) => m.table === 'world_states');
    expect(world[1]!.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'The north gate' }),
    );
    expect(world[1]!.chain.insert).not.toHaveBeenCalled();
  });

  it('does not fail the commit when the summary row is refused', async () => {
    clientReturning([], rpcOk, {
      episode_summaries: {
        data: null,
        error: { code: '42501', message: 'rls' },
      },
    });

    const result = await commit();

    expect(result).toMatchObject({
      eventsCreated: 0,
      memoryStored: { episodeSummary: false },
    });
  });
});
