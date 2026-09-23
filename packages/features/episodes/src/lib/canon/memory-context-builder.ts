/**
 * Memory Context Builder
 * Phase 10: FILM-1004, content types: FILM-1110, strategies: FILM-1111
 *
 * Builds token-budgeted context from canon data for LLM generation. The
 * budget, its split and the episode horizon follow the project's type
 * (`projects.metadata.projectType`). Within each budget, threads, characters
 * and summaries are ordered by the type's priority score (`rankByPriority`),
 * so what a full budget cuts is the least recently active canon (immutable
 * events are never ranked — see `loadImmutableEvents`); types with
 * a source budget also load the project's verified facts.
 *
 * The Supabase client is injected, never imported: this module is loaded by
 * the LLM Lambda, where the Next.js cookie client's `server-only` guard
 * throws at import. Callers pass the user's client in Next.js and the
 * worker's own client in the Lambda.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
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
  rankByPriority,
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
  SourceCitation,
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

type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

/**
 * Keeps items in order until the next one would overflow the budget.
 * Callers pass items already in priority order, so what is cut is the tail.
 */
function fitToBudget<T>(items: T[], tokenBudget: number): T[] {
  let currentTokens = 0;
  const result: T[] = [];

  for (const item of items) {
    const tokens = estimateTokens(item);
    if (currentTokens + tokens > tokenBudget) break;
    result.push(item);
    currentTokens += tokens;
  }

  return result;
}

/**
 * Loads immutable events for a project, oldest first.
 *
 * Every row is read (paged): past PostgREST's 1,000-row cap the newest
 * events would otherwise never be considered. Events are never ranked by
 * decay — CANON_001 reads deaths from this list, and an early death must
 * not age out of it (owner decision D1, FILM-1111).
 */
