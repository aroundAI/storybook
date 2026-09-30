/**
 * Rows the memory context builder reads back (FILM-1004): one
 * `episode_summaries` row and at most one `world_states` row per episode,
 * written when an episode's canon changes are committed.
 */
import type { Database } from '@kit/supabase/database';

type Tables = Database['public']['Tables'];

export interface ExtractedWorldState {
  location: string;
  timePeriod?: string;
  atmosphere?: string;
  activeConflicts?: string[];
}

export interface CommittedEpisodeMemory {
  episodeSummary: string;
  sentimentScore: number;
  keyEvents?: string[];
  characterChanges?: string[];
  worldState?: ExtractedWorldState;
}

const CHARS_PER_TOKEN = 4;

/** `null` when there is no summary text: the column is not nullable. */
export function toEpisodeSummaryRow(
  episodeId: string,
  memory: CommittedEpisodeMemory,
): Tables['episode_summaries']['Insert'] | null {
  const plotSummary = memory.episodeSummary.trim();
  if (!plotSummary) return null;

  const keyEvents = memory.keyEvents ?? [];
  const characterChanges = memory.characterChanges ?? [];

  return {
    episode_id: episodeId,
    plot_summary: plotSummary,
    key_events: keyEvents,
    character_changes: characterChanges,
    sentiment_score: Math.round(memory.sentimentScore * 100) / 100,
    estimated_tokens: Math.ceil(
      JSON.stringify({ plotSummary, keyEvents, characterChanges }).length /
        CHARS_PER_TOKEN,
    ),
    updated_at: new Date().toISOString(),
  };
}

/** `null` when the extraction named no location: the column is not nullable. */
export function toWorldStateRow(
  projectId: string,
  episodeId: string,
  memory: CommittedEpisodeMemory,
): Tables['world_states']['Insert'] | null {
  const location = memory.worldState?.location.trim();
  if (!memory.worldState || !location) return null;

  return {
    project_id: projectId,
    episode_id: episodeId,
    location,
    time_period: memory.worldState.timePeriod?.trim() || null,
    atmosphere: memory.worldState.atmosphere?.trim() || null,
    active_conflicts: memory.worldState.activeConflicts ?? [],
    updated_at: new Date().toISOString(),
  };
}

export function describeStateChange(change: {
  characterName: string;
  fromState: string;
  toState: string;
}): string {
  return `${change.characterName}: ${change.fromState} -> ${change.toState}`;
}
