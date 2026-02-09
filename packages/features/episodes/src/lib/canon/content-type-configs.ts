/**
 * Content Type Configurations
 * Phase 11.2: FILM-1110
 *
 * Maps each ProjectType to canon management rules, memory strategies,
 * validation behaviors, and LLM role pipelines.
 */

import type { ProjectType } from '@kit/film-studio-schemas/project';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// TYPES
// =============================================================================

export type DecayFunction = 'linear' | 'exponential' | 'topic_match' | 'none';

export interface ContentTypeConfig {
    /** Number of episodes/acts to include in memory context */
    memoryHorizon: number;

    /** How memory priority decays over time */
    decayFunction: DecayFunction;

    /** Token budget percentage of context window for memory */
    contextWindowPercent: number;

    /** Token budget allocation percentages (must sum to 100) */
    allocations: {
        events: number;
        characters: number;
        world: number;
        threads: number;
        summaries: number;
        facts?: number;
        external?: number;
    };

    /** Validation strictness for continuity checks */
    enforcement: 'strict' | 'flexible' | 'none';

    /** Whether verified facts are required for generation */
    requiresFacts: boolean;

    /** Whether external context providers (news APIs, research) are used */
    requiresExternalContext: boolean;

    /** LLM roles for generation pipeline */
    roles: string[];
}

// =============================================================================
// CONFIGS
// =============================================================================

/**
 * Configuration mapping for each project type.
 *
 * Allocation percentages within each config must sum to 100.
 * - `facts` and `external` are only present for types that need them.
 */
export const CONTENT_TYPE_CONFIGS: Record<ProjectType, ContentTypeConfig> = {
    'short-film': {
        memoryHorizon: 10,
        decayFunction: 'exponential',
        contextWindowPercent: 15,
        allocations: {
            events: 35,
            characters: 25,
            world: 15,
            threads: 15,
            summaries: 10,
        },
        enforcement: 'strict',
        requiresFacts: false,
        requiresExternalContext: false,
        roles: ['planner', 'writer', 'editor', 'stylist'],
    },

    series: {
        memoryHorizon: 50,
        decayFunction: 'linear',
        contextWindowPercent: 18,
        allocations: {
            events: 35,
            characters: 25,
            world: 10,
            threads: 20,
            summaries: 10,
        },
        enforcement: 'strict',
        requiresFacts: false,
        requiresExternalContext: false,
        roles: ['planner', 'writer', 'editor', 'stylist'],
    },

    documentary: {
        memoryHorizon: 5,
        decayFunction: 'topic_match',
        contextWindowPercent: 10,
        allocations: {
            events: 15,
            characters: 10,
            world: 10,
            threads: 10,
            summaries: 10,
            facts: 25,
            external: 20,
        },
        enforcement: 'strict',
        requiresFacts: true,
        requiresExternalContext: true,
        roles: ['researcher', 'fact-checker', 'writer', 'stylist'],
    },

    educational: {
        memoryHorizon: 5,
        decayFunction: 'topic_match',
        contextWindowPercent: 12,
        allocations: {
            events: 20,
            characters: 15,
            world: 10,
            threads: 20,
            summaries: 15,
            facts: 20,
        },
        enforcement: 'flexible',
        requiresFacts: true,
        requiresExternalContext: false,
        roles: ['researcher', 'writer', 'editor', 'stylist'],
    },

    ad: {
        memoryHorizon: 1,
        decayFunction: 'none',
        contextWindowPercent: 10,
        allocations: {
            events: 20,
            characters: 40,
            world: 20,
            threads: 10,
            summaries: 10,
        },
        enforcement: 'flexible',
        requiresFacts: false,
        requiresExternalContext: false,
        roles: ['writer', 'stylist'],
    },

    news: {
        memoryHorizon: 1,
        decayFunction: 'none',
        contextWindowPercent: 5,
        allocations: {
            events: 5,
            characters: 5,
            world: 5,
            threads: 5,
            summaries: 5,
            facts: 10,
            external: 65,
        },
        enforcement: 'strict',
        requiresFacts: true,
        requiresExternalContext: true,
        roles: ['aggregator', 'fact-checker', 'anchor', 'producer'],
    },
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get configuration for a project type.
 * Falls back to `series` config if the type is unknown.
 */
export function getContentTypeConfig(
    projectType: ProjectType,
): ContentTypeConfig {
    const config = CONTENT_TYPE_CONFIGS[projectType];
    if (!config) {
        return CONTENT_TYPE_CONFIGS.series;
    }
    return config;
}

/**
 * Get the project type from the project's metadata settings.
 * Falls back to `series` if not set.
 */
export async function getProjectContentType(
    projectId: string,
): Promise<ProjectType> {
    const client = getSupabaseServerClient();

    const { data } = await client
        .from('projects')
        .select('metadata')
        .eq('id', projectId)
        .single();

    const metadata = data?.metadata as
        | { projectType?: ProjectType }
        | null
        | undefined;

    return metadata?.projectType ?? 'series';
}
