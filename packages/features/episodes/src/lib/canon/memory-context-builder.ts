/**
 * Memory Context Builder
 * Phase 10: FILM-1004, content types: FILM-1110
 *
 * Builds token-budgeted context from canon data for LLM generation. The
 * budget, its split and the episode horizon follow the project's type
 * (`projects.metadata.projectType`).
 *
 * The Supabase client is injected, never imported: this module is loaded by
 * the LLM Lambda, where the Next.js cookie client's `server-only` guard
 * throws at import. Callers pass the user's client in Next.js and the
 * worker's own client in the Lambda.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';
import type { Database } from '@kit/supabase/database';
import type { createLambdaAdminClient } from '@kit/supabase/lambda-admin-client';

import {
  type ProjectTypeSource,
  resolveProjectType,
} from './content-type-configs';
import {
  resolveMemoryHorizon,
  savedMemoryHorizonOverride,
} from './memory-horizon';
import {
  type MemoryAllocation,
  getMemoryOptionsForContentType,
} from './memory-strategies';
import type {
  BuildMemoryContextInput,
  CharacterState,
  CharacterStateContext,
  CharacterStateType,
  CharacterStateValue,
  EpisodeSummary,
  ImmutableEvent,
  ImmutableEventType,
  MemoryBudgets,
  MemoryContext,
  NarrativeThread,
  NarrativeThreadStatus,
  NarrativeThreadType,
  TokenBudget,
  WorldState,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * The client the builder reads canon with. Only `from` is used, so the
 * Next.js user client, the Lambda's service-role client and a test fake all
 * satisfy it.
 */
export type CanonReadClient = Pick<
  NonNullable<ReturnType<typeof createLambdaAdminClient<Database>>>,
  'from'
>;

const DEFAULT_TOKEN_BUDGET_PERCENT = 15;
const DEFAULT_CONTEXT_WINDOW_SIZE = 40000;

/**
 * Default token budget max (exported for UI consistency)
 * Computed as: DEFAULT_CONTEXT_WINDOW_SIZE * (DEFAULT_TOKEN_BUDGET_PERCENT / 100)
 */
export const DEFAULT_TOKEN_BUDGET_MAX = Math.floor(
  DEFAULT_CONTEXT_WINDOW_SIZE * (DEFAULT_TOKEN_BUDGET_PERCENT / 100),
); // 6000 tokens

// Rough token estimation: ~4 characters per token
const CHARS_PER_TOKEN = 4;

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Estimates token count for a given object.
 * Uses rough approximation of 4 characters per token.
 */
function estimateTokens(data: unknown): number {
  if (!data) return 0;
  const json = JSON.stringify(data);
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}

/**
 * Truncates text to fit within token budget.
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

// =============================================================================
// DATA LOADING FUNCTIONS
// =============================================================================

/**
 * Loads immutable events for a project.
 */
async function loadImmutableEvents(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<ImmutableEvent[]> {
  const { data, error } = await client
    .from('immutable_events')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error loading immutable events:', error);
    return [];
  }

  // Prioritize by recency and importance
  const events: ImmutableEvent[] = (data ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type as ImmutableEventType,
    eventKey: row.event_key,
    establishedIn: row.established_in,
    season: row.season,
    episodeNumber: row.episode_number,
    description: row.description,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    createdBy: row.created_by ?? undefined,
  }));

  // Fit within budget
  let currentTokens = 0;
  const result: ImmutableEvent[] = [];

  for (const event of events) {
    const tokens = estimateTokens(event);
    if (currentTokens + tokens > tokenBudget) break;
    result.push(event);
    currentTokens += tokens;
  }

  return result;
}

/**
 * Loads latest character states for a project.
 * Gets most recent state per character per state type.
 */
