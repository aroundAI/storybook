/**
 * Sequel Linking System
 * FILM-1113: Canon inheritance between parent and sequel movies
 *
 * Allows a movie project to be marked as a sequel of one or more parent
 * movies, inheriting their canon (immutable events, character states,
 * resolved narrative threads) for generation context.
 */
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { sanitizeForPrompt } from '../sanitize-for-prompt';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Cast a typed value to the Supabase `Json` column type.
 *
 * This is a deliberate boundary cast: we trust our well-typed interfaces
 * (ParentImmutableEvent[], etc.) to be JSON-serializable. The helper
 * documents this intent in one place rather than scattering `as unknown
 * as Json` across the codebase.
 */
function toJsonb<T>(value: T): Json {
  return value as unknown as Json;
}

// =============================================================================
// TYPES
// =============================================================================

/** Cached parent canon for a sequel */
export interface ParentContext {
  parentProjectId: string;
  parentProjectName: string;
  parentSummary: string;
  immutableEvents: ParentImmutableEvent[];
  finalCharacterStates: ParentCharacterState[];
  resolvedThreads: ParentResolvedThread[];
  worldFacts: ParentWorldFact[];
  characterVisualRegistry: Record<string, CharacterVisualRef>;
  locationRegistry: LocationRef[];
}

export interface ParentImmutableEvent {
  eventKey: string;
  eventType: string;
  description: string;
}

export interface ParentCharacterState {
  characterId: string;
  characterName: string;
  isAlive: boolean;
  finalEmotionalState: string;
  finalLocation: string;
  knownFacts: string[];
}

export interface ParentResolvedThread {
  threadName: string;
  resolution: string;
}

export interface ParentWorldFact {
  factKey: string;
  description: string;
}

export interface CharacterVisualRef {
  characterName: string;
  /** 15+ attribute VEO-compatible description */
  visualDescription: string;
  assetId: string;
}

export interface LocationRef {
  locationName: string;
  visualDescription: string;
}

// =============================================================================
// LINK AS SEQUEL — Mark project as sequel of another
// =============================================================================

/**
 * Link a project as a sequel of a parent project.
 * Validates project types, updates `sequel_of` column, and
 * builds + caches the parent context.
 */
export async function linkAsSequel(
  sequelProjectId: string,
  parentProjectId: string,
): Promise<ParentContext> {
  const supabase = getSupabaseServerClient();

  // Validate both projects exist — fetch all needed columns in parallel
  const [{ data: sequelProject }, { data: parentProject }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, metadata, sequel_of')
      .eq('id', sequelProjectId)
      .single(),
    supabase
      .from('projects')
      .select('id, name, metadata, sequel_of')
      .eq('id', parentProjectId)
      .single(),
  ]);

  if (!sequelProject || !parentProject) {
    throw new Error('Project not found');
  }

  // Validate not circular (parent is not already a sequel of this project)
  const parentSequelOf = (parentProject.sequel_of as string[]) ?? [];
  if (parentSequelOf.includes(sequelProjectId)) {
    throw new Error('Circular sequel reference detected');
  }

  // Update sequel_of array on the sequel project
  const currentSequelOf = (sequelProject.sequel_of as string[]) ?? [];
  if (!currentSequelOf.includes(parentProjectId)) {
    await supabase
      .from('projects')
      .update({
        sequel_of: [...currentSequelOf, parentProjectId],
      })
      .eq('id', sequelProjectId);
  }

  // Build and cache parent context
  const parentContext = await buildParentContext(
    parentProjectId,
    parentProject.name,
  );

  // Upsert the cached context
  await supabase.from('sequel_parent_contexts').upsert({
    sequel_project_id: sequelProjectId,
    parent_project_id: parentProjectId,
    parent_project_name: parentProject.name,
    parent_summary: parentContext.parentSummary,
    parent_immutable_events: toJsonb(parentContext.immutableEvents),
    parent_final_character_states: toJsonb(parentContext.finalCharacterStates),
    parent_resolved_threads: toJsonb(parentContext.resolvedThreads),
    parent_world_facts: toJsonb(parentContext.worldFacts),
    character_visual_registry: toJsonb(parentContext.characterVisualRegistry),
    location_registry: toJsonb(parentContext.locationRegistry),
    cached_at: new Date().toISOString(),
    is_stale: false,
  });

  return parentContext;
}

// =============================================================================
// BUILD PARENT CONTEXT — Aggregate canon from parent project
// =============================================================================

interface ImmutableEventRow {
  event_key: string;
  event_type: string;
  description: string;
}

interface ResolvedThreadRow {
  thread_name: string;
  description: string | null;
}

interface WorldStateRow {
  location: string;
  environment_data: Record<string, unknown> | null;
}

interface CharacterStateRow {
  character_id: string;
  state_value: Record<string, unknown>;
  state_type: string;
  created_at: string;
  episode_id: string;
}

interface AssetRow {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
}

interface EpisodeSummaryRow {
  plot_summary: string;
}

