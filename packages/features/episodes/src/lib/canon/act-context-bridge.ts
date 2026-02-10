/**
 * Act Context Bridge
 * FILM-1112: Movie act continuity system
 *
 * Captures narrative state at the end of each movie act and injects it
 * into the next act's generation to maintain continuity.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { Json } from '@kit/supabase/database';

import { sanitizeForPrompt } from '../sanitize-for-prompt';

/**
 * Cast a typed value to the Supabase `Json` column type.
 * See sequel-system.ts for detailed rationale.
 */
function toJsonb<T>(value: T): Json {
    return value as unknown as Json;
}

import type {
    ActContextBridge,
    CharacterActState,
} from '../../types/act-context';

// =============================================================================
// BUILD BRIDGE — Extract act-end state via LLM
// =============================================================================

/**
 * Build a context bridge from a completed act by using LLM extraction.
 * Stores the result in `act_context_bridges` for later retrieval.
 */
export async function buildActContextBridge(
    episodeId: string,
    actNumber: number,
    actContent: string,
): Promise<ActContextBridge> {
    const { executeLLM } = await import('@kit/prompt-engine/server');
    const supabase = getSupabaseServerClient();

    const extraction = await executeLLM<{ bridge: ActContextBridge }>({
        templateSlug: 'act-context-extraction',
        variables: {
            act_content: actContent,
            act_number: actNumber,
        },
        context: { name: 'act-context-bridge', accountId: '', userId: '' },
        supabaseClient: supabase,
    });

    const bridge = extraction.data.bridge;

    // Runtime-validate critical bridge fields before persisting
    if (
        !bridge ||
        typeof bridge.actNumber !== 'number' ||
        typeof bridge.characterStates !== 'object' ||
        !Array.isArray(bridge.openThreads)
    ) {
        throw new Error(
            `[act-context-bridge] LLM returned invalid bridge shape for episode ${episodeId} act ${actNumber}`,
        );
    }

    bridge.movieId = episodeId;
    bridge.actNumber = actNumber;

    // Persist to database
    await supabase.from('act_context_bridges').upsert({
        episode_id: episodeId,
        act_number: actNumber,
        act_title: bridge.actTitle,
        act_start_time: bridge.actStartTime,
        act_end_time: bridge.actEndTime,
        context_state: toJsonb(bridge),
        carry_forward_text: bridge.carryForwardContext,
    });

    return bridge;
}

// =============================================================================
// GET BRIDGE — Fetch stored bridge for next act injection
// =============================================================================

/**
 * Get the context bridge from a previous act for injection into the next act.
 * Returns null if no bridge exists (e.g., first act).
 */
export async function getActContextBridge(
    episodeId: string,
    previousActNumber: number,
): Promise<ActContextBridge | null> {
    const supabase = getSupabaseServerClient();

    const { data } = await supabase
        .from('act_context_bridges')
        .select('context_state')
        .eq('episode_id', episodeId)
        .eq('act_number', previousActNumber)
        .single();

    if (!data) return null;

    return data.context_state as unknown as ActContextBridge;
}

// =============================================================================
// FORMAT FOR PROMPT — Structured text for LLM injection
// =============================================================================

/**
 * Format a bridge into structured text sections for LLM prompt injection.
 * Produces sections: characters alive, dead characters, open threads,
 * current scene state, tone continuation, and carry-forward context.
 *
 * All user-derived text is sanitized for prompt safety, consistent with
 * researcher.ts, fact-checker.ts, and sequel-system.ts.
 */
export function formatBridgeForPrompt(bridge: ActContextBridge): string {
    const sections: string[] = [];

    // ---- Characters alive ----
    sections.push(`## CHARACTERS AT END OF ACT ${bridge.actNumber}`);

    const entries = Object.entries(bridge.characterStates);
    for (const [, state] of entries) {
        if (state.isAlive) {
            sections.push(
                `• ${sanitizeForPrompt(state.characterName)}: ${sanitizeForPrompt(state.emotionalState)} (at ${sanitizeForPrompt(state.location)})`,
            );
            if (state.injuries.length > 0) {
                sections.push(`  Injuries: ${state.injuries.map(sanitizeForPrompt).join(', ')}`);
            }
        }
    }

    // ---- Dead characters ----
    const dead = Object.values(bridge.characterStates).filter(
        (s: CharacterActState) => !s.isAlive,
    );
    if (dead.length > 0) {
        sections.push('');
        sections.push('## DEAD CHARACTERS (DO NOT INCLUDE)');
        for (const d of dead) {
            sections.push(`• ${sanitizeForPrompt(d.characterName)} - DECEASED`);
        }
    }

    // ---- Open plot threads ----
    if (bridge.openThreads.length > 0) {
        sections.push('');
        sections.push('## UNRESOLVED PLOT THREADS');
        const unresolvedPromises = bridge.promises.filter(
            (p) => !bridge.resolvedThreads.includes(p.id),
        );
        for (const p of unresolvedPromises) {
            sections.push(`• ${sanitizeForPrompt(p.description)} (priority: ${sanitizeForPrompt(p.priority)})`);
        }
    }

    // ---- Current scene state ----
    sections.push('');
    sections.push('## CURRENT SCENE STATE');
    sections.push(`Location: ${sanitizeForPrompt(bridge.currentLocation.locationName)}`);
    sections.push(`Time: ${sanitizeForPrompt(bridge.timeOfDay)}`);
    if (bridge.currentLocation.establishedDetails.length > 0) {
        sections.push(
            `Details: ${bridge.currentLocation.establishedDetails.map(sanitizeForPrompt).join(', ')}`,
        );
    }

    // ---- Tone ----
    sections.push('');
    sections.push('## TONE CONTINUATION');
    sections.push(
        `Stakes: ${bridge.stakesLevel}/10, Tension: ${bridge.tensionLevel}/10`,
    );

    // ---- Carry-forward summary ----
    sections.push('');
    sections.push('## CARRY FORWARD');
    sections.push(sanitizeForPrompt(bridge.carryForwardContext));

    return sections.join('\n');
}

// =============================================================================
// VALIDATE — Check next act against bridge constraints
// =============================================================================

/**
 * Validate generated act content against the previous act's bridge.
 * Currently detects dead character resurrection via regex patterns.
 */
export function validateAgainstBridge(
    nextActContent: string,
    bridge: ActContextBridge,
): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    // Check for dead character resurrection
    const deadNames = Object.values(bridge.characterStates)
        .filter((s: CharacterActState) => !s.isAlive)
        .map((s: CharacterActState) => s.characterName.toLowerCase());

    for (const name of deadNames) {
        // Escape special regex characters in character name
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
            `\\b${escaped}\\b.{0,30}(said|walked|ran|looked|smiled|laughed|spoke|whispered|shouted|nodded|grabbed|moved|reacted|cried|yelled)`,
            'i',
        );
        if (pattern.test(nextActContent)) {
            violations.push(
                `Dead character "${name}" appears to be acting in next act`,
            );
        }
    }

    return {
        valid: violations.length === 0,
        violations,
    };
}
