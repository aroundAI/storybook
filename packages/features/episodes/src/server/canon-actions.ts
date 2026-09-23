'use server';

/**
 * Canon Server Actions
 * Phase 10: FILM-1005
 *
 * Server actions for Canon Management System CRUD operations.
 */
import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { buildMemoryContext } from '../lib/canon/memory-context-builder';
import {
  MAX_MEMORY_HORIZON,
  MIN_MEMORY_HORIZON,
  effectiveMemoryHorizon,
} from '../lib/canon/memory-horizon';
import type {
  AddImmutableEventInput,
  BuildMemoryContextInput,
  CanonDashboardData,
  CanonHealthStatus,
  CanonSettings,
  CanonStats,
  CreateNarrativeThreadInput,
  ImmutableEvent,
  NarrativeThread,
  UpdateCharacterStateInput,
} from '../lib/canon/types';
import { DEFAULT_CANON_SETTINGS } from '../lib/canon/types';

type Json = Database['public']['Tables']['immutable_events']['Row']['metadata'];

// =============================================================================
// SCHEMAS
// =============================================================================

const AddImmutableEventSchema = z.object({
  projectId: z.string().uuid(),
  eventType: z.enum([
    'death',
    'world_fact',
    'relationship',
    'timeline',
    'ability_loss',
    'location_destruction',
  ]),
  eventKey: z.string().min(1),
  establishedIn: z.string().uuid(),
  season: z.number().int().positive(),
  episodeNumber: z.number().int().positive(),
  description: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateCharacterStateSchema = z.object({
  characterId: z.string().uuid(),
  episodeId: z.string().uuid(),
  stateType: z.enum([
    'emotional',
    'physical',
    'relationship',
    'knowledge',
    'ability',
    'location',
    'goal',
  ]),
  stateValue: z.record(z.unknown()),
  triggerEvent: z.string().min(1),
  cost: z.string().optional(),
  newConstraints: z.array(z.string()).optional(),
});

const CreateNarrativeThreadSchema = z.object({
  projectId: z.string().uuid(),
  threadName: z.string().min(1),
  threadType: z.enum([
    'plot',
    'character',
    'mystery',
    'romantic',
    'conflict',
    'thematic',
  ]),
  openedAt: z.string().uuid(),
  description: z.string().optional(),
  promises: z.array(z.string()).optional(),
});

const BuildMemoryContextSchema = z.object({
  projectId: z.string().uuid(),
  episodeNumber: z.number().int().positive(),
  tokenBudgetPercent: z.number().min(1).max(50).optional(),
  memoryHorizon: z
    .number()
    .int()
    .min(MIN_MEMORY_HORIZON)
    .max(MAX_MEMORY_HORIZON)
    .optional(),
});

const GetCanonHealthSchema = z.object({
  projectId: z.string().uuid(),
});

// =============================================================================
// MAPPER FUNCTIONS
// =============================================================================

type ImmutableEventRow = {
  id: string;
  project_id: string;
  event_type: string;
  event_key: string;
  established_in: string;
  season: number;
  episode_number: number;
  description: string;
  metadata: unknown;
  created_at: string | null;
  created_by: string | null;
};

type EpisodeJoinRow = {
  id: string;
  title: string;
  number: number;
} | null;

type NarrativeThreadRow = {
  id: string;
  project_id: string;
  thread_name: string;
  thread_type: string | null;
  status: string | null;
  opened_at: string;
  resolved_at: string | null;
  episodes_touched: string[] | null;
  promises: string[] | null;
  payoffs: string[] | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  opened_episode?: EpisodeJoinRow;
  resolved_episode?: EpisodeJoinRow;
};

function mapImmutableEvent(row: ImmutableEventRow): ImmutableEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type as ImmutableEvent['eventType'],
    eventKey: row.event_key,
    establishedIn: row.established_in,
    season: row.season,
    episodeNumber: row.episode_number,
    description: row.description,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    createdBy: row.created_by ?? undefined,
  };
}

function mapNarrativeThread(row: NarrativeThreadRow): NarrativeThread {
  return {
    id: row.id,
    projectId: row.project_id,
    threadName: row.thread_name,
    threadType: (row.thread_type ?? 'plot') as NarrativeThread['threadType'],
    status: (row.status ?? 'open') as NarrativeThread['status'],
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at ?? undefined,
    episodesTouched: row.episodes_touched ?? undefined,
    promises: row.promises ?? undefined,
    payoffs: row.payoffs ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
    openedEpisode: row.opened_episode ?? undefined,
    resolvedEpisode: row.resolved_episode ?? undefined,
  };
}

// =============================================================================
// IMMUTABLE EVENTS ACTIONS
// =============================================================================

