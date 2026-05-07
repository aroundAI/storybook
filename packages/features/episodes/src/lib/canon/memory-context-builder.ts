/**
 * Memory Context Builder
 * Phase 10: FILM-1004
 *
 * Builds token-budgeted context from canon data for LLM generation.
 * 15% of total token budget by default.
 */
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  BuildMemoryContextInput,
  CharacterState,
  CharacterStateContext,
  CharacterStateType,
  CharacterStateValue,
  EpisodeSummary,
  ImmutableEvent,
  ImmutableEventType,
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

const DEFAULT_TOKEN_BUDGET_PERCENT = 15;
const DEFAULT_CONTEXT_WINDOW_SIZE = 40000;
const DEFAULT_MEMORY_HORIZON = 10;

/**
 * Default token budget max (exported for UI consistency)
 * Computed as: DEFAULT_CONTEXT_WINDOW_SIZE * (DEFAULT_TOKEN_BUDGET_PERCENT / 100)
 */
export const DEFAULT_TOKEN_BUDGET_MAX = Math.floor(
  DEFAULT_CONTEXT_WINDOW_SIZE * (DEFAULT_TOKEN_BUDGET_PERCENT / 100),
); // 6000 tokens

// Token budget allocation percentages
const BUDGET_ALLOCATION = {
  immutableEvents: 0.35, // 35% - always included
  characterStates: 0.25, // 25% - current character states
  worldStates: 0.1, // 10% - world state
  narrativeThreads: 0.15, // 15% - active threads
  episodeSummaries: 0.15, // 15% - episode summaries
};

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
  projectId: string,
  tokenBudget: number,
): Promise<ImmutableEvent[]> {
  const client = getSupabaseServerClient();

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
  projectId: string,
  tokenBudget: number,
): Promise<CharacterStateContext[]> {
  const client = getSupabaseServerClient();

  // Get characters for this project
  const { data: assets, error: assetsError } = await client
    .from('assets')
    .select('id, name')
    .eq('project_id', projectId)
    .eq('asset_type', 'character');

  if (assetsError || !assets) {
    console.error('Error loading character assets:', assetsError);
    return [];
  }

  const characterContexts: CharacterStateContext[] = [];
  let currentTokens = 0;

  for (const asset of assets) {
    // Get latest states for this character
    const { data: states, error: statesError } = await client
      .from('character_states')
      .select('*')
      .eq('character_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(10); // Get last 10 state changes

    if (statesError) continue;

    const currentStates: CharacterState[] = (states ?? []).map((row) => ({
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
  projectId: string,
  episodeId: string | null,
  tokenBudget: number,
): Promise<WorldState | undefined> {
  const client = getSupabaseServerClient();

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
  projectId: string,
  tokenBudget: number,
): Promise<NarrativeThread[]> {
  const client = getSupabaseServerClient();

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
  projectId: string,
  currentEpisodeNumber: number,
  memoryHorizon: number,
  tokenBudget: number,
): Promise<EpisodeSummary[]> {
  const client = getSupabaseServerClient();

  // Get episodes within horizon
  const startEpisode = Math.max(1, currentEpisodeNumber - memoryHorizon);

  const { data: episodes, error: episodesError } = await client
    .from('episodes')
    .select('id')
    .eq('project_id', projectId)
    .gte('episode_number', startEpisode)
    .lt('episode_number', currentEpisodeNumber);

  if (episodesError || !episodes) {
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

/**
 * Builds memory context for LLM generation.
 *
 * Token budget is limited to 15% of context window by default.
 * Memory horizon determines how many past episodes to include.
 *
 * @param input - Build context parameters
 * @returns MemoryContext with token budget tracking
 */
export async function buildMemoryContext(
  input: BuildMemoryContextInput,
): Promise<MemoryContext> {
  const {
    projectId,
    episodeNumber,
    tokenBudgetPercent = DEFAULT_TOKEN_BUDGET_PERCENT,
    memoryHorizon: memoryHorizonOverride,
    projectType,
  } = input;

  const maxTokens = Math.floor(
    DEFAULT_CONTEXT_WINDOW_SIZE * (tokenBudgetPercent / 100),
  );

  // Use content-type-specific allocations when a projectType is provided,
  // otherwise fall back to the hardcoded defaults for backward compatibility.
  let allocation: {
    immutableEvents: number;
    characterStates: number;
    worldStates: number;
    narrativeThreads: number;
    episodeSummaries: number;
  };
  let memoryHorizon: number;

  if (projectType) {
    const { getMemoryOptionsForContentType } = await import(
      './memory-strategies'
    );
    const options = getMemoryOptionsForContentType(projectType);
    allocation = {
      immutableEvents: options.allocation.immutableEvents / 100,
      characterStates: options.allocation.characterStates / 100,
      worldStates: options.allocation.worldStates / 100,
      narrativeThreads: options.allocation.narrativeThreads / 100,
      episodeSummaries: options.allocation.episodeSummaries / 100,
    };
    memoryHorizon = memoryHorizonOverride ?? options.memoryHorizon;
  } else {
    allocation = BUDGET_ALLOCATION;
    memoryHorizon = memoryHorizonOverride ?? DEFAULT_MEMORY_HORIZON;
  }

  // Calculate per-category budgets
  const budgets = {
    immutableEvents: Math.floor(maxTokens * allocation.immutableEvents),
    characterStates: Math.floor(maxTokens * allocation.characterStates),
    worldStates: Math.floor(maxTokens * allocation.worldStates),
    narrativeThreads: Math.floor(maxTokens * allocation.narrativeThreads),
    episodeSummaries: Math.floor(maxTokens * allocation.episodeSummaries),
  };

  // Load all data in parallel
  const [immutableEvents, characterStates, activeThreads, recentSummaries] =
    await Promise.all([
      loadImmutableEvents(projectId, budgets.immutableEvents),
      loadCharacterStates(projectId, budgets.characterStates),
      loadActiveThreads(projectId, budgets.narrativeThreads),
      loadEpisodeSummaries(
        projectId,
        episodeNumber,
        memoryHorizon,
        budgets.episodeSummaries,
      ),
    ]);

  // Load world state (depends on having recent summaries)
  const latestEpisodeId = recentSummaries[0]?.episodeId ?? null;
  const worldState = await loadWorldState(
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
      memoryHorizon,
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
