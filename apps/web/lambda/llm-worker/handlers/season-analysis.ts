/**
 * Season Analysis Handler
 *
 * Processes roadmap analysis LLM calls for season generation.
 * Extracts premise, characters, locations, and episodes from user's roadmap.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeLLMForLambda } from '../llm-utils';

interface EpisodeBeat {
    label: string;
    content: string;
}

interface ExtractedEpisode {
    number: number;
    title: string;
    synopsis: string;
    beats: EpisodeBeat[];
    moral?: string | null;
    signature_line?: string | null;
    character_names?: string[];
    location_names?: string[];
    characterNames?: string[];
    locationNames?: string[];
    tags?: string[];
    description?: string; // Legacy support
}

interface AnalysisResult {
    premise: string;
    tone?: string | null;
    target_audience?: string | null;
    characters: Array<{ name: string; role: string; description: string }>;
    locations: Array<{ name: string; setting: string; description: string }>;
    episodes: ExtractedEpisode[];
}

interface SeasonAnalysisPayload {
    projectId: string;
    roadmap: string;
}

/**
 * Process season analysis LLM call
 * This is the same logic as analyzeSeasonRoadmapAction, but runs in Lambda
 */
export async function processSeasonAnalysis(
    payload: Record<string, unknown>,
    _supabase: SupabaseClient,
): Promise<{ success: boolean; data: AnalysisResult }> {
    const { projectId, roadmap } = payload as SeasonAnalysisPayload;

    console.log(`[Season Analysis] Processing for project ${projectId}`);

    // Use Lambda-safe LLM executor
    const { data: result } = await executeLLMForLambda<AnalysisResult>({
        templateSlug: 'season-generation',
        variables: { roadmap },
    });

    // Validate required fields
    if (!result.episodes || !Array.isArray(result.episodes)) {
        throw new Error('Invalid response format: missing episodes array');
    }

    if (!result.premise || typeof result.premise !== 'string') {
        result.premise = 'Generated from roadmap';
    }

    if (!result.characters || !Array.isArray(result.characters)) {
        result.characters = [];
    }

    if (!result.locations || !Array.isArray(result.locations)) {
        result.locations = [];
    }

    console.log('[Season Analysis] Success:', {
        episodeCount: result.episodes.length,
        characterCount: result.characters.length,
        locationCount: result.locations.length,
    });

    return { success: true, data: result };
}