/**
 * One refusal for every canon write the database turns down (KB-17): not a
 * writer on the project, or no such event. It names neither, so it reveals
 * nothing about what exists.
 */
const CANON_WRITE_REFUSAL = "You can't change this project's canon.";

const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Adds an immutable event to the canon.
 */
const addImmutableEvent = enhanceAction(
  async (data: AddImmutableEventInput, user) => {
    const client = getSupabaseServerClient();

    // Check for existing conflicting event
    const { data: existing } = await client
      .from('immutable_events')
      .select('id, event_key')
      .eq('project_id', data.projectId)
      .eq('event_key', data.eventKey)
      .single();

    if (existing) {
      throw new ActionRefusal(
        `Event key "${data.eventKey}" already exists. Immutable events cannot be duplicated.`,
      );
    }

    const { data: event, error } = await client
      .from('immutable_events')
      .insert({
        project_id: data.projectId,
        event_type: data.eventType,
        event_key: data.eventKey,
        established_in: data.establishedIn,
        season: data.season,
        episode_number: data.episodeNumber,
        description: data.description,
        metadata: (data.metadata ?? null) as Json,
        created_by: user.id,
      })
      .select()
      .single();

    if (error?.code === INSUFFICIENT_PRIVILEGE) {
      throw new ActionRefusal(CANON_WRITE_REFUSAL);
    }

    if (error) {
      console.error('Error adding immutable event:', error);
      throw new Error(`Failed to add immutable event: ${error.message}`);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return mapImmutableEvent(event as ImmutableEventRow);
  },
  {
    schema: AddImmutableEventSchema,
  },
);

export const addImmutableEventAction = returnRefusals(addImmutableEvent);

/**
 * Gets all immutable events for a project.
 */
export const getImmutableEventsAction = enhanceAction(
  async (data: { projectId: string }) => {
    const client = getSupabaseServerClient();

    const { data: events, error } = await client
      .from('immutable_events')
      .select(
        'id, project_id, event_type, event_key, established_in, season, episode_number, description, metadata, created_at, created_by',
      )
      .eq('project_id', data.projectId)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) {
      console.error('Error getting immutable events:', error);
      throw new Error(`Failed to get immutable events: ${error.message}`);
    }

    return (events ?? []).map((e) => mapImmutableEvent(e as ImmutableEventRow));
  },
  {
    schema: z.object({ projectId: z.string().uuid() }),
  },
);

/**
 * Deletes an immutable event, with confirmation. The database allows it to
 * the project's writers -- owner, admin or member (KB-17, `can_write_project`)
 * -- and refuses it to anyone else by matching no row, which is reported as a
 * refusal rather than a success. Events are never edited: a correction is a
 * delete and a new event.
 */