/**
 * Build a ParentContext by aggregating canon data from a parent project.
 * Queries immutable events, latest character states, resolved threads,
 * and world states from the parent.
 */
export async function buildParentContext(
  parentProjectId: string,
  parentProjectName: string,
): Promise<ParentContext> {
  const supabase = getSupabaseServerClient();

  // Fetch all independent project-level data in parallel
  const [
    { data: rawImmutableEvents },
    { data: rawResolvedThreads },
    { data: rawWorldStates },
    { data: episodes },
  ] = await Promise.all([
    supabase
      .from('immutable_events')
      .select('event_key, event_type, description')
      .eq('project_id', parentProjectId),
    supabase
      .from('narrative_threads')
      .select('thread_name, description')
      .eq('project_id', parentProjectId)
      .eq('status', 'resolved'),
    supabase
      .from('world_states')
      .select('location, environment_data')
      .eq('project_id', parentProjectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('episodes')
      .select('id')
      .eq('project_id', parentProjectId),
  ]);

  const immutableEvents = (rawImmutableEvents ?? []) as ImmutableEventRow[];
  const resolvedThreads = (rawResolvedThreads ?? []) as ResolvedThreadRow[];
  const worldStates = (rawWorldStates ?? []) as WorldStateRow[];
  const episodeIds = (episodes ?? []).map((e) => e.id);

  // Fetch episode-dependent data in parallel
  let characterStates: CharacterStateRow[] = [];
  if (episodeIds.length > 0) {
    const { data: rawCharStates } = await supabase
      .from('character_states')
      .select('character_id, state_value, state_type, created_at, episode_id')
      .in('episode_id', episodeIds)
      .order('created_at', { ascending: false });
    characterStates = (rawCharStates ?? []) as CharacterStateRow[];
  }

  // Deduplicate character states — keep the latest per character
  const latestCharacterStates = deduplicateCharacterStates(characterStates);

  // Fetch character assets for name/visual info
  const characterIds = latestCharacterStates.map((cs) => cs.character_id);
  let characterAssets: AssetRow[] = [];
  if (characterIds.length > 0) {
    const { data: rawAssets } = await supabase
      .from('assets')
      .select('id, name, metadata')
      .in('id', characterIds);
    characterAssets = (rawAssets ?? []) as AssetRow[];
  }

  const characterMap = new Map(characterAssets.map((a) => [a.id, a]));

  // Build character visual registry
  const characterVisualRegistry: Record<string, CharacterVisualRef> = {};
  for (const asset of characterAssets) {
    characterVisualRegistry[asset.id] = {
      characterName: asset.name,
      visualDescription:
        (asset.metadata?.visualDescription as string) ?? asset.name,
      assetId: asset.id,
    };
  }

  // Build location registry from world states
  const locationRegistry: LocationRef[] = [];
  const seenLocations = new Set<string>();
  for (const ws of worldStates) {
    if (!seenLocations.has(ws.location)) {
      seenLocations.add(ws.location);
      locationRegistry.push({
        locationName: ws.location,
        visualDescription:
          (ws.environment_data?.visualDescription as string) ?? ws.location,
      });
    }
  }

  // Build final character states
  // Use immutable_events as source of truth for character deaths (PR #177 review)
  const finalCharStates: ParentCharacterState[] = latestCharacterStates.map(
    (cs) => {
      const asset = characterMap.get(cs.character_id);
      const isDead = immutableEvents.some(
        (e) =>
          e.event_type === 'death' && e.event_key.includes(cs.character_id),
      );

      return {
        characterId: cs.character_id,
        characterName: asset?.name ?? 'Unknown',
        isAlive: !isDead,
        finalEmotionalState:
          (cs.state_value?.emotionalState as string) ?? 'neutral',
        finalLocation: (cs.state_value?.location as string) ?? 'unknown',
        knownFacts: (cs.state_value?.knownFacts as string[]) ?? [],
      };
    },
  );

  // Build episode summary from episode_summaries table
  let summaryRows: EpisodeSummaryRow[] = [];
  if (episodeIds.length > 0) {
    const { data: rawSummaries } = await supabase
      .from('episode_summaries')
      .select('plot_summary')
      .in('episode_id', episodeIds)
      .order('created_at', { ascending: true });
    summaryRows = (rawSummaries ?? []) as EpisodeSummaryRow[];
  }

  const parentSummary = summaryRows.map((s) => s.plot_summary).join(' ');

  return {
    parentProjectId,
    parentProjectName,
    parentSummary: parentSummary || 'No summary available',
    immutableEvents: immutableEvents.map((e) => ({
      eventKey: e.event_key,
      eventType: e.event_type,
      description: e.description,
    })),
    finalCharacterStates: finalCharStates,
    resolvedThreads: resolvedThreads.map((t) => ({
      threadName: t.thread_name,
      resolution: t.description ?? '',
    })),
    worldFacts: immutableEvents
      .filter((e) => e.event_type === 'world_fact')
      .map((e) => ({
        factKey: e.event_key,
        description: e.description,
      })),
    characterVisualRegistry,
    locationRegistry,
  };
}

// =============================================================================
// GET CACHED PARENT CONTEXTS — For use during generation
// =============================================================================

interface SequelParentRow {
  parent_project_id: string;
  parent_project_name: string;
  parent_summary: string;
  parent_immutable_events: ParentImmutableEvent[];
  parent_final_character_states: ParentCharacterState[];
  parent_resolved_threads: ParentResolvedThread[];
  parent_world_facts: ParentWorldFact[];
  character_visual_registry: Record<string, CharacterVisualRef>;
  location_registry: LocationRef[];
}

/**
 * Fetch cached parent contexts for a sequel project.
 * Returns empty array for non-sequels.
 */
export async function getSequelParentContexts(
  sequelProjectId: string,
): Promise<ParentContext[]> {
  const supabase = getSupabaseServerClient();

  // Fetch cached parent contexts
  const { data } = await supabase
    .from('sequel_parent_contexts')
    .select('parent_project_id, parent_project_name, parent_summary, parent_immutable_events, parent_final_character_states, parent_resolved_threads, parent_world_facts, character_visual_registry, location_registry')
    .eq('sequel_project_id', sequelProjectId)
    .eq('is_stale', false);

  if (!data || data.length === 0) return [];

  return (data as unknown as SequelParentRow[]).map(
    (row) =>
      ({
        parentProjectId: row.parent_project_id,
        parentProjectName: row.parent_project_name ?? '',
        parentSummary: row.parent_summary,
        immutableEvents: row.parent_immutable_events,
        finalCharacterStates: row.parent_final_character_states,
        resolvedThreads: row.parent_resolved_threads,
        worldFacts: row.parent_world_facts,
        characterVisualRegistry: row.character_visual_registry,
        locationRegistry: row.location_registry,
      }) satisfies ParentContext,
  );
}

// =============================================================================
// FORMAT FOR PROMPT — Structured text for LLM injection
// =============================================================================

/**
 * Format parent contexts into structured text for LLM prompt injection.
 * Produces sections: deceased characters, returning characters,
 * inherited world rules, and resolved plot threads.
 */

export function formatParentContextsForPrompt(
  contexts: ParentContext[],
): string {
  if (contexts.length === 0) return '';

  const sections: string[] = [];

  sections.push('# INHERITED CANON FROM PARENT MOVIE(S)');

  for (const ctx of contexts) {
    const header = ctx.parentProjectName
      ? `## FROM: "${sanitizeForPrompt(ctx.parentProjectName)}"`
      : '## FROM PARENT MOVIE';
    sections.push(header);
    sections.push('');

    if (ctx.parentSummary) {
      sections.push(`### Summary`);
      sections.push(sanitizeForPrompt(ctx.parentSummary));
      sections.push('');
    }

    // Deceased characters — absolute constraint
    const deceased = ctx.finalCharacterStates.filter((c) => !c.isAlive);
    if (deceased.length > 0) {
      sections.push('### DECEASED CHARACTERS (MUST NOT APPEAR AS ALIVE)');
      for (const c of deceased) {
        sections.push(`• ${sanitizeForPrompt(c.characterName)} - DEAD`);
      }
      sections.push('');
    }

    // Returning characters
    const alive = ctx.finalCharacterStates.filter((c) => c.isAlive);
    if (alive.length > 0) {
      sections.push('### RETURNING CHARACTERS (Available for sequel)');
      for (const c of alive) {
        sections.push(
          `• ${sanitizeForPrompt(c.characterName)}: ${sanitizeForPrompt(c.finalEmotionalState)} (last seen at ${sanitizeForPrompt(c.finalLocation)})`,
        );
      }
      sections.push('');
    }

    // World rules
    if (ctx.worldFacts.length > 0) {
      sections.push('### ESTABLISHED WORLD RULES');
      for (const f of ctx.worldFacts) {
        sections.push(`• ${sanitizeForPrompt(f.description)}`);
      }
      sections.push('');
    }

    // Resolved threads
    if (ctx.resolvedThreads.length > 0) {
      sections.push('### RESOLVED THREADS (DO NOT REOPEN)');
      for (const t of ctx.resolvedThreads) {
        sections.push(
          `• ${sanitizeForPrompt(t.threadName)}: ${sanitizeForPrompt(t.resolution)}`,
        );
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}

// =============================================================================
// UTILS
// =============================================================================

/**
 * Deduplicate character states — keep the latest per character.
 * Assumes rows are already ordered by created_at DESC.
 */
function deduplicateCharacterStates(
  rows: CharacterStateRow[],
): CharacterStateRow[] {
  const seen = new Set<string>();
  const result: CharacterStateRow[] = [];

  for (const row of rows) {
    if (!seen.has(row.character_id)) {
      seen.add(row.character_id);
      result.push(row);
    }
  }

  return result;
}
