/**
 * Commit Story Canon
 *
 * After story generation, auto-populates Canon tables from the structured
 * LLM output so the Canon Dashboard has data to show immediately.
 *
 * Writes:
 *  - immutable_events  — key events extracted from the story
 *  - character_states  — character arcs for characters found in project assets
 *  - narrative_threads — a thread for the episode's main story arc
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
 * e.g.  "Dante discovers the knot is tied backwards" → "dante-discovers-knot-tied-backwards-ep2"
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

    const results = await Promise.allSettled([
        commitKeyEvents({ projectId, episodeId, episodeNumber, season, keyEvents, createdBy, supabase }),
        commitCharacterStates({ projectId, episodeId, characters, createdBy, supabase }),
        commitNarrativeThread({ projectId, episodeId, episodeSummary, themes, createdBy, supabase }),
    ]);

    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('[commitStoryCanon] Non-fatal failure:', result.reason);
        }
    }
}

// ─── Key Events ──────────────────────────────────────────────────────────────

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

    // Get existing event keys to skip duplicates
    const { data: existing } = await supabase
        .from('immutable_events')
        .select('event_key')
        .eq('project_id', projectId);

    const existingKeys = new Set((existing ?? []).map((e: { event_key: string }) => e.event_key));

    const toInsert = keyEvents
        .map((text) => ({
            project_id: projectId,
            event_type: 'world_fact' as const,
            event_key: toEventKey(text, episodeNumber),
            established_in: episodeId,
            season,
            episode_number: episodeNumber,
            description: text,
            metadata: { auto_generated: true, source: 'story_generation' },
            created_by: createdBy,
        }))
        .filter((row) => !existingKeys.has(row.event_key));

    if (!toInsert.length) {
        console.log('[commitStoryCanon] All key events already exist, skipping');
        return;
    }

    const { error } = await supabase.from('immutable_events').insert(toInsert);
    if (error) {
        throw new Error(`immutable_events insert failed: ${error.message}`);
    }
    console.log(`[commitStoryCanon] Committed ${toInsert.length} key events`);
}

// ─── Character States ─────────────────────────────────────────────────────────

async function commitCharacterStates({
    projectId,
    episodeId,
    characters,
    createdBy,
    supabase,
}: {
    projectId: string;
    episodeId: string;
    characters: Array<{ name: string; role: string; arc: string }>;
    createdBy: string;
    supabase: SupabaseClient;
}) {
    if (!characters.length) return;

    // Look up character asset IDs by name (case-insensitive)
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
            created_by: createdBy,
        }));

    if (!toInsert.length) return;

    const { error } = await supabase.from('character_states').insert(toInsert);
    if (error) {
        throw new Error(`character_states insert failed: ${error.message}`);
    }
    console.log(`[commitStoryCanon] Committed ${toInsert.length} character states`);
}

// ─── Narrative Thread ─────────────────────────────────────────────────────────

async function commitNarrativeThread({
    projectId,
    episodeId,
    episodeSummary,
    themes,
    createdBy,
    supabase,
}: {
    projectId: string;
    episodeId: string;
    episodeSummary?: string;
    themes?: string[];
    createdBy: string;
    supabase: SupabaseClient;
}) {
    if (!episodeSummary) return;

    // Check if a thread for this episode already exists
    const { data: existing } = await supabase
        .from('narrative_threads')
        .select('id')
        .eq('project_id', projectId)
        .eq('opened_at', episodeId)
        .eq('thread_type', 'plot')
        .limit(1)
        .maybeSingle();

    if (existing) {
        console.log('[commitStoryCanon] Narrative thread for this episode already exists, skipping');
        return;
    }

    const { error } = await supabase.from('narrative_threads').insert({
        project_id: projectId,
        thread_name: `Episode arc`,
        thread_type: 'plot',
        opened_at: episodeId,
        description: episodeSummary,
        promises: themes ?? [],
        status: 'open',
        created_by: createdBy,
    });

    if (error) {
        throw new Error(`narrative_threads insert failed: ${error.message}`);
    }
    console.log('[commitStoryCanon] Committed narrative thread for episode');
}