const deleteImmutableEvent = enhanceAction(
  async (data: { eventId: string; confirm: boolean }) => {
    if (!data.confirm) {
      throw new Error(
        'Deletion requires confirmation. Set confirm: true to proceed.',
      );
    }

    const client = getSupabaseServerClient();

    const { data: deleted, error } = await client
      .from('immutable_events')
      .delete()
      .eq('id', data.eventId)
      .select('id');

    if (error) {
      console.error('Error deleting immutable event:', error);
      throw new Error(`Failed to delete immutable event: ${error.message}`);
    }

    if (!deleted?.length) {
      throw new ActionRefusal(CANON_WRITE_REFUSAL);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return { success: true };
  },
  {
    schema: z.object({
      eventId: z.string().uuid(),
      confirm: z.boolean(),
    }),
  },
);

export const deleteImmutableEventAction = returnRefusals(deleteImmutableEvent);

// =============================================================================
// CHARACTER STATE ACTIONS
// =============================================================================

/**
 * Updates a character's state (append-only).
 */
export const updateCharacterStateAction = enhanceAction(
  async (data: UpdateCharacterStateInput) => {
    const client = getSupabaseServerClient();

    // Get previous state for audit chain
    const { data: previousState } = await client
      .from('character_states')
      .select('id, state_value')
      .eq('character_id', data.characterId)
      .eq('state_type', data.stateType)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: state, error } = await client
      .from('character_states')
      .insert({
        character_id: data.characterId,
        episode_id: data.episodeId,
        state_type: data.stateType,
        state_value: data.stateValue as Json,
        trigger_event: data.triggerEvent,
        cost: data.cost ?? null,
        new_constraints: data.newConstraints ?? null,
        previous_state_id: previousState?.id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating character state:', error);
      throw new Error(`Failed to update character state: ${error.message}`);
    }

    // Record state delta for audit trail (FILM-1005)
    await client.from('state_deltas').insert({
      episode_id: data.episodeId,
      entity_type: 'character',
      entity_id: data.characterId,
      before_state: (previousState?.state_value ?? null) as Json,
      after_state: data.stateValue as Json,
      change_reason: data.triggerEvent,
    });

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return state;
  },
  {
    schema: UpdateCharacterStateSchema,
  },
);

/**
 * Gets character states for a specific character.
 */
export const getCharacterStatesAction = enhanceAction(
  async (data: { characterId: string; limit?: number }) => {
    const client = getSupabaseServerClient();

    // All columns needed — returned directly to the client for character state display
    let query = client
      .from('character_states')
      .select(
        'id, character_id, episode_id, state_type, state_value, trigger_event, cost, new_constraints, previous_state_id, created_at',
      )
      .eq('character_id', data.characterId)
      .order('created_at', { ascending: false });

    if (data.limit) {
      query = query.limit(data.limit);
    }

    const { data: states, error } = await query;

    if (error) {
      console.error('Error getting character states:', error);
      throw new Error(`Failed to get character states: ${error.message}`);
    }

    return states;
  },
  {
    schema: z.object({
      characterId: z.string().uuid(),
      limit: z.number().int().positive().optional(),
    }),
  },
);

/**
 * Gets all character states for a project (latest state per character).
 * Note: character_states links to assets via character_id, and assets has project_id.
 */
export const getProjectCharacterStatesAction = enhanceAction(
  async (data: { projectId: string; limit?: number }) => {
    const client = getSupabaseServerClient();

    // First, get all character asset IDs for this project
    const { data: characterAssets, error: assetsError } = await client
      .from('assets')
      .select('id')
      .eq('project_id', data.projectId)
      .eq('type', 'character');

    if (assetsError) {
      console.error('Error getting project character assets:', assetsError);
      throw new Error(
        `Failed to get project character assets: ${assetsError.message}`,
      );
    }

    if (!characterAssets || characterAssets.length === 0) {
      return [];
    }

    const characterIds = characterAssets.map((a) => a.id);

    // Now get character states for those character IDs
    const { data: states, error } = await client
      .from('character_states')
      .select(
        `
                *,
                characters:character_id (
                    id,
                    name
                )
            `,
      )
      .in('character_id', characterIds)
      .order('created_at', { ascending: false })
      .limit(data.limit ?? 50);

    if (error) {
      console.error('Error getting project character states:', error);
      throw new Error(
        `Failed to get project character states: ${error.message}`,
      );
    }

    return states ?? [];
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      limit: z.number().int().positive().optional(),
    }),
  },
);

// =============================================================================
// NARRATIVE THREAD ACTIONS
// =============================================================================

/**
 * Creates a new narrative thread.
 */
export const createNarrativeThreadAction = enhanceAction(
  async (data: CreateNarrativeThreadInput) => {
    const client = getSupabaseServerClient();

    const { data: thread, error } = await client
      .from('narrative_threads')
      .insert({
        project_id: data.projectId,
        thread_name: data.threadName,
        thread_type: data.threadType,
        opened_at: data.openedAt,
        description: data.description ?? null,
        promises: data.promises ?? [],
        status: 'open',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating narrative thread:', error);
      throw new Error(`Failed to create narrative thread: ${error.message}`);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return mapNarrativeThread(thread as NarrativeThreadRow);
  },
  {
    schema: CreateNarrativeThreadSchema,
  },
);

/**
 * Updates a narrative thread's status or adds payoffs.
 * Uses optimistic locking via version column to prevent race conditions.
 */
export const updateNarrativeThreadAction = enhanceAction(
  async (data: {
    threadId: string;
    expectedVersion: number;
    status?: 'open' | 'progressed' | 'resolved' | 'abandoned';
    payoffs?: string[];
    episodeTouched?: string;
    resolvedAt?: string;
  }) => {
    const client = getSupabaseServerClient();

    // Get current thread to merge arrays
    const { data: current, error: fetchError } = await client
      .from('narrative_threads')
      .select('id, payoffs, episodes_touched, version')
      .eq('id', data.threadId)
      .single();

    if (fetchError || !current) {
      throw new Error('Thread not found');
    }

    // Verify version matches (optimistic locking)
    // Note: version column added in migration 20260129194541
    const currentVersion = (current as { version?: number }).version ?? 1;
    if (currentVersion !== data.expectedVersion) {
      throw new Error(
        'Thread was modified by another user. Please refresh and try again.',
      );
    }

    // Build update object with incremented version
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      version: data.expectedVersion + 1,
    };

    if (data.status) {
      updates.status = data.status;
    }

    if (data.payoffs) {
      updates.payoffs = [...(current.payoffs ?? []), ...data.payoffs];
    }

    if (data.episodeTouched) {
      updates.episodes_touched = [
        ...(current.episodes_touched ?? []),
        data.episodeTouched,
      ];
    }

    if (data.resolvedAt) {
      updates.resolved_at = data.resolvedAt;
    }

    // Update with version check in WHERE clause for extra safety
    const { data: thread, error } = await client
      .from('narrative_threads')
      .update(updates)
      .eq('id', data.threadId)
      .eq('version', data.expectedVersion)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(
          'Thread was modified by another user. Please refresh and try again.',
        );
      }
      console.error('Error updating narrative thread:', error);
      throw new Error(`Failed to update narrative thread: ${error.message}`);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return mapNarrativeThread(thread as NarrativeThreadRow);
  },
  {
    schema: z.object({
      threadId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
      status: z
        .enum(['open', 'progressed', 'resolved', 'abandoned'])
        .optional(),
      payoffs: z.array(z.string()).optional(),
      episodeTouched: z.string().uuid().optional(),
      resolvedAt: z.string().uuid().optional(),
    }),
  },
);

