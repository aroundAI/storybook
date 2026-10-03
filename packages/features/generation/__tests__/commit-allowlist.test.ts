/**
 * Every write a commit plans is one apply_generation_commit accepts
 * (FILM-1903). The allowlist lives in the migration; this reads it from
 * there, so a plan that sets a column the function would refuse fails here,
 * on the branch a database test cannot reach. The stage-plan pgTAP files
 * apply the plans the matrix's fixtures produce; a regenerated story,
 * which updates an existing world state, was not one of them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type CommitPlan,
  type CommitStep,
  planEpisodeMemory,
  planStoryCanon,
  planWrites,
} from '../src';
import { recordingClient, tableResponder } from '../src/testing';

const MIGRATIONS = path.resolve(
  __dirname,
  '../../../../apps/web/supabase/migrations',
);

/** The newest migration that (re)defines the allowlist: the one in force. */
const MIGRATION = path.join(
  MIGRATIONS,
  readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .reverse()
    .find((file) =>
      readFileSync(path.join(MIGRATIONS, file), 'utf8').includes(
        'function kit.generation_commit_allowlist()',
      ),
    )!,
);

interface Rule {
  ops: string[];
  insert: string[];
  update: string[];
}

function allowlist(): Record<string, Rule> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const json = sql.slice(
    sql.indexOf('select $json$') + 'select $json$'.length,
    sql.indexOf('$json$::jsonb'),
  );

  return JSON.parse(json) as Record<string, Rule>;
}

/** What the function's plan check would refuse, as it words it. */
export function refusals(plan: CommitPlan): string[] {
  const rules = allowlist();
  const refused: string[] = [];

  for (const write of planWrites(plan)) {
    const rule = rules[write.table];

    if (!rule || !rule.ops.includes(write.op)) {
      refused.push(`${write.op} ${write.table}`);
      continue;
    }

    if (write.op === 'insert' || write.op === 'upsert') {
      const columns = new Set(
        write.rows.flatMap((row) => Object.keys(row as object)),
      );

      for (const column of columns) {
        if (!rule.insert.includes(column)) {
          refused.push(`${write.table}.${column} (insert)`);
        }
      }

      if (write.op === 'upsert' && !write.ignoreDuplicates) {
        const conflict = write.onConflict.split(',');
        for (const column of columns) {
          if (!conflict.includes(column) && !rule.update.includes(column)) {
            refused.push(`${write.table}.${column} (upsert update)`);
          }
        }
      }
    }

    if (write.op === 'update') {
      for (const column of Object.keys(write.values)) {
        if (!rule.update.includes(column)) {
          refused.push(`${write.table}.${column} (update)`);
        }
      }
    }
  }

  return refused;
}

const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '55555555-5555-4555-8555-555555555555';

const memory = {
  projectId: PROJECT,
  episodeId: EPISODE,
  changes: {
    episodeSummary: 'The gate falls.',
    sentimentScore: 0.2,
    keyEvents: ['The gate falls'],
    worldState: { location: 'The north gate', atmosphere: 'smoke' },
  },
};

const plan = (ops: CommitStep[]): CommitPlan => ({ ops });

describe('every planned write passes apply_generation_commit’s allowlist', () => {
  it('the episode memory, first time: the world state is inserted', async () => {
    const client = recordingClient(tableResponder({ world_states: null }));

    expect(
      refusals(plan(await planEpisodeMemory(client.client, memory))),
    ).toEqual([]);
  });

  it('the episode memory, regenerated: the existing world state is updated', async () => {
    const client = recordingClient(
      tableResponder({
        world_states: { id: 'w1', location: 'old', active_conflicts: [] },
      }),
    );
    const steps = await planEpisodeMemory(client.client, memory);

    expect(planWrites(plan(steps)).map((w) => `${w.table}:${w.op}`)).toContain(
      'world_states:update',
    );
    expect(refusals(plan(steps))).toEqual([]);
  });

  it('the story canon, with every thread action and an existing world state', async () => {
    const client = recordingClient(
      tableResponder({
        assets: [{ id: 'a1', name: 'Mara' }],
        narrative_threads: [
          {
            id: 't1',
            episodes_touched: [],
            payoffs: [],
            version: 1,
            opened_at: 'older',
            auto_generated: true,
          },
        ],
        world_states: { id: 'w1', location: 'old', active_conflicts: [] },
      }),
    );

    const steps = await planStoryCanon({
      projectId: PROJECT,
      episodeId: EPISODE,
      episodeNumber: 2,
      season: 1,
      keyEvents: ['The gate falls'],
      characters: [{ name: 'Mara', role: 'lead', arc: 'grief' }],
      episodeSummary: 'The gate falls.',
      themes: ['loss'],
      extraction: {
        threadUpdates: [
          { threadName: 'New', action: 'open', description: 'd' },
          { threadName: 'Siege', action: 'progress', description: 'd' },
          { threadName: 'Feud', action: 'resolve', description: 'd' },
        ],
        episodeSummary: 'The gate falls.',
        sentimentScore: 0.2,
        worldState: { location: 'The north gate' },
      },
      createdBy: '44444444-4444-4444-8444-444444444444',
      supabase: client.client,
    });

    expect(refusals(plan(steps))).toEqual([]);
  });
});
