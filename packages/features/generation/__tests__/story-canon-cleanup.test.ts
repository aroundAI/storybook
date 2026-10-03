/**
 * KB-78: regenerating a story replaces the canon generation made, and keeps
 * the canon a person added.
 *
 * The fake below evaluates the delete's filters over in-memory rows, the way
 * PostgREST would (`col=eq.value`, including `metadata->>key`), so these
 * tests assert which rows survive rather than which calls were made. The
 * same rule is exercised against the real database in the LLM worker's
 * `commit-story-canon.local-stack.test.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupEpisodeCanon } from '../src/canon';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const EPISODE = 'episode-1';
const OTHER_EPISODE = 'episode-2';

function read(row: Row, column: string) {
  const [field, key] = column.split('->>');
  const value = row[field!];
  if (key === undefined) return value;
  if (value === null || typeof value !== 'object') return undefined;
  const inner = (value as Row)[key];
  return inner === undefined || inner === null ? inner : String(inner);
}

function fakeClient(tables: Tables, failing: string[] = []) {
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        delete: () => builder,
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        then(
          resolve: (result: { data: Row[] | null; error: unknown }) => void,
        ) {
          if (failing.includes(table)) {
            return resolve({
              data: null,
              error: { message: `${table} is down` },
            });
          }
          const matches = (row: Row) =>
            filters.every(([column, value]) => read(row, column) === value);
          const deleted = (tables[table] ?? []).filter(matches);
          tables[table] = (tables[table] ?? []).filter((row) => !matches(row));
          return resolve({ data: deleted, error: null });
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

function seed(): Tables {
  return {
    immutable_events: [
      { id: 'hand-null', established_in: EPISODE, metadata: null },
      { id: 'hand-note', established_in: EPISODE, metadata: { note: 'x' } },
      {
        id: 'generated',
        established_in: EPISODE,
        metadata: { auto_generated: true, source: 'story_generation' },
      },
      {
        id: 'other-episode',
        established_in: OTHER_EPISODE,
        metadata: { auto_generated: true },
      },
    ],
    character_states: [
      { id: 'hand', episode_id: EPISODE, trigger_event: 'Writer edit' },
      {
        id: 'generated',
        episode_id: EPISODE,
        trigger_event: 'story_generation',
      },
    ],
    narrative_threads: [
      { id: 'hand', opened_at: EPISODE, auto_generated: false },
      { id: 'generated', opened_at: EPISODE, auto_generated: true },
      { id: 'other-episode', opened_at: OTHER_EPISODE, auto_generated: true },
    ],
  };
}

const ids = (rows: Row[] | undefined) => rows?.map((row) => row.id);

describe('cleanupEpisodeCanon', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the events a person added to the episode', async () => {
    const tables = seed();
    await cleanupEpisodeCanon(EPISODE, fakeClient(tables));

    expect(ids(tables.immutable_events)).toEqual([
      'hand-null',
      'hand-note',
      'other-episode',
    ]);
  });

  it('keeps the character states a person added to the episode', async () => {
    const tables = seed();
    await cleanupEpisodeCanon(EPISODE, fakeClient(tables));

    expect(ids(tables.character_states)).toEqual(['hand']);
  });

  it('keeps the threads a person opened in the episode', async () => {
    const tables = seed();
    await cleanupEpisodeCanon(EPISODE, fakeClient(tables));

    expect(ids(tables.narrative_threads)).toEqual(['hand', 'other-episode']);
  });

  it('reports a delete that fails instead of dropping it, and carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const tables = seed();

    await expect(
      cleanupEpisodeCanon(EPISODE, fakeClient(tables, ['character_states'])),
    ).resolves.toBeUndefined();

    // A skipped step of the cleanup's plan names its table and the error
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/character_states.*character_states is down/),
    );
    expect(ids(tables.immutable_events)).not.toContain('generated');
  });
});
