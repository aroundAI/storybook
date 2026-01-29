/**
 * Canon Server Actions
 * Phase 10: FILM-1005
 *
 * Server actions for Canon Management System CRUD operations.
 *
 * NOTE: This file uses @ts-nocheck temporarily until database migration is applied
 * and types are regenerated with: pnpm --filter web supabase:web:typegen
 */

// @ts-nocheck - Canon tables pending migration
/* eslint-disable @typescript-eslint/no-explicit-any */

'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

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
import { buildMemoryContext } from '../lib/canon/memory-context-builder';

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
    memoryHorizon: z.number().int().min(1).max(100).optional(),
});

const GetCanonHealthSchema = z.object({
    projectId: z.string().uuid(),
});

// =============================================================================
// IMMUTABLE EVENTS ACTIONS
// =============================================================================

/**
 * Adds an immutable event to the canon.
 */
export const addImmutableEventAction = enhanceAction(
    async (data: AddImmutableEventInput) => {
        const client = getSupabaseServerClient();

        // Check for existing conflicting event
        const { data: existing } = await client
            .from('immutable_events')
            .select('id, event_key')
            .eq('project_id', data.projectId)
            .eq('event_key', data.eventKey)
            .single();

        if (existing) {
            throw new Error(
                `Event key "${data.eventKey}" already exists. Immutable events cannot be duplicated.`
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
                metadata: data.metadata ?? {},
            })
            .select()
            .single();

        if (error) {
            console.error('Error adding immutable event:', error);
            throw new Error(`Failed to add immutable event: ${error.message}`);
        }

        return event as ImmutableEvent;
    },
    {
        schema: AddImmutableEventSchema,
    }
);

/**
 * Gets all immutable events for a project.
 */
export const getImmutableEventsAction = enhanceAction(
    async (data: { projectId: string }) => {
        const client = getSupabaseServerClient();

        const { data: events, error } = await client
            .from('immutable_events')
            .select('*')
            .eq('project_id', data.projectId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error getting immutable events:', error);
            throw new Error(`Failed to get immutable events: ${error.message}`);
        }

        return events as ImmutableEvent[];
    },
    {
        schema: z.object({ projectId: z.string().uuid() }),
    }
);

/**
 * Deletes an immutable event (admin only, with confirmation).
 */
export const deleteImmutableEventAction = enhanceAction(
    async (data: { eventId: string; confirm: boolean }) => {
        if (!data.confirm) {
            throw new Error('Deletion requires confirmation. Set confirm: true to proceed.');
        }

        const client = getSupabaseServerClient();

        const { error } = await client
            .from('immutable_events')
            .delete()
            .eq('id', data.eventId);

        if (error) {
            console.error('Error deleting immutable event:', error);
            throw new Error(`Failed to delete immutable event: ${error.message}`);
        }

        return { success: true };
    },
    {
        schema: z.object({
            eventId: z.string().uuid(),
            confirm: z.boolean(),
        }),
    }
);

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
            .select('id')
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
                state_value: data.stateValue,
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

        return state;
    },
    {
        schema: UpdateCharacterStateSchema,
    }
);

/**
 * Gets character states for a specific character.
 */
export const getCharacterStatesAction = enhanceAction(
    async (data: { characterId: string; limit?: number }) => {
        const client = getSupabaseServerClient();

        let query = client
            .from('character_states')
            .select('*')
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
    }
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

        return thread as NarrativeThread;
    },
    {
        schema: CreateNarrativeThreadSchema,
    }
);

/**
 * Updates a narrative thread's status or adds payoffs.
 */
