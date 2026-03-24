/**
 * Commit Story Canon
 *
 * After story generation, auto-populates Canon tables from the structured
 * LLM output so the Canon Dashboard has data to show immediately.
 *
 * Steps:
 *  0. CLEANUP — delete stale canon established by this episode
 *  1. immutable_events  — key events extracted from the story
 *  2. character_states  — character arcs for characters found in project assets
 *  3. narrative_threads — a thread for the episode's main story arc
 *
 * All writes are non-fatal: failures are logged but don't break generation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CommitStoryCanonInput {
    projectId: string;
    episodeId: string;
    episodeNumber: number;
    season: number;
    keyEvents: string[];
    characters: Array<{ name: string; role: string; arc: string }>;
    episodeSummary?: string;
    themes?: string[];
    createdBy: string;
    supabase: SupabaseClient;
}

/**
 * Converts a free-text event description to a canonical event key slug.
 */
function toEventKey(text: string, episodeNumber: number): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60);
    return `${slug}-ep${episodeNumber}`;
}

export async function commitStoryCanon(input: CommitStoryCanonInput): Promise<void> {
    const {
        projectId,
        episodeId,
        episodeNumber,
        season,
        keyEvents,
        characters,
        episodeSummary,
        themes,
        createdBy,
        supabase,
    } = input;

    // Step 0: Remove stale canon from any previous story generation for this episode.
    // This makes regeneration idempotent — new story replaces old canon cleanly.
    await cleanupEpisodeCanon(episodeId, supabase);

    const results = await Promise.allSettled([
        commitKeyEvents({ projectId, episodeId, episodeNumber, season, keyEvents, createdBy, supabase }),
        commitCharacterStates({ projectId, episodeId, characters, supabase }),
        commitNarrativeThread({ projectId, episodeId, episodeSummary, themes, supabase }),
    ]);

    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('[commitStoryCanon] Non-fatal failure:', result.reason);
        }
    }
}

// ─── Step 0: Cleanup ─────────────────────────────────────────────────────────

/**
 * Deletes all canon data that was established by this specific episode.
 * Called at the start of commitStoryCanon so regeneration is idempotent.
 * FK CASCADE on episode deletion handles the delete-episode case separately.
 */
export async function cleanupEpisodeCanon(
    episodeId: string,
    supabase: SupabaseClient,
): Promise<void> {
    const results = await Promise.allSettled([
        supabase.from('immutable_events').delete().eq('established_in', episodeId),
        supabase.from('character_states').delete().eq('episode_id', episodeId),
        supabase.from('narrative_threads').delete().eq('opened_at', episodeId),
    ]);

    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('[commitStoryCanon] Cleanup step failed:', result.reason);
        }
    }

    console.log(`[commitStoryCanon] Cleaned up stale canon for episode ${episodeId}`);
}

// ─── Step 1: Key Events ───────────────────────────────────────────────────────

async function commitKeyEvents({
    projectId,
    episodeId,
    episodeNumber,
    season,
    keyEvents,
    createdBy,
    supabase,
}: {
    projectId: string;
    episodeId: string;
    episodeNumber: number;
    season: number;
    keyEvents: string[];
    createdBy: string;
    supabase: SupabaseClient;
}) {
    if (!keyEvents.length) return;

    const toInsert = keyEvents.map((text) => ({
        project_id: projectId,
        event_type: 'world_fact' as const,
        event_key: toEventKey(text, episodeNumber),
        established_in: episodeId,
        season,
        episode_number: episodeNumber,
        description: text,
        metadata: { auto_generated: true, source: 'story_generation' },
        created_by: createdBy,
    }));

    const { error } = await supabase.from('immutable_events').insert(toInsert);
    if (error) {
        throw new Error(`immutable_events insert failed: ${error.message}`);
    }
    console.log(`[commitStoryCanon] Committed ${toInsert.length} key events`);
}

// ─── Step 2: Character States ─────────────────────────────────────────────────

async function commitCharacterStates({
    projectId,
    episodeId,
    characters,
    supabase,
}: {
    projectId: string;
    episodeId: string;
    characters: Array<{ name: string; role: string; arc: string }>;
    supabase: SupabaseClient;
}) {
    if (!characters.length) return;

    const names = characters.map((c) => c.name);
    const { data: assets } = await supabase
        .from('assets')
        .select('id, name')
        .eq('project_id', projectId)
        .eq('type', 'character')
        .in('name', names);

    if (!assets?.length) {
        console.log('[commitStoryCanon] No matching character assets found, skipping states');
        return;
    }

    const assetByName = new Map(
        (assets as Array<{ id: string; name: string }>).map((a) => [a.name.toLowerCase(), a.id]),
    );

    const toInsert = characters
        .filter((c) => assetByName.has(c.name.toLowerCase()))
        .map((c) => ({
            character_id: assetByName.get(c.name.toLowerCase())!,
            episode_id: episodeId,
            state_type: 'goal',
            state_value: { arc: c.arc, role: c.role },
            trigger_event: 'story_generation',
        }));

    if (!toInsert.length) return;

    const { error } = await supabase.from('character_states').insert(toInsert);
    if (error) {
        throw new Error(`character_states insert failed: ${error.message}`);
    }
    console.log(`[commitStoryCanon] Committed ${toInsert.length} character states`);
}

// ─── Step 3: Narrative Thread ─────────────────────────────────────────────────

async function commitNarrativeThread({
    projectId,
    episodeId,
    episodeSummary,
    themes,
    supabase,
}: {
    projectId: string;
    episodeId: string;
    episodeSummary?: string;
    themes?: string[];
    supabase: SupabaseClient;
}) {
    if (!episodeSummary) return;

    // Note: no created_by column in narrative_threads
    const { error } = await supabase.from('narrative_threads').insert({
        project_id: projectId,
        thread_name: 'Episode arc',
        thread_type: 'plot',
        opened_at: episodeId,
        description: episodeSummary,
        promises: themes ?? [],
        status: 'open',
    });

    if (error) {
        throw new Error(`narrative_threads insert failed: ${error.message}`);
    }
    console.log('[commitStoryCanon] Committed narrative thread for episode');
}
