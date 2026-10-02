/**
 * Writes the rows the memory context builder reads back (FILM-1004): the
 * episode's `episode_summaries` row and, when a location was named, its
 * `world_states` row. The commit action and the story-generation worker both
 * write them through this function, so the two paths cannot drift.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

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
  const stored = { episodeSummary: false, worldState: false };

  try {
    await writeEpisodeMemory(client, data, stored);
  } catch (error) {
    console.warn('[storeEpisodeMemory] Episode memory not stored:', error);
  }

  return stored;
}

async function writeEpisodeMemory(
  client: MemoryClient,
  data: {
    projectId: string;
    episodeId: string;
    changes: CommittedEpisodeMemory;
  },
  stored: StoredEpisodeMemory,
): Promise<void> {
  const summaryRow = toEpisodeSummaryRow(data.episodeId, data.changes);

  if (summaryRow) {
    const { error } = await client
      .from('episode_summaries')
      .upsert(summaryRow, { onConflict: 'episode_id' });

    if (error) {
      console.warn('[storeEpisodeMemory] Episode summary not stored:', error);
    } else {
      stored.episodeSummary = true;
    }
  }

  const worldRow = toWorldStateRow(
    data.projectId,
    data.episodeId,
    data.changes,
  );

  if (worldRow) {
    const { data: existing, error: readError } = await client
      .from('world_states')
      .select('id, location, time_period, atmosphere, active_conflicts')
      .eq('project_id', data.projectId)
      .eq('episode_id', data.episodeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let failure: unknown = readError;
    let worldStateId: string | null = existing?.id ?? null;

    if (!readError && existing) {
      const { data: updated, error } = await client
        .from('world_states')
        .update(worldRow)
        .eq('id', existing.id)
        .select('id');

      // RLS filters a refused update to no rows, without an error (KB-105).
      failure = error ?? (updated?.length ? null : 'update matched no row');
    } else if (!readError) {
      const { data: inserted, error } = await client
        .from('world_states')
        .insert(worldRow)
        .select('id')
        .maybeSingle();
      failure = error;
      worldStateId = inserted?.id ?? null;
    }

    if (failure) {
      console.warn('[storeEpisodeMemory] World state not stored:', failure);
    } else {
      stored.worldState = true;
      if (worldStateId) {
        await recordWorldStateDelta(client, {
          episodeId: data.episodeId,
          worldStateId,
          before: existing ? worldStateSnapshot(existing) : null,
          after: worldStateSnapshot(worldRow),
        });
      }
    }
  }
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

/** The world state is stored by now, so a log write that fails is reported. */
async function recordWorldStateDelta(
  client: MemoryClient,
  delta: {
    episodeId: string;
    worldStateId: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  const { error } = await client.from('state_deltas').insert({
    episode_id: delta.episodeId,
    entity_type: 'world',
    entity_id: delta.worldStateId,
    before_state: delta.before as Json,
    after_state: delta.after as Json,
    change_reason: delta.before ? 'World state replaced' : 'World state set',
  });

  if (error) {
    console.warn('[storeEpisodeMemory] World state delta not written:', error);
  }
}