/**
 * Gets active narrative threads for a project.
 */
export const getActiveThreadsAction = enhanceAction(
  async (data: { projectId: string }) => {
    const client = getSupabaseServerClient();

    const { data: threads, error } = await client
      .from('narrative_threads')
      .select(
        '*, opened_episode:episodes!narrative_threads_opened_at_fkey(id, title, number), resolved_episode:episodes!narrative_threads_resolved_at_fkey(id, title, number)',
      )
      .eq('project_id', data.projectId)
      .in('status', ['open', 'progressed'])
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error getting active threads:', error);
      throw new Error(`Failed to get active threads: ${error.message}`);
    }

    return (threads ?? []).map((t) =>
      mapNarrativeThread(t as NarrativeThreadRow),
    );
  },
  {
    schema: z.object({ projectId: z.string().uuid() }),
  },
);

// =============================================================================
// MEMORY CONTEXT ACTIONS
// =============================================================================

/**
 * Builds memory context for an episode.
 */
export const buildMemoryContextAction = enhanceAction(
  async (data: BuildMemoryContextInput) => {
    return buildMemoryContext(getSupabaseServerClient(), data);
  },
  {
    schema: BuildMemoryContextSchema,
  },
);

// =============================================================================
// CANON HEALTH ACTIONS
// =============================================================================

/**
 * Gets canon health status and stats for dashboard.
 */
export const getCanonHealthAction = enhanceAction(
  async (data: { projectId: string }): Promise<CanonDashboardData> => {
    const client = getSupabaseServerClient();

    // Get project settings
    const { data: project } = await client
      .from('projects')
      .select('metadata')
      .eq('id', data.projectId)
      .single();

    const canonSettings: CanonSettings =
      ((project?.metadata as Record<string, unknown>)
        ?.canon as CanonSettings) ?? DEFAULT_CANON_SETTINGS;

    // Count stats in parallel
    const [
      immutableResult,
      threadsResult,
      episodesResult,
      characterArcsResult,
    ] = await Promise.all([
      client
        .from('immutable_events')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', data.projectId),
      client
        .from('narrative_threads')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', data.projectId)
        .in('status', ['open', 'progressed']),
      client
        .from('episodes')
        .select('number')
        .eq('project_id', data.projectId)
        .order('number', { ascending: false })
        .limit(1)
        .single(),
      // Count character arcs: assets.type='character' are linked by episode, use a best-effort count
      new Promise<{ count: number | null }>((resolve) => resolve({ count: 0 })),
    ]);

    // Get all active threads (both 'open' and 'progressed')
    const { data: allActiveThreads } = await client
      .from('narrative_threads')
      .select(
        '*, opened_episode:episodes!narrative_threads_opened_at_fkey(id, title, number), resolved_episode:episodes!narrative_threads_resolved_at_fkey(id, title, number)',
      )
      .eq('project_id', data.projectId)
      .in('status', ['open', 'progressed'])
      .order('created_at', { ascending: true });

    // Filter to stale threads only — threads untouched for memoryHorizon episodes
    const currentEpisodeNumber = episodesResult.data?.number ?? 0;
    const staleThreshold = effectiveMemoryHorizon(
      project?.metadata,
    ).memoryHorizon;

    const staleThreads = (allActiveThreads ?? []).filter((thread) => {
      const openedEpNumber =
        (
          thread.opened_episode as
            | { id: string; title: string; number: number }
            | undefined
        )?.number ?? 0;
      const touchedEps = (thread.episodes_touched as string[]) ?? [];

      // Estimate last-touched episode: opened + number of times touched
      const lastTouchedEp =
        touchedEps.length > 0
          ? openedEpNumber + touchedEps.length
          : openedEpNumber;

      const episodesSinceLastTouch = currentEpisodeNumber - lastTouchedEp;
      return episodesSinceLastTouch >= staleThreshold;
    });

    // Calculate health status based on stale count
    const staleCount = staleThreads.length;
    let healthStatus: 'ok' | 'warning' | 'error' = 'ok';
    if (staleCount > 5) {
      healthStatus = 'error';
    } else if (staleCount > 2) {
      healthStatus = 'warning';
    }

    const stats: CanonStats = {
      immutableEvents: immutableResult.count ?? 0,
      activeThreads: threadsResult.count ?? 0,
      characterArcs: characterArcsResult.count ?? 0,
      lastEpisode: currentEpisodeNumber,
    };

    const health: CanonHealthStatus = {
      status: healthStatus,
      issueCount: staleCount,
      lastValidation: new Date().toISOString(),
    };

    return {
      health,
      stats,
      config: canonSettings,
      orphanedThreads: staleThreads.map((t) =>
        mapNarrativeThread(t as NarrativeThreadRow),
      ),
    };
  },
  {
    schema: GetCanonHealthSchema,
  },
);

