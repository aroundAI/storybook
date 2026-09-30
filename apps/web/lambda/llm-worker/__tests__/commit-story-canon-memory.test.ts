/**
 * FILM-1004: the worker's canon commit writes the episode summary and world
 * state, through the same function the publish commit uses.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitStoryCanon } from '../utils/commit-story-canon';

const EPISODE = '33333333-3333-4333-8333-333333333333';
const PROJECT = '22222222-2222-4222-8222-222222222222';

type Write = { table: string; op: string; row: Record<string, unknown> };

const extraction = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: async () => {
    if (!extraction.current) throw new Error('LLM down');
    return { data: { extraction: extraction.current } };
  },
}));

function recordingClient(writes: Write[]) {
  const builder = (table: string) => {
    let op = 'select';
    const self: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
    };
    for (const name of ['select', 'eq', 'in', 'order', 'limit', 'gte']) {
      self[name] = () => self;
    }
    for (const name of ['insert', 'upsert', 'update', 'delete']) {
      self[name] = (row?: Record<string, unknown>) => {
        op = name;
        if (row) writes.push({ table, op, row });
        return self;
      };
    }
    return self;
  };
  return { from: builder } as unknown as SupabaseClient;
}

const STORY = 'A long story. '.repeat(20);

function commit(writes: Write[], overrides: { episodeSummary?: string } = {}) {
  return commitStoryCanon({
    projectId: PROJECT,
    accountId: '11111111-1111-4111-8111-111111111111',
    episodeId: EPISODE,
    episodeNumber: 2,
    season: 1,
    keyEvents: [],
    characters: [],
    storyContent: STORY,
    createdBy: '77777777-7777-4777-8777-777777777777',
    supabase: recordingClient(writes),
    ...overrides,
  });
}

describe('commitStoryCanon episode memory (FILM-1004)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    extraction.current = {
      threadUpdates: [],
      episodeSummary: 'Maya finds the locket.',
      sentimentScore: 0.4,
      keyEvents: ['Maya finds the locket'],
      characterStateChanges: [
        { characterName: 'Maya', fromState: 'curious', toState: 'afraid' },
      ],
      worldState: { location: 'The lighthouse', timePeriod: 'Dusk' },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the episode summary row from the extraction', async () => {
    const writes: Write[] = [];
    await commit(writes);

    const summary = writes.find((w) => w.table === 'episode_summaries');
    expect(summary?.op).toBe('upsert');
    expect(summary?.row).toMatchObject({
      episode_id: EPISODE,
      plot_summary: 'Maya finds the locket.',
      sentiment_score: 0.4,
      key_events: ['Maya finds the locket'],
      character_changes: ['Maya: curious -> afraid'],
    });
  });

  it('writes the world state row when a location was named', async () => {
    const writes: Write[] = [];
    await commit(writes);

    const world = writes.find((w) => w.table === 'world_states');
    expect(world?.row).toMatchObject({
      project_id: PROJECT,
      episode_id: EPISODE,
      location: 'The lighthouse',
      time_period: 'Dusk',
    });
  });

  it('prefers the orchestrator summary over the extraction one', async () => {
    const writes: Write[] = [];
    await commit(writes, { episodeSummary: 'From the orchestrator.' });

    const summary = writes.find((w) => w.table === 'episode_summaries');
    expect(summary?.row.plot_summary).toBe('From the orchestrator.');
  });

  it('writes no world state when the extraction names no location', async () => {
    extraction.current = { ...extraction.current, worldState: undefined };
    const writes: Write[] = [];
    await commit(writes);

    expect(writes.some((w) => w.table === 'world_states')).toBe(false);
    expect(writes.some((w) => w.table === 'episode_summaries')).toBe(true);
  });

  it('writes nothing when the extraction failed, and does not throw', async () => {
    extraction.current = null;
    const writes: Write[] = [];

    await expect(commit(writes)).resolves.toBeUndefined();

    expect(writes.some((w) => w.table === 'episode_summaries')).toBe(false);
  });
});