async function loadCharacterStates(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<CharacterStateContext[]> {
  // Get characters for this project
  const { data: assets, error: assetsError } = await client
    .from('assets')
    .select('id, name')
    .eq('project_id', projectId)
    .eq('type', 'character');

  if (assetsError) {
    console.error('Error loading character assets:', assetsError);
    return [];
  }

  if (!assets || assets.length === 0) {
    return [];
  }

  // Batch-fetch all character states in a single query
  const assetIds = assets.map((a) => a.id);

  const { data: allStates, error: statesError } = await client
    .from('character_states')
    .select('*')
    .in('character_id', assetIds)
    .order('created_at', { ascending: false });

  if (statesError) {
    console.error('Error loading character states:', statesError);
    return [];
  }

  // Group states by character_id, keeping at most 10 per character
  const statesByCharacter = new Map<string, typeof allStates>();

  for (const state of allStates ?? []) {
    const existing = statesByCharacter.get(state.character_id) ?? [];
    if (existing.length < 10) {
      existing.push(state);
      statesByCharacter.set(state.character_id, existing);
    }
  }

  const characterContexts: CharacterStateContext[] = [];
  let currentTokens = 0;

  for (const asset of assets) {
    const states = statesByCharacter.get(asset.id) ?? [];

    const currentStates: CharacterState[] = states.map((row) => ({
      id: row.id,
      characterId: row.character_id,
      episodeId: row.episode_id,
      stateType: row.state_type as CharacterStateType,
      stateValue: row.state_value as CharacterStateValue,
      triggerEvent: row.trigger_event,
      cost: row.cost ?? undefined,
      newConstraints: row.new_constraints ?? undefined,
      previousStateId: row.previous_state_id ?? undefined,
      createdAt: row.created_at ?? new Date().toISOString(),
      createdBy: row.created_by ?? undefined,
    }));

    // Collect constraints from all states
    const constraints = currentStates
      .flatMap((s) => s.newConstraints ?? [])
      .filter(Boolean);

    const context: CharacterStateContext = {
      characterId: asset.id,
      characterName: asset.name,
      currentStates,
      constraints,
    };

    const tokens = estimateTokens(context);
    if (currentTokens + tokens > tokenBudget) break;

    characterContexts.push(context);
    currentTokens += tokens;
  }

  return characterContexts;
}

/**
 * Loads current world state for a project.
 */
async function loadWorldState(
  client: CanonReadClient,
  projectId: string,
  episodeId: string | null,
  tokenBudget: number,
): Promise<WorldState | undefined> {
  let query = client
    .from('world_states')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (episodeId) {
    query = query.eq('episode_id', episodeId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return undefined;
  }

  const worldState: WorldState = {
    id: data.id,
    projectId: data.project_id,
    episodeId: data.episode_id,
    location: data.location,
    timePeriod: data.time_period ?? undefined,
    activeConflicts: data.active_conflicts ?? undefined,
    atmosphere: data.atmosphere ?? undefined,
    constraints: data.constraints ?? undefined,
    environmentData:
      (data.environment_data as Record<string, unknown>) ?? undefined,
    createdAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };

  // Check budget
  if (estimateTokens(worldState) > tokenBudget) {
    // Truncate description fields if needed
    if (worldState.atmosphere) {
      worldState.atmosphere = truncateToTokenBudget(
        worldState.atmosphere,
        Math.floor(tokenBudget / 3),
      );
    }
  }

  return worldState;
}

/**
 * Loads active narrative threads for a project.
 */
async function loadActiveThreads(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<NarrativeThread[]> {
  const { data, error } = await client
    .from('narrative_threads')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['open', 'progressed'])
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error loading narrative threads:', error);
    return [];
  }

  const threads: NarrativeThread[] = (data ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    threadName: row.thread_name,
    threadType: (row.thread_type ?? 'plot') as NarrativeThreadType,
    status: (row.status ?? 'open') as NarrativeThreadStatus,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at ?? undefined,
    episodesTouched: row.episodes_touched ?? undefined,
    promises: row.promises ?? undefined,
    payoffs: row.payoffs ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }));

  // Fit within budget
  let currentTokens = 0;
  const result: NarrativeThread[] = [];

  for (const thread of threads) {
    const tokens = estimateTokens(thread);
    if (currentTokens + tokens > tokenBudget) break;
    result.push(thread);
    currentTokens += tokens;
  }

  return result;
}

/**
 * Loads episode summaries within memory horizon.
 */