/**
 * Updates canon settings for a project.
 */
export const updateCanonSettingsAction = enhanceAction(
  async (data: { projectId: string; settings: Partial<CanonSettings> }) => {
    const client = getSupabaseServerClient();

    // Get current project metadata
    const { data: project, error: fetchError } = await client
      .from('projects')
      .select('metadata')
      .eq('id', data.projectId)
      .single();

    if (fetchError) {
      throw new Error(`Project not found: ${fetchError.message}`);
    }

    const currentMetadata =
      (project?.metadata as Record<string, unknown>) ?? {};
    const currentCanon =
      (currentMetadata.canon as CanonSettings) ?? DEFAULT_CANON_SETTINGS;

    const updatedMetadata = {
      ...currentMetadata,
      canon: {
        ...currentCanon,
        ...data.settings,
        ...(data.settings.memoryHorizon !== undefined && {
          memoryHorizonMode: 'custom' as const,
        }),
      },
    };

    const { error } = await client
      .from('projects')
      .update({ metadata: updatedMetadata })
      .eq('id', data.projectId);

    if (error) {
      console.error('Error updating canon settings:', error);
      throw new Error(`Failed to update canon settings: ${error.message}`);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return updatedMetadata.canon as CanonSettings;
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      settings: z.object({
        enabled: z.boolean().optional(),
        roleSeparation: z.boolean().optional(),
        memoryHorizon: z
          .number()
          .int()
          .min(MIN_MEMORY_HORIZON)
          .max(MAX_MEMORY_HORIZON)
          .optional(),
        enforcement: z.enum(['flexible', 'strict']).optional(),
        contentType: z.enum(['series', 'movie', 'factual', 'news']).optional(),
      }),
    }),
  },
);

// =============================================================================
// INLINE VALIDATION ACTION (Step 3)
// =============================================================================

/**
 * Validates story content inline against canon rules.
 * Used for real-time Story tab validation.
 */
export const validateContentInlineAction = enhanceAction(
  async (data: {
    projectId: string;
    episodeId: string;
    content: string;
  }): Promise<{
    valid: boolean;
    violations: Array<{
      code: string;
      severity: 'error' | 'warning' | 'info';
      message: string;
      suggestion: string;
    }>;
  }> => {
    const client = getSupabaseServerClient();

    // Get immutable events for this project
    const { data: immutableEvents } = await client
      .from('immutable_events')
      .select('event_type, event_key, description, episode_number')
      .eq('project_id', data.projectId);

    const violations: Array<{
      code: string;
      severity: 'error' | 'warning' | 'info';
      message: string;
      suggestion: string;
    }> = [];

    const lowerContent = data.content.toLowerCase();

    // Check for resurrection violations (CANON_001)
    const deathEvents = (immutableEvents ?? []).filter(
      (e) => e.event_type === 'death',
    );

    for (const death of deathEvents) {
      // Extract character name from event key
      const parts = death.event_key.split(':');
      const charName = parts[1] ?? '';

      // Check if dead character appears as active in content
      if (charName && lowerContent.includes(charName.toLowerCase())) {
        // Check for active verbs suggesting they're alive
        const activePatterns = [
          'said',
          'walked',
          'entered',
          'appeared',
          'spoke',
        ];
        // Escape regex special characters to prevent ReDoS attacks
        const escapedCharName = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasActiveVerb = activePatterns.some((pattern) => {
          const regex = new RegExp(
            `${escapedCharName}[^.]{0,100}${pattern}`,
            'i',
          );
          return regex.test(data.content);
        });

        if (hasActiveVerb) {
          violations.push({
            code: 'CANON_001',
            severity: 'error',
            message: `${charName} appears to be active but was established as dead in Episode ${death.episode_number}`,
            suggestion:
              'Use flashback, memory, dream, or hallucination framing if referencing this character.',
          });
        }
      }
    }

    // Check for world fact contradictions (CANON_005)
    const worldFacts = (immutableEvents ?? []).filter(
      (e) =>
        e.event_type === 'world_fact' ||
        e.event_type === 'location_destruction',
    );

    for (const fact of worldFacts) {
      // Check if content references destroyed locations as intact
      const factDesc = fact.description.toLowerCase();
      if (fact.event_type === 'location_destruction') {
        // Extract location name (simplified)
        const locationWords = factDesc.split(' ').slice(0, 3).join(' ');
        if (lowerContent.includes(locationWords)) {
          violations.push({
            code: 'CANON_005',
            severity: 'warning',
            message: `Reference to "${locationWords}" may conflict with established world fact`,
            suggestion: 'Verify this aligns with established canon.',
          });
        }
      }
    }

    return {
      valid: violations.filter((v) => v.severity === 'error').length === 0,
      violations,
    };
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      episodeId: z.string().uuid(),
      content: z.string(),
    }),
  },
);

