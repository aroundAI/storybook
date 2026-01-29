/**
 * Canon Server Actions
 * Phase 10: FILM-1005
 *
 * Server actions for Canon Management System CRUD operations.
 */

'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

import type { Database } from '@kit/supabase/database';

type Json = Database['public']['Tables']['immutable_events']['Row']['metadata'];

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
    };
}

// =============================================================================
// IMMUTABLE EVENTS ACTIONS
// =============================================================================

/**
 * Adds an immutable event to the canon.
 */
export const addImmutableEventAction = enhanceAction(
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
                metadata: (data.metadata ?? null) as Json,
                created_by: user.id,
            })
            .select()
            .single();

        if (error) {
            console.error('Error adding immutable event:', error);
            throw new Error(`Failed to add immutable event: ${error.message}`);
        }

        return mapImmutableEvent(event as ImmutableEventRow);
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

        return (events ?? []).map(e => mapImmutableEvent(e as ImmutableEventRow));
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

/**
 * Gets all character states for a project (latest state per character).
 */
export const getProjectCharacterStatesAction = enhanceAction(
    async (data: { projectId: string; limit?: number }) => {
        const client = getSupabaseServerClient();

        // Get the latest state for each character in the project
        const { data: states, error } = await client
            .from('character_states')
            .select(`
                *,
                characters:character_id (
                    id,
                    name
                )
            `)
            .eq('project_id', data.projectId)
            .order('created_at', { ascending: false })
            .limit(data.limit ?? 50);

        if (error) {
            console.error('Error getting project character states:', error);
            throw new Error(`Failed to get project character states: ${error.message}`);
        }

        return states ?? [];
    },
    {
        schema: z.object({
            projectId: z.string().uuid(),
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

        return mapNarrativeThread(thread as NarrativeThreadRow);
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

        return mapNarrativeThread(thread as NarrativeThreadRow);
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

        return (threads ?? []).map(t => mapNarrativeThread(t as NarrativeThreadRow));
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
        const [immutableResult, threadsResult, episodesResult, characterArcsResult] = await Promise.all([
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
            client
                .from('character_states')
                .select('character_id', { count: 'exact', head: true })
                .eq('project_id', data.projectId),
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
            characterArcs: characterArcsResult.count ?? 0,
            lastEpisode: episodesResult.data?.number ?? 0,
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
            orphanedThreads: orphanedThreads?.map(t => mapNarrativeThread(t as NarrativeThreadRow)),
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
            .select('*')
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
            (e) => e.event_type === 'death'
        );

        for (const death of deathEvents) {
            // Extract character name from event key
            const parts = death.event_key.split(':');
            const charName = parts[1] ?? '';

            // Check if dead character appears as active in content
            if (charName && lowerContent.includes(charName.toLowerCase())) {
                // Check for active verbs suggesting they're alive
                const activePatterns = ['said', 'walked', 'entered', 'appeared', 'spoke'];
                const hasActiveVerb = activePatterns.some((pattern) => {
                    const regex = new RegExp(`${charName}[^.]*${pattern}`, 'i');
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
            (e) => e.event_type === 'world_fact' || e.event_type === 'location_destruction'
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
    }
);

// =============================================================================
// CANON EXTRACTION ACTIONS (Step 5)
// =============================================================================

interface ExtractedCanonChange {
    type: 'death' | 'world_fact' | 'relationship' | 'timeline' | 'ability_loss' | 'location_destruction';
    eventKey: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
}

interface ExtractedThreadUpdate {
    threadId?: string;
    threadName: string;
    action: 'open' | 'progress' | 'resolve';
    description: string;
}

interface ExtractedStateChange {
    characterName: string;
    stateType: 'emotional' | 'physical' | 'relationship' | 'knowledge' | 'ability' | 'location' | 'goal';
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
        // Simple heuristic extraction (production would use LLM)
        const content = data.storyContent.toLowerCase();
        const immutableEvents: ExtractedCanonChange[] = [];
        const threadUpdates: ExtractedThreadUpdate[] = [];
        const stateChanges: ExtractedStateChange[] = [];

        // Detect death events
        const deathPatterns = [
            /(\w+) (?:died|was killed|passed away|perished)/gi,
            /the death of (\w+)/gi,
        ];
        for (const pattern of deathPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                const name = match[1];
                if (name && name.length > 2) {
                    immutableEvents.push({
                        type: 'death',
                        eventKey: `character:${name}:dead`,
                        description: `${name} died`,
                        confidence: 'medium',
                    });
                }
            }
        }

        // Detect world facts / location changes
        if (content.includes('destroyed') || content.includes('fallen')) {
            immutableEvents.push({
                type: 'location_destruction',
                eventKey: 'location:unknown:destroyed',
                description: 'A location was destroyed',
                confidence: 'low',
            });
        }

        // Detect thread resolutions (e.g., mystery solved, conflict resolved)
        if (content.includes('finally') || content.includes('resolved') || content.includes('discovered the truth')) {
            threadUpdates.push({
                threadName: 'Detected thread resolution',
                action: 'resolve',
                description: 'A narrative thread appears to be resolved',
            });
        }

        // Generate simple summary
        const words = data.storyContent.split(/\s+/).slice(0, 50).join(' ');
        const episodeSummary = words.length > 100 ? words.substring(0, 200) + '...' : words;

        // Simple sentiment (positive words vs negative words)
        const positiveWords = ['love', 'happy', 'peace', 'hope', 'joy', 'victory'];
        const negativeWords = ['death', 'war', 'fear', 'hate', 'loss', 'pain'];
        const positiveCount = positiveWords.filter((w) => content.includes(w)).length;
        const negativeCount = negativeWords.filter((w) => content.includes(w)).length;
        const sentimentScore = (positiveCount - negativeCount + 5) / 10; // Normalize to 0-1

        return {
            immutableEvents,
            threadUpdates,
            stateChanges,
            episodeSummary,
            sentimentScore: Math.max(0, Math.min(1, sentimentScore)),
        };
    },
    {
        schema: z.object({
            projectId: z.string().uuid(),
            episodeId: z.string().uuid(),
            storyContent: z.string(),
        }),
    }
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
        const results = {
            eventsCreated: 0,
            threadsUpdated: 0,
            summaryStored: false,
        };

        // Store immutable events
        for (const event of data.changes.immutableEvents) {
            if (event.confidence === 'high') {
                const { error } = await client.from('immutable_events').insert({
                    project_id: data.projectId,
                    event_type: event.type,
                    event_key: event.eventKey,
                    description: event.description,
                    established_in: data.episodeId,
                    season: data.season,
                    episode_number: data.episodeNumber,
                });
                if (!error) results.eventsCreated++;
            }
        }

        // Update episode metadata with summary (merge with existing)
        const { data: existing } = await client
            .from('episodes')
            .select('metadata')
            .eq('id', data.episodeId)
            .single();

        const { error: metaError } = await client
            .from('episodes')
            .update({
                metadata: {
                    ...((existing?.metadata as Record<string, unknown>) || {}),
                    canonSummary: data.changes.episodeSummary,
                    sentimentScore: data.changes.sentimentScore,
                },
            })
            .eq('id', data.episodeId);

        if (!metaError) results.summaryStored = true;

        return results;
    },
    {
        schema: z.object({
            projectId: z.string().uuid(),
            episodeId: z.string().uuid(),
            season: z.number().int().positive(),
            episodeNumber: z.number().int().positive(),
            changes: z.object({
                immutableEvents: z.array(z.object({
                    type: z.enum(['death', 'world_fact', 'relationship', 'timeline', 'ability_loss', 'location_destruction']),
                    eventKey: z.string(),
                    description: z.string(),
                    confidence: z.enum(['high', 'medium', 'low']),
                })),
                threadUpdates: z.array(z.object({
                    threadId: z.string().optional(),
                    threadName: z.string(),
                    action: z.enum(['open', 'progress', 'resolve']),
                    description: z.string(),
                })),
                episodeSummary: z.string(),
                sentimentScore: z.number().min(0).max(1),
            }),
        }),
    }
);