async function loadEpisodeSummaries(
  client: CanonReadClient,
  projectId: string,
  currentEpisodeNumber: number,
  memoryHorizon: number,
  tokenBudget: number,
): Promise<EpisodeSummary[]> {
  // Get episodes within horizon
  const startEpisode = Math.max(1, currentEpisodeNumber - memoryHorizon);

  const { data: episodes, error: episodesError } = await client
    .from('episodes')
    .select('id')
    .eq('project_id', projectId)
    .gte('number', startEpisode)
    .lt('number', currentEpisodeNumber);

  if (episodesError || !episodes) {
    console.error('Error loading episodes for summaries:', episodesError);
    return [];
  }

  const episodeIds = episodes.map((e) => e.id);

  const { data, error } = await client
    .from('episode_summaries')
    .select('*')
    .in('episode_id', episodeIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading episode summaries:', error);
    return [];
  }

  const summaries: EpisodeSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    episodeId: row.episode_id,
    plotSummary: row.plot_summary,
    keyEvents: row.key_events ?? undefined,
    characterChanges: row.character_changes ?? undefined,
    newConstraints: row.new_constraints ?? undefined,
    sentimentScore: row.sentiment_score ?? undefined,
    estimatedTokens: row.estimated_tokens ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }));

  // Fit within budget
  let currentTokens = 0;
  const result: EpisodeSummary[] = [];

  for (const summary of summaries) {
    const tokens = estimateTokens(summary);
    if (currentTokens + tokens > tokenBudget) break;
    result.push(summary);
    currentTokens += tokens;
  }

  return result;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/** `projects.metadata.canon`, the saved Canon settings. */
function readCanon(metadata: unknown): unknown {
  return metadata && typeof metadata === 'object' && 'canon' in metadata
    ? metadata.canon
    : undefined;
}

/**
 * Per-category token budgets for a total and an allocation (percentages).
 * Categories the builder does not fill yet (`parentContext`,
 * `sourcesCitations`) are still computed, so their reserve is visible.
 */
export function allocateTokenBudget(
  total: number,
  allocation: MemoryAllocation,
): MemoryBudgets {
  const share = (percent: number) => Math.floor((total * percent) / 100);

  return {
    immutableEvents: share(allocation.immutableEvents),
    characterStates: share(allocation.characterStates),
    worldStates: share(allocation.worldStates),
    narrativeThreads: share(allocation.narrativeThreads),
    episodeSummaries: share(allocation.episodeSummaries),
    parentContext: share(allocation.parentContext),
    sourcesCitations: share(allocation.sourcesCitations),
  };
}

/**
 * Builds memory context for LLM generation.
 *
 * The project's type (read from `projects.metadata`) decides the total
 * budget (`contextWindowPercent` of the context window), its split
 * (`MEMORY_ALLOCATIONS`) and the horizon, unless the caller overrides them.
 *
 * @param client - Supabase client to read canon with (see `CanonReadClient`)
 * @param input - Build context parameters
 * @returns MemoryContext with token budget tracking
 */