// =============================================================================
// CANON EXTRACTION ACTIONS (Step 5)
// =============================================================================

interface ExtractedCanonChange {
  type:
    | 'death'
    | 'world_fact'
    | 'relationship'
    | 'timeline'
    | 'ability_loss'
    | 'location_destruction';
  eventKey: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ExtractedThreadUpdate {
  threadId?: string;
  threadName: string;
  threadType?:
    | 'plot'
    | 'character'
    | 'mystery'
    | 'romantic'
    | 'conflict'
    | 'thematic';
  action: 'open' | 'progress' | 'resolve';
  description: string;
  promises?: string[];
}

interface ExtractedStateChange {
  characterName: string;
  stateType:
    | 'emotional'
    | 'physical'
    | 'relationship'
    | 'knowledge'
    | 'ability'
    | 'location'
    | 'goal';
  fromState: string;
  toState: string;
  triggerEvent: string;
}

export interface CanonExtractionResult {
  immutableEvents: ExtractedCanonChange[];
  threadUpdates: ExtractedThreadUpdate[];
  stateChanges: ExtractedStateChange[];
  episodeSummary: string;
  sentimentScore: number;
}

/**
 * Extracts canon changes from episode content for review before publish.
 */
export const extractCanonChangesAction = enhanceAction(
  async (data: {
    projectId: string;
    episodeId: string;
    storyContent: string;
  }): Promise<CanonExtractionResult> => {
    try {
      // FILM-1103: Use LLM for intelligent canon extraction
      const { executeLLM } = await import('@kit/prompt-engine/server');

      // Sanitize user-provided content to prevent prompt injection
      const sanitizedContent = data.storyContent
        .replace(/\b(system|assistant)\s*:\s*/gi, '')
        .replace(
          /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
          '',
        )
        .replace(/\byou\s+are\s+now\b/gi, '')
        .replace(
          /\bforget\s+(all\s+)?(previous|your)\s+(instructions?|rules?|context)\b/gi,
          '',
        )
        .substring(0, 50_000)
        .trim();

      // Fetch active threads for LLM context
      const client = getSupabaseServerClient();

      // Rate limit LLM-based extraction
      const {
        data: { user },
      } = await client.auth.getUser();
      if (user) {
        checkRateLimit(user.id, 'extractCanonChanges', {
          maxRequests: 30,
          windowMs: 60_000,
        });
      }

      const { data: activeThreads } = await client
        .from('narrative_threads')
        .select('thread_name, thread_type, status, description, promises')
        .eq('project_id', data.projectId)
        .in('status', ['open', 'progressed']);

      const threadsContext = activeThreads?.length
        ? activeThreads
            .map(
              (t: {
                thread_name: string;
                thread_type: string | null;
                status: string | null;
                description: string | null;
                promises: string[] | null;
              }) =>
                `- "${t.thread_name}" (${t.thread_type ?? 'plot'}, ${t.status ?? 'open'}): ${t.description ?? ''}. Promises: ${(t.promises ?? []).join(', ') || 'none'}`,
            )
            .join('\n')
        : 'No active threads';

      // Fetch project characters for LLM context
      const { data: projectCharacters } = await client
        .from('assets')
        .select('name, type')
        .eq('project_id', data.projectId)
        .eq('type', 'character')
        .limit(30);

      const charsContext = projectCharacters?.length
        ? projectCharacters
            .map((c: { name: string }) => `- ${c.name}`)
            .join('\n')
        : 'No characters defined';

      const result = await executeLLM<{
        extraction: {
          immutableEvents: ExtractedCanonChange[];
          characterStateChanges: Array<{
            characterName: string;
            stateType: ExtractedStateChange['stateType'];
            fromState: string;
            toState: string;
            triggerEvent: string;
          }>;
          threadUpdates: ExtractedThreadUpdate[];
          episodeSummary: string;
          sentimentScore: number;
          keyEvents: string[];
        };
      }>({
        templateSlug: 'canon-extraction',
        variables: {
          story_content: sanitizedContent,
          existing_characters: charsContext,
          existing_threads: threadsContext,
        },
        context: {
          name: 'canon-extraction',
          accountId: data.projectId, // Project-level context
        },
      });

      const extraction = result.data.extraction;

      // Map LLM output to CanonExtractionResult interface
      return {
        immutableEvents: (extraction.immutableEvents ?? []).map((e) => ({
          type: e.type,
          eventKey: e.eventKey,
          description: e.description,
          confidence: e.confidence ?? 'medium',
        })),
        threadUpdates: (extraction.threadUpdates ?? []).map((t) => ({
          threadName: t.threadName,
          threadType: t.threadType,
          action: t.action,
          description: t.description,
          promises: t.promises,
        })),
        stateChanges: (extraction.characterStateChanges ?? []).map((s) => ({
          characterName: s.characterName,
          stateType: s.stateType,
          fromState: s.fromState,
          toState: s.toState,
          triggerEvent: s.triggerEvent,
        })),
        episodeSummary: extraction.episodeSummary ?? '',
        sentimentScore: Math.max(
          0,
          Math.min(1, extraction.sentimentScore ?? 0.5),
        ),
      };
    } catch (err) {
      console.warn(
        '[Canon Extraction] LLM extraction failed, falling back to basic:',
        err,
      );

      // Fallback: return minimal extraction with truncated summary
      const words = data.storyContent.split(/\s+/).slice(0, 50).join(' ');
      return {
        immutableEvents: [],
        threadUpdates: [],
        stateChanges: [],
        episodeSummary:
          words.length > 100 ? words.substring(0, 200) + '...' : words,
        sentimentScore: 0.5,
      };
    }
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      episodeId: z.string().uuid(),
      storyContent: z.string(),
    }),
  },
);

