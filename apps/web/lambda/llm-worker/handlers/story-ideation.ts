/**
 * Story Ideation Handler
 *
 * Generates story ideas based on a premise.
 * No database writes - just returns ideas to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface StoryIdeationPayload {
    episodeId: string;
    premise: string;
    numberOfIdeas?: number;
    accountId: string;
    userId: string;
}

interface StoryIdea {
    title: string;
    logline: string;
    hook: string;
    conflict: string;
    themes: string[];
    visualPotential: string;
}

interface StoryIdeationResult {
    success: boolean;
    data: {
        ideas: StoryIdea[];
        metadata: {
            provider: string;
            model: string;
            costCents: number;
            tokensUsed: number;
            generatedAt: string;
        };
    };
}

export async function processStoryIdeation(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<StoryIdeationResult> {
    const data = payload as StoryIdeationPayload;

    console.log(`[Story Ideation] Processing for episode ${data.episodeId}`);

    // 1. Fetch episode with project context
    const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .select(`
            id, number, title, description, season_id,
            project:projects(
                id, account_id, metadata,
                seasons:seasons(id, number, premise)
            ),
            season:seasons(id, number, premise)
        `)
        .eq('id', data.episodeId)
        .single();

    if (episodeError || !episode) {
        throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    // 2. Fetch characters and locations for this project
    const projectId = episode.project?.id;

    const [charactersResult, locationsResult] = await Promise.all([
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', projectId)
            .eq('type', 'character')
            .is('deleted_at', null),
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', projectId)
            .eq('type', 'location')
            .is('deleted_at', null),
    ]);

    const characters = charactersResult.data || [];
    const locations = locationsResult.data || [];

    // 3. Build prompt variables
    const projectMetadata = episode.project?.metadata as Record<string, unknown> || {};
    const seasonPremise = episode.season?.premise || '';

    const formatCharacters = (chars: typeof characters) => {
        if (chars.length === 0) return 'No specific characters defined yet.';
        return chars.map(c => {
            const meta = c.metadata as Record<string, unknown> || {};
            return `- ${c.name}: ${c.description || ''}${meta.role ? ` (${meta.role})` : ''}`;
        }).join('\n');
    };

    const formatLocations = (locs: typeof locations) => {
        if (locs.length === 0) return 'No specific locations defined yet.';
        return locs.map(l => `- ${l.name}: ${l.description || ''}`).join('\n');
    };

    const variables = {
        premise: data.premise,
        number_of_ideas: data.numberOfIdeas || 3,
        characters: formatCharacters(characters),
        locations: formatLocations(locations),
        season_context: seasonPremise
            ? `This is Episode ${episode.number}. Season Premise: ${seasonPremise}`
            : '',
        previous_episodes: '', // Could fetch previous episodes if needed
        genre: projectMetadata.genre || 'general',
        target_audience: projectMetadata.targetAudience || 'general',
        visual_style: projectMetadata.videoStyle || 'cinematic',
        style: 'balanced',
        recurring_element: '',
    };

    // 4. Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    const result = await executeLLM<{ ideas: StoryIdea[] }>({
        templateSlug: 'story-generation/story-ideation',
        variables,
        context: {
            name: 'story-ideation',
            accountId: data.accountId,
            userId: data.userId,
        },
    });

    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    console.log(`[Story Ideation] Generated ${result.data.ideas.length} ideas`);

    return {
        success: true,
        data: {
            ideas: result.data.ideas,
            metadata: {
                provider: result.metadata.provider,
                model: result.metadata.model,
                costCents,
                tokensUsed: result.metadata.tokens,
                generatedAt,
            },
        },
    };
}
