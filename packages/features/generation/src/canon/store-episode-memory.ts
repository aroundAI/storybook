/**
 * Writes the rows the memory context builder reads back (FILM-1004): the
 * episode's `episode_summaries` row and, when a location was named, its
 * `world_states` row. The commit action and the story-generation worker both
 * write them through this function, so the two paths cannot drift: the
 * story commit puts `planEpisodeMemory`'s steps in its own plan (one
 * transaction, FILM-1903), the publish commit calls `storeEpisodeMemory`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import {
  type CommitStep,
  type CommitWrite,
  eq,
  ref,
  wasSkipped,
} from '../commit-plan';
import { applyPlanThroughClient } from '../commit-through-client';
import {
  type CommittedEpisodeMemory,
  toEpisodeSummaryRow,
  toWorldStateRow,
} from './memory-rows';

type MemoryClient = SupabaseClient<Database>;

export interface StoredEpisodeMemory {
  episodeSummary: boolean;
  worldState: boolean;
}

const SUMMARY = 'memory.summary';
const WORLD = 'memory.world';

/**
 * Both are one row per episode, so writing again replaces them. Neither is
 * required for a commit to have worked, so a failure is reported in the
 * result, not thrown.
 */
export async function storeEpisodeMemory(
  client: MemoryClient,
  data: {
    projectId: string;
    episodeId: string;
    changes: CommittedEpisodeMemory;
  },
): Promise<StoredEpisodeMemory> {
  try {
    const steps = await planEpisodeMemory(client, data);
    const applied = await applyPlanThroughClient(client, { ops: steps });
    const planned = (key: string) => steps.some((step) => step.key === key);

    return {
      episodeSummary: planned(SUMMARY) && !wasSkipped(applied, SUMMARY),
      worldState: planned(WORLD) && !wasSkipped(applied, WORLD),
    };
  } catch (error) {
    console.warn('[storeEpisodeMemory] Episode memory not stored:', error);
    return { episodeSummary: false, worldState: false };
  }
}

/**
 * The memory rows as steps of a commit's plan, each skippable: the
 * summary, the world state (an update of the episode's latest row, or an
 * insert), and the world state's delta, written only when the world state
 * was. The read of the existing world state happens here, first.
 */
export async function planEpisodeMemory(
  client: MemoryClient,
  data: {
    projectId: string;
    episodeId: string;
    changes: CommittedEpisodeMemory;
  },
): Promise<CommitStep[]> {
  const steps: CommitWrite[] = [];
  const summaryRow = toEpisodeSummaryRow(data.episodeId, data.changes);

  if (summaryRow) {
    steps.push({
      key: SUMMARY,
      op: 'upsert',
      table: 'episode_summaries',
      asObject: true,
      rows: [summaryRow],
      onConflict: 'episode_id',
      onError: 'skip',
    });
  }

  const worldRow = toWorldStateRow(
    data.projectId,
    data.episodeId,
    data.changes,
  );

  if (!worldRow) return steps;

  const { data: existing, error: readError } = await client
    .from('world_states')
    .select('id, location, time_period, atmosphere, active_conflicts')
    .eq('project_id', data.projectId)
    .eq('episode_id', data.episodeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError) {
    console.warn('[storeEpisodeMemory] World state not stored:', readError);
    return steps;
  }

  // requireRows on the update: RLS filters a refused update to no rows,
  // without an error (KB-105)
  steps.push(
    existing
      ? {
          key: WORLD,
          op: 'update',
          table: 'world_states',
          values: worldRow,
          match: [eq('id', existing.id)],
          requireRows: true,
          returning: ['id'],
          onError: 'skip',
        }
      : {
          key: WORLD,
          op: 'insert',
          table: 'world_states',
          asObject: true,
          rows: [worldRow],
          returning: ['id'],
          onError: 'skip',
        },
  );

  // The world state is stored by then, so a log write that fails is reported
  steps.push({
    op: 'insert',
    table: 'state_deltas',
    asObject: true,
    rows: [
      {
        episode_id: data.episodeId,
        entity_type: 'world',
        entity_id: existing ? existing.id : ref(WORLD, 'id', { one: true }),
        before_state: (existing ? worldStateSnapshot(existing) : null) as Json,
        after_state: worldStateSnapshot(worldRow) as Json,
        change_reason: existing ? 'World state replaced' : 'World state set',
      },
    ],
    onlyIfRows: [WORLD],
    onError: 'skip',
  });

  return steps;
}

function worldStateSnapshot(row: {
  location: string;
  time_period?: string | null;
  atmosphere?: string | null;
  active_conflicts?: string[] | null;
}) {
  return {
    location: row.location,
    timePeriod: row.time_period ?? null,
    atmosphere: row.atmosphere ?? null,
    activeConflicts: row.active_conflicts ?? [],
  };
}