/**
 * Commits extracted canon changes to the database.
 */
export const commitCanonChangesAction = enhanceAction(
  async (data: {
    projectId: string;
    episodeId: string;
    season: number;
    episodeNumber: number;
    changes: {
      immutableEvents: ExtractedCanonChange[];
      threadUpdates: ExtractedThreadUpdate[];
      episodeSummary: string;
      sentimentScore: number;
    };
  }) => {
    const client = getSupabaseServerClient();

    // Filter high-confidence events for storage
    const highConfidenceEvents = data.changes.immutableEvents
      .filter((event) => event.confidence === 'high')
      .map((event) => ({
        type: event.type,
        eventKey: event.eventKey,
        description: event.description,
      }));

    // Use atomic RPC function for transaction safety
    // This ensures either all changes commit or none do
    const { data: result, error } = await client.rpc('commit_canon_changes', {
      p_project_id: data.projectId,
      p_episode_id: data.episodeId,
      p_season: data.season,
      p_episode_number: data.episodeNumber,
      p_events: highConfidenceEvents,
      p_episode_summary: data.changes.episodeSummary,
      p_sentiment_score: data.changes.sentimentScore,
    });

    if (error) {
      console.error('Failed to commit canon changes:', error);
      throw new Error(`Failed to commit canon changes: ${error.message}`);
    }

    // Commit thread updates (batched + parallelized to avoid N+1 queries)
    let threadsUpdated = 0;

    try {
      // 1. Separate by action type
      const openUpdates = data.changes.threadUpdates.filter(
        (u) => u.action === 'open',
      );
      const progressUpdates = data.changes.threadUpdates.filter(
        (u) => u.action === 'progress',
      );
      const resolveUpdates = data.changes.threadUpdates.filter(
        (u) => u.action === 'resolve',
      );

      // 2. Batch insert all 'open' threads in a single call
      if (openUpdates.length > 0) {
        const rows = openUpdates.map((update) => ({
          project_id: data.projectId,
          thread_name: update.threadName,
          thread_type: update.threadType ?? 'plot',
          opened_at: data.episodeId,
          description: update.description,
          promises: update.promises ?? [],
          episodes_touched: [data.episodeId],
          status: 'open',
        }));
        const { data: inserted, error: insertError } = await client
          .from('narrative_threads')
          .insert(rows)
          .select('id');
        if (insertError) {
          console.warn(
            '[commitCanonChanges] Batch thread insert failed:',
            insertError,
          );
        } else {
          threadsUpdated += inserted?.length ?? 0;
        }
      }

      // 3. Batch lookup for progress + resolve (single query instead of N)
      const lookupNames = [...progressUpdates, ...resolveUpdates].map(
        (u) => u.threadName,
      );

      if (lookupNames.length > 0) {
        const { data: existingThreads } = await client
          .from('narrative_threads')
          .select('id, thread_name, episodes_touched, payoffs, version')
          .eq('project_id', data.projectId)
          .in('thread_name', lookupNames)
          .in('status', ['open', 'progressed'])
          .order('created_at', { ascending: false });

        // Build map: threadName -> first matching thread (most recent)
        const threadMap = new Map<
          string,
          NonNullable<typeof existingThreads>[number]
        >();
        for (const t of existingThreads ?? []) {
          if (!threadMap.has(t.thread_name)) {
            threadMap.set(t.thread_name, t);
          }
        }

        // 4. Parallelize all progress + resolve updates
        const updatePromises = [...progressUpdates, ...resolveUpdates]
          .map((update) => {
            const existing = threadMap.get(update.threadName);
            if (!existing) return null;

            const touched = [
              ...new Set([
                ...((existing.episodes_touched as string[]) ?? []),
                data.episodeId,
              ]),
            ];
            const newVersion = ((existing.version as number) ?? 1) + 1;

            if (update.action === 'progress') {
              return client
                .from('narrative_threads')
                .update({
                  status: 'progressed',
                  episodes_touched: touched,
                  description: update.description,
                  version: newVersion,
                })
                .eq('id', existing.id);
            } else {
              // resolve
              return client
                .from('narrative_threads')
                .update({
                  status: 'resolved',
                  resolved_at: data.episodeId,
                  payoffs: [
                    ...((existing.payoffs as string[]) ?? []),
                    update.description,
                  ],
                  episodes_touched: touched,
                  version: newVersion,
                })
                .eq('id', existing.id);
            }
          })
          .filter(Boolean);

        const results = await Promise.all(updatePromises);
        threadsUpdated += results.filter((r) => !r?.error).length;
      }
    } catch (threadError) {
      console.warn('[commitCanonChanges] Thread updates failed:', threadError);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return {
      eventsCreated:
        (result as { eventsCreated: number; summaryStored: boolean })
          ?.eventsCreated ?? 0,
      threadsUpdated,
      summaryStored:
        (result as { eventsCreated: number; summaryStored: boolean })
          ?.summaryStored ?? false,
    };
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      episodeId: z.string().uuid(),
      season: z.number().int().positive(),
      episodeNumber: z.number().int().positive(),
      changes: z.object({
        immutableEvents: z.array(
          z.object({
            type: z.enum([
              'death',
              'world_fact',
              'relationship',
              'timeline',
              'ability_loss',
              'location_destruction',
            ]),
            eventKey: z.string(),
            description: z.string(),
            confidence: z.enum(['high', 'medium', 'low']),
          }),
        ),
        threadUpdates: z.array(
          z.object({
            threadId: z.string().optional(),
            threadName: z.string(),
            threadType: z
              .enum([
                'plot',
                'character',
                'mystery',
                'romantic',
                'conflict',
                'thematic',
              ])
              .optional(),
            action: z.enum(['open', 'progress', 'resolve']),
            description: z.string(),
            promises: z.array(z.string()).optional(),
          }),
        ),
        episodeSummary: z.string(),
        sentimentScore: z.number().min(0).max(1),
      }),
    }),
  },
);

// =============================================================================
// ALL THREADS QUERY (Canon Dashboard)
// =============================================================================

/**
 * Gets all narrative threads for a project with optional status filter.
 * Used by the Canon dashboard page.
 */
export const getAllThreadsAction = enhanceAction(
  async (data: { projectId: string; status?: string }) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('narrative_threads')
      .select(
        '*, opened_episode:episodes!narrative_threads_opened_at_fkey(id, title, number), resolved_episode:episodes!narrative_threads_resolved_at_fkey(id, title, number)',
      )
      .eq('project_id', data.projectId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (data.status) {
      query = query.eq('status', data.status);
    }

    const { data: threads, error } = await query;

    if (error) {
      throw new Error(`Failed to get threads: ${error.message}`);
    }

    return (threads ?? []).map((row: unknown) =>
      mapNarrativeThread(row as NarrativeThreadRow),
    );
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      status: z
        .enum(['open', 'progressed', 'resolved', 'abandoned'])
        .optional(),
    }),
  },
);
