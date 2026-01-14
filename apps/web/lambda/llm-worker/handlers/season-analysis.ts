/**
 * Season Analysis Handler
 *
 * Processes roadmap analysis LLM calls for season generation.
 * Extracts premise, characters, locations, and episodes from user's roadmap.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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

    // 1. Load and render prompt template
    const { loadAndRenderPrompt } = await import('@kit/prompt-engine/server');
    const renderedPrompt = await loadAndRenderPrompt('season-generation', {
        roadmap,
    });

    // 2. Determine API key based on provider from prompt template
    const provider = renderedPrompt.llmConfig.provider || 'deepseek';
    let apiKey: string | undefined;

    switch (provider) {
        case 'gemini':
            apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            break;
        case 'deepseek':
            apiKey = process.env.DEEPSEEK_API_KEY;
            break;
        case 'openai':
            apiKey = process.env.OPENAI_API_KEY;
            break;
        case 'anthropic':
            apiKey = process.env.ANTHROPIC_API_KEY;
            break;
        default:
            apiKey = process.env.DEEPSEEK_API_KEY;
    }

    if (!apiKey) {
        throw new Error(`API key not configured for provider: ${provider}`);
    }

    const { createLLMClient } = await import('@kit/llm');

    const llm = createLLMClient({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: provider as any,
        model: renderedPrompt.llmConfig.model,
        apiKey,
        temperature: renderedPrompt.llmConfig.temperature,
        maxTokens: renderedPrompt.llmConfig.max_tokens,
    });

    const messages = [
        { role: 'system', content: renderedPrompt.systemPrompt },
        { role: 'user', content: renderedPrompt.userPrompt },
    ];

    const response = await llm.createChatCompletion({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
    });

    const content = response.message.content;

    if (!content) throw new Error('Empty response from LLM');

    // Enhanced JSON extraction: handle markdown fences and whitespace
    let jsonString = content.trim();

    // Remove markdown code fences if present
    const codeBlockMatch = jsonString.match(
        /```(?:json)?\s*\n([\s\S]*?)\n```/,
    );
    if (codeBlockMatch && codeBlockMatch[1]) {
        jsonString = codeBlockMatch[1].trim();
    }

    // Attempt to parse JSON
    let result: AnalysisResult;
    try {
        result = JSON.parse(jsonString) as AnalysisResult;
    } catch (parseError) {
        console.error('[Season Analysis] JSON parse error:', {
            contentLength: content.length,
            contentPreview: content.substring(0, 500),
        });

        throw new Error(
            'LLM returned invalid JSON. The response may have been truncated.',
        );
    }

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