async function loadImmutableEvents(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<ImmutableEvent[]> {
  if (tokenBudget <= 0) return [];

  let rows: Row<'immutable_events'>[];

  try {
    rows = await fetchAllRows<Row<'immutable_events'>>(
      (from, to) =>
        client
          .from('immutable_events')
          .select('*')
          .eq('project_id', projectId)
          .order('id')
          .range(from, to),
      'immutable_events',
    );
  } catch (error) {
    console.error('Error loading immutable events:', error);
    return [];
  }

  rows.sort(
    (a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id),
  );

  const events: ImmutableEvent[] = rows.map((row) => ({
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

  return fitToBudget(events, tokenBudget);
}

/**
 * Loads every character of a project with its latest states (at most 10
 * per character, newest first). Ranking and fitting happen in the caller,
 * once the states' episode numbers are known.
 */
async function loadCharacters(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<CharacterStateContext[]> {
  if (tokenBudget <= 0) return [];

  let assets: Array<Pick<Row<'assets'>, 'id' | 'name'>>;

  try {
    assets = await fetchAllRows<Pick<Row<'assets'>, 'id' | 'name'>>(
      (from, to) =>
        client
          .from('assets')
          .select('id, name')
          .eq('project_id', projectId)
          .eq('type', 'character')
          .order('id')
          .range(from, to),
      'assets',
    );
  } catch (error) {
    console.error('Error loading character assets:', error);
    return [];
  }

  if (assets.length === 0) {
    return [];
  }

  let allStates: Row<'character_states'>[];

  try {
    allStates = await fetchAllByIds<Row<'character_states'>>(
      assets.map((a) => a.id),
      (chunk, from, to) =>
        client
          .from('character_states')
          .select('*')
          .in('character_id', chunk)
          .order('id')
          .range(from, to),
      'character_states',
    );
  } catch (error) {
    console.error('Error loading character states:', error);
    return [];
  }

  allStates.sort(
    (a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
      b.id.localeCompare(a.id),
  );

  // Group states by character_id, keeping at most 10 per character
  const statesByCharacter = new Map<string, Row<'character_states'>[]>();

  for (const state of allStates) {
    const existing = statesByCharacter.get(state.character_id) ?? [];
    if (existing.length < 10) {
      existing.push(state);
      statesByCharacter.set(state.character_id, existing);
    }
  }

  return assets.map((asset) => {
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

    return {
      characterId: asset.id,
      characterName: asset.name,
      currentStates,
      constraints,
    };
  });
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
  if (tokenBudget <= 0) return undefined;

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
 * Loads every open or progressed narrative thread of a project (paged).
 * Ranking and fitting happen in the caller.
 */
async function loadActiveThreads(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<NarrativeThread[]> {
  if (tokenBudget <= 0) return [];

  let rows: Row<'narrative_threads'>[];

  try {
    rows = await fetchAllRows<Row<'narrative_threads'>>(
      (from, to) =>
        client
          .from('narrative_threads')
          .select('*')
          .eq('project_id', projectId)
          .in('status', ['open', 'progressed'])
          .order('id')
          .range(from, to),
      'narrative_threads',
    );
  } catch (error) {
    console.error('Error loading narrative threads:', error);
    return [];
  }

  return rows.map((row) => ({
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
}

/**
 * Loads episode summaries within memory horizon, ranked by recency for the
 * project's type.
 */
async function loadEpisodeSummaries(
  client: CanonReadClient,
  projectId: string,
  projectType: ProjectType,
  currentEpisodeNumber: number,
  memoryHorizon: number,
  tokenBudget: number,
): Promise<EpisodeSummary[]> {
  if (tokenBudget <= 0) return [];

  // Get episodes within horizon
  const startEpisode = Math.max(1, currentEpisodeNumber - memoryHorizon);

  const { data: episodes, error: episodesError } = await client
    .from('episodes')
    .select('id, number')
    .eq('project_id', projectId)
    .gte('number', startEpisode)
    .lt('number', currentEpisodeNumber);

  if (episodesError || !episodes) {
    console.error('Error loading episodes for summaries:', episodesError);
    return [];
  }

  const episodeNumbers = new Map(episodes.map((e) => [e.id, e.number]));

  const { data, error } = await client
    .from('episode_summaries')
    .select('*')
    .in('episode_id', [...episodeNumbers.keys()]);

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

  const ranked = rankByPriority(
    summaries.map((summary) => ({
      item: summary,
      id: summary.id,
      episode: episodeNumbers.get(summary.episodeId),
    })),
    currentEpisodeNumber,
    projectType,
  );

  return fitToBudget(
    ranked.map((r) => r.item),
    tokenBudget,
  );
}

/**
 * The most facts a source read considers. The smallest a loaded fact can
 * be is ~16 tokens (a uuid and a one-character claim as JSON), so 200 fill
 * a 3,200-token source budget — above every type's default (documentary
 * and news: 2,000). Because the server orders the facts, the first 200 are
 * exactly the ones a complete read would fit. A caller that raises
 * `tokenBudgetPercent` past that bound gets the top 200 by confidence.
 */
const SOURCE_CANDIDATE_LIMIT = 200;

/**
 * Loads the project's verified facts as sources, highest confidence first
 * (FILM-1111, owner decision D2). Unverified, disputed and retracted facts
 * are never loaded — the same rule `researcher.ts` and `fact-checker.ts`
 * apply. Types with no source budget issue no query.
 */
async function loadSources(
  client: CanonReadClient,
  projectId: string,
  tokenBudget: number,
): Promise<SourceCitation[]> {
  if (tokenBudget <= 0) return [];

  const { data, error } = await client
    .from('verified_facts')
    .select(
      'id, claim, source_citation, source_title, category, confidence_score',
    )
    .eq('project_id', projectId)
    .eq('verification_status', 'verified')
    .order('confidence_score', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(SOURCE_CANDIDATE_LIMIT);

  if (error) {
    console.error('Error loading verified facts:', error);
    return [];
  }

  const sources: SourceCitation[] = (data ?? []).map((row) => ({
    factId: row.id,
    claim: row.claim,
    citation: row.source_citation ?? undefined,
    sourceTitle: row.source_title ?? undefined,
    category: row.category ?? undefined,
    confidence: row.confidence_score ?? undefined,
  }));

  return fitToBudget(sources, tokenBudget);
}

/**
 * Project-wide episode numbers for the episode ids threads and character
 * states name. On failure every item ranks as "episode unknown": kept, last.
 */
async function resolveEpisodeNumbers(
  client: CanonReadClient,
  episodeIds: string[],
): Promise<Map<string, number>> {
  if (episodeIds.length === 0) return new Map();

  try {
    const rows = await fetchAllByIds<{ id: string; number: number }>(
      episodeIds,
      (chunk, from, to) =>
        client
          .from('episodes')
          .select('id, number')
          .in('id', chunk)
          .order('id')
          .range(from, to),
      'episodes',
    );

    return new Map(rows.map((row) => [row.id, row.number]));
  } catch (error) {
    console.error('Error resolving episode numbers:', error);
    return new Map();
  }
}

/** The latest of the given episodes, by number; undefined if none resolve */
function latestEpisode(
  episodeIds: string[],
  episodeNumbers: Map<string, number>,
): number | undefined {
  const numbers = episodeIds
    .map((id) => episodeNumbers.get(id))
    .filter((n): n is number => n !== undefined);

  return numbers.length > 0 ? Math.max(...numbers) : undefined;
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

  const { projectType } = resolvedType;

  // Load all data in parallel
  const [immutableEvents, characters, threads, recentSummaries, sources] =
    await Promise.all([
      loadImmutableEvents(client, projectId, budgets.immutableEvents),
      loadCharacters(client, projectId, budgets.characterStates),
      loadActiveThreads(client, projectId, budgets.narrativeThreads),
      loadEpisodeSummaries(
        client,
        projectId,
        projectType,
        episodeNumber,
        memoryHorizon,
        budgets.episodeSummaries,
      ),
      loadSources(client, projectId, budgets.sourcesCitations),
    ]);

  // Rank threads and characters by the episode they were last active in
  // (FILM-1111), then fit each to its budget.
  const episodeNumbers = await resolveEpisodeNumbers(client, [
    ...threads.flatMap((t) => [t.openedAt, ...(t.episodesTouched ?? [])]),
    ...characters.flatMap((c) => c.currentStates.map((s) => s.episodeId)),
  ]);

  const activeThreads = fitToBudget(
    rankByPriority(
      threads.map((thread) => ({
        item: thread,
        id: thread.id,
        episode: latestEpisode(
          [thread.openedAt, ...(thread.episodesTouched ?? [])],
          episodeNumbers,
        ),
        mentions: thread.episodesTouched?.length,
      })),
      episodeNumber,
      projectType,
    ).map((r) => r.item),
    budgets.narrativeThreads,
  );

  const characterStates = fitToBudget(
    rankByPriority(
      characters.map((character) => ({
        item: character,
        id: character.characterId,
        episode: latestEpisode(
          character.currentStates.map((s) => s.episodeId),
          episodeNumbers,
        ),
      })),
      episodeNumber,
      projectType,
    ).map((r) => r.item),
    budgets.characterStates,
  );

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
    sourcesCitations: estimateTokens(sources),
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
      ` decay=${options.decayFunction}` +
      ` events=${immutableEvents.length} characters=${characterStates.length}` +
      ` threads=${activeThreads.length} summaries=${recentSummaries.length}` +
      ` world=${worldState ? 1 : 0} sources=${sources.length}` +
      ` tokens=${totalUsed}`,
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
    sources,
    metadata: {
      builtAt: new Date().toISOString(),
      projectType: resolvedType.projectType,
      projectTypeSource: resolvedType.source,
      memoryHorizon,
      memoryHorizonSource,
      decayFunction: options.decayFunction,
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