export const updateNarrativeThreadAction = enhanceAction(
    async (data: {
        threadId: string;
        status?: 'open' | 'progressed' | 'resolved' | 'abandoned';
        payoffs?: string[];
        episodeTouched?: string;
        resolvedAt?: string;
    }) => {
        const client = getSupabaseServerClient();

        // Get current thread
        const { data: current, error: fetchError } = await client
            .from('narrative_threads')
            .select('*')
            .eq('id', data.threadId)
            .single();

        if (fetchError || !current) {
            throw new Error('Thread not found');
        }

        // Build update object
        const updates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
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

        const { data: thread, error } = await client
            .from('narrative_threads')
            .update(updates)
            .eq('id', data.threadId)
            .select()
            .single();

        if (error) {
            console.error('Error updating narrative thread:', error);
            throw new Error(`Failed to update narrative thread: ${error.message}`);
        }

        return thread as NarrativeThread;
    },
    {
        schema: z.object({
            threadId: z.string().uuid(),
            status: z.enum(['open', 'progressed', 'resolved', 'abandoned']).optional(),
            payoffs: z.array(z.string()).optional(),
            episodeTouched: z.string().uuid().optional(),
            resolvedAt: z.string().uuid().optional(),
        }),
    }
);

/**
 * Gets active narrative threads for a project.
 */
export const getActiveThreadsAction = enhanceAction(
    async (data: { projectId: string }) => {
        const client = getSupabaseServerClient();

        const { data: threads, error } = await client
            .from('narrative_threads')
            .select('*')
            .eq('project_id', data.projectId)
            .in('status', ['open', 'progressed'])
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Error getting active threads:', error);
            throw new Error(`Failed to get active threads: ${error.message}`);
        }

        return threads as NarrativeThread[];
    },
    {
        schema: z.object({ projectId: z.string().uuid() }),
    }
);

// =============================================================================
// MEMORY CONTEXT ACTIONS
// =============================================================================

/**
 * Builds memory context for an episode.
 */
export const buildMemoryContextAction = enhanceAction(
    async (data: BuildMemoryContextInput) => {
        return buildMemoryContext(data);
    },
    {
        schema: BuildMemoryContextSchema,
    }
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
            (project?.metadata as Record<string, unknown>)?.canon as CanonSettings ??
            DEFAULT_CANON_SETTINGS;

        // Count stats in parallel
        const [immutableResult, threadsResult, episodesResult] = await Promise.all([
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
                .select('episode_number')
                .eq('project_id', data.projectId)
                .order('episode_number', { ascending: false })
                .limit(1)
                .single(),
        ]);

        // Get orphaned threads (open with old promises)
        const { data: orphanedThreads } = await client
            .from('narrative_threads')
            .select('*')
            .eq('project_id', data.projectId)
            .eq('status', 'open')
            .order('created_at', { ascending: true })
            .limit(5);

        // Calculate health status
        const orphanCount = orphanedThreads?.length ?? 0;
        let healthStatus: 'ok' | 'warning' | 'error' = 'ok';
        if (orphanCount > 5) {
            healthStatus = 'error';
        } else if (orphanCount > 2) {
            healthStatus = 'warning';
        }

        const stats: CanonStats = {
            immutableEvents: immutableResult.count ?? 0,
            activeThreads: threadsResult.count ?? 0,
            characterArcs: 0, // Would need character query
            lastEpisode: episodesResult.data?.episode_number ?? 0,
        };

        const health: CanonHealthStatus = {
            status: healthStatus,
            issueCount: orphanCount,
            lastValidation: new Date().toISOString(),
        };

        return {
            health,
            stats,
            config: canonSettings,
            orphanedThreads: orphanedThreads as NarrativeThread[] | undefined,
        };
    },
    {
        schema: GetCanonHealthSchema,
    }
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

        const currentMetadata = (project?.metadata as Record<string, unknown>) ?? {};
        const currentCanon = (currentMetadata.canon as CanonSettings) ?? DEFAULT_CANON_SETTINGS;

        const updatedMetadata = {
            ...currentMetadata,
            canon: {
                ...currentCanon,
                ...data.settings,
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

        return updatedMetadata.canon as CanonSettings;
    },
    {
        schema: z.object({
            projectId: z.string().uuid(),
            settings: z.object({
                enabled: z.boolean().optional(),
                roleSeparation: z.boolean().optional(),
                memoryHorizon: z.number().int().min(1).max(100).optional(),
                enforcement: z.enum(['flexible', 'strict']).optional(),
                contentType: z.enum(['series', 'movie', 'factual', 'news']).optional(),
            }),
        }),
    }
);