export async function buildMemoryContext(
  client: CanonReadClient,
  input: BuildMemoryContextInput,
): Promise<MemoryContext> {
  const { projectId, episodeNumber } = input;

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) {
    console.error('Error loading project metadata:', projectError);
  }

  const resolvedType: {
    projectType: ProjectType;
    source: ProjectTypeSource;
  } = input.projectType
    ? { projectType: input.projectType, source: 'argument' }
    : resolveProjectType(project?.metadata);

  const options = getMemoryOptionsForContentType(resolvedType.projectType);

  const tokenBudgetPercent =
    input.tokenBudgetPercent ?? options.maxTokenPercentage;

  const maxTokens = Math.floor(
    DEFAULT_CONTEXT_WINDOW_SIZE * (tokenBudgetPercent / 100),
  );

  const { memoryHorizon, source: memoryHorizonSource } = resolveMemoryHorizon({
    argument: input.memoryHorizon,
    canonOverride: savedMemoryHorizonOverride(readCanon(project?.metadata)),
    contentType: options.memoryHorizon,
  });

  const budgets = allocateTokenBudget(maxTokens, options.allocation);

  // Load all data in parallel
  const [immutableEvents, characterStates, activeThreads, recentSummaries] =
    await Promise.all([
      loadImmutableEvents(client, projectId, budgets.immutableEvents),
      loadCharacterStates(client, projectId, budgets.characterStates),
      loadActiveThreads(client, projectId, budgets.narrativeThreads),
      loadEpisodeSummaries(
        client,
        projectId,
        episodeNumber,
        memoryHorizon,
        budgets.episodeSummaries,
      ),
    ]);

  // Load world state (depends on having recent summaries)
  const latestEpisodeId = recentSummaries[0]?.episodeId ?? null;
  const worldState = await loadWorldState(
    client,
    projectId,
    latestEpisodeId,
    budgets.worldStates,
  );

  // Calculate actual token usage
  const actualUsage = {
    immutableEvents: estimateTokens(immutableEvents),
    characterStates: estimateTokens(characterStates),
    worldStates: estimateTokens(worldState),
    narrativeThreads: estimateTokens(activeThreads),
    episodeSummaries: estimateTokens(recentSummaries),
  };

  const totalUsed = Object.values(actualUsage).reduce((a, b) => a + b, 0);

  const tokenBudget: TokenBudget = {
    total: maxTokens,
    allocated: totalUsed,
    remaining: maxTokens - totalUsed,
    byCategory: actualUsage,
  };

  console.info(
    `[MemoryContext] project=${projectId}` +
      ` type=${resolvedType.projectType}(${resolvedType.source})` +
      ` budget=${maxTokens} horizon=${memoryHorizon}(${memoryHorizonSource})` +
      ` events=${immutableEvents.length} characters=${characterStates.length}` +
      ` threads=${activeThreads.length} summaries=${recentSummaries.length}` +
      ` world=${worldState ? 1 : 0} tokens=${totalUsed}`,
  );

  return {
    projectId,
    episodeNumber,
    tokenBudget,
    immutableEvents,
    characterStates,
    activeThreads,
    recentSummaries,
    worldState,
    metadata: {
      builtAt: new Date().toISOString(),
      projectType: resolvedType.projectType,
      projectTypeSource: resolvedType.source,
      memoryHorizon,
      memoryHorizonSource,
      budgets,
      totalTokensUsed: totalUsed,
    },
  };
}

/**
 * Formats memory context for LLM prompt injection.
 * Returns a structured string suitable for system/user prompts.
 */
export function formatMemoryContextForPrompt(context: MemoryContext): string {
  const sections: string[] = [];

  // Immutable Events
  if (context.immutableEvents.length > 0) {
    sections.push('## IMMUTABLE CANON (Cannot be contradicted)');
    for (const event of context.immutableEvents) {
      sections.push(
        `- [${event.eventType.toUpperCase()}] ${event.description}`,
      );
    }
    sections.push('');
  }

  // Active Threads
  if (context.activeThreads.length > 0) {
    sections.push('## ACTIVE NARRATIVE THREADS');
    for (const thread of context.activeThreads) {
      const promises = thread.promises?.join(', ') ?? 'none';
      sections.push(
        `- ${thread.threadName} (${thread.threadType}): ${thread.status}. Promises: ${promises}`,
      );
    }
    sections.push('');
  }

  // Character States
  if (context.characterStates.length > 0) {
    sections.push('## CHARACTER STATES');
    for (const char of context.characterStates) {
      const constraints =
        char.constraints.length > 0
          ? ` [Constraints: ${char.constraints.join(', ')}]`
          : '';
      const stateDesc = char.currentStates
        .slice(0, 3)
        .map((s) => `${s.stateType}: ${JSON.stringify(s.stateValue)}`)
        .join('; ');
      sections.push(`- ${char.characterName}: ${stateDesc}${constraints}`);
    }
    sections.push('');
  }

  // World State
  if (context.worldState) {
    sections.push('## WORLD STATE');
    sections.push(`Location: ${context.worldState.location}`);
    if (context.worldState.atmosphere) {
      sections.push(`Atmosphere: ${context.worldState.atmosphere}`);
    }
    if (context.worldState.activeConflicts?.length) {
      sections.push(
        `Active Conflicts: ${context.worldState.activeConflicts.join(', ')}`,
      );
    }
    sections.push('');
  }

  // Recent Episode Summaries
  if (context.recentSummaries.length > 0) {
    sections.push('## RECENT EPISODE SUMMARIES');
    for (const summary of context.recentSummaries) {
      sections.push(`- ${summary.plotSummary}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
