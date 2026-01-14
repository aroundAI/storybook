/**
 * Story Generation Handler
 *
 * Generates a full story from a selected idea.
 * WRITES TO DATABASE: Updates episode.story_data and status
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface StoryGenerationPayload {
    episodeId: string;
    title: string;
    logline: string;
    targetDuration: number;
    contentStyle: string;
    style?: string;
    version: number;
    accountId: string;
    userId: string;
    projectId: string;
}

interface StoryOutput {
    fullText: string;
    title: string;
    actBreakdown: Array<{ act: number; summary: string }>;
    characters: string[];
    themes: string[];
    tone: string;
    estimatedSceneCount: number;
    episodeSummary?: string;
    sentimentScore?: number;
    keyEvents?: string[];
}

interface StoryGenerationResult {
    success: boolean;
    data: {
        story: StoryOutput;
        episode: {
            id: string;
            status: string;
            version: number;
        };
        metadata: {
            provider: string;
            model: string;
            costCents: number;
            tokensUsed: number;
            generatedAt: string;
        };
    };
}

export async function processStoryGeneration(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<StoryGenerationResult> {
    const data = payload as StoryGenerationPayload;

    console.log(`[Story Generation] Processing for episode ${data.episodeId}`);

    // 1. Fetch episode with project context
    const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .select(`
            id, number, title, description, version, status, season_id,
            metadata, project_id,
            project:projects(id, account_id, metadata),
            season:seasons(id, number, premise)
        `)
        .eq('id', data.episodeId)
        .single();

    if (episodeError || !episode) {
        throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    // 2. Fetch characters and locations
    const [charactersResult, locationsResult] = await Promise.all([
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', data.projectId)
            .eq('type', 'character')
            .is('deleted_at', null),
        supabase
            .from('assets')
            .select('id, name, description, metadata')
            .eq('project_id', data.projectId)
            .eq('type', 'location')
            .is('deleted_at', null),
    ]);

    const characters = charactersResult.data || [];
    const locations = locationsResult.data || [];

    // 3. Build prompt variables
    const projectMetadata = (episode.project?.metadata as Record<string, unknown>) || {};
    const episodeMetadata = (episode.metadata as Record<string, unknown>) || {};
    const seasonPremise = episode.season?.premise || '';

    const formatCharacters = (chars: typeof characters) => {
        if (chars.length === 0) return 'No specific characters defined.';
        return chars.map(c => {
            const meta = c.metadata as Record<string, unknown> || {};
            return `- ${c.name}: ${c.description || ''}${meta.personality ? ` Personality: ${meta.personality}` : ''}`;
        }).join('\n');
    };

    const formatLocations = (locs: typeof locations) => {
        if (locs.length === 0) return 'No specific locations defined.';
        return locs.map(l => `- ${l.name}: ${l.description || ''}`).join('\n');
    };

    // Calculate target word count from duration
    const wordsPerMinute = data.contentStyle === 'dialogue-heavy' ? 150 : 120;
    const targetWordCount = Math.round((data.targetDuration / 60) * wordsPerMinute);

    const variables = {
        title: data.title,
        logline: data.logline,
        target_word_count: targetWordCount,
        content_style: data.contentStyle,
        characters: formatCharacters(characters),
        locations: formatLocations(locations),
        season_context: seasonPremise
            ? `Episode ${episode.number} of Season ${episode.season?.number}. Season Premise: ${seasonPremise}`
            : '',
        previous_episodes: '', // Could fetch if needed
        genre: projectMetadata.genre || 'general',
        target_audience: projectMetadata.targetAudience || 'general',
        visual_style: projectMetadata.videoStyle || 'cinematic',
        style: data.style || 'balanced',
        recurring_element: '',
        plot_beats: episodeMetadata.beats
            ? JSON.stringify(episodeMetadata.beats)
            : '',
    };

    // 4. Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    const result = await executeLLM<{ story: StoryOutput }>({
        templateSlug: 'story-generation/story-generation',
        variables,
        context: {
            name: 'story-generation',
            accountId: data.accountId,
            userId: data.userId,
        },
    });

    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    // 5. Prepare story_data for episode
    const storyData = {
        premise: data.logline,
        fullStory: result.data.story.fullText,
        generatedAt,
        generatedBy: {
            model: result.metadata.model,
            provider: result.metadata.provider,
            costCents,
        },
        title: result.data.story.title,
        actBreakdown: result.data.story.actBreakdown,
        characters: result.data.story.characters,
        themes: result.data.story.themes,
        tone: result.data.story.tone,
        estimatedSceneCount: result.data.story.estimatedSceneCount,
        targetDuration: data.targetDuration,
        contentStyle: data.contentStyle,
        genre: projectMetadata.genre,
        targetAudience: projectMetadata.targetAudience,
        videoStyle: projectMetadata.videoStyle,
        episodeSummary: result.data.story.episodeSummary,
        sentimentScore: result.data.story.sentimentScore,
        keyEvents: result.data.story.keyEvents,
    };

    // 6. UPDATE DATABASE: episode.story_data + status = 'story'
    const { data: updatedEpisode, error: updateError } = await supabase
        .from('episodes')
        .update({
            story_data: storyData,
            status: 'story',
            target_duration_seconds: data.targetDuration,
            updated_at: new Date().toISOString(),
        })
        .eq('id', data.episodeId)
        .eq('version', data.version)
        .is('deleted_at', null)
        .select()
        .single();

    if (updateError) {
        throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
        throw new Error('Episode was modified by another user (optimistic lock failed)');
    }

    console.log(`[Story Generation] Episode updated, word count: ${result.data.story.fullText.split(/\s+/).length}`);

    return {
        success: true,
        data: {
            story: result.data.story,
            episode: {
                id: updatedEpisode.id,
                status: updatedEpisode.status,
                version: updatedEpisode.version,
            },
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
