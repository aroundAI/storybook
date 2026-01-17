/**
 * Story Generation Handler
 *
 * Generates a full story from a selected idea.
 * Uses buildEpisodeContext for rich context (same as local server action).
 * WRITES TO DATABASE: Updates episode.story_data and status
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
    buildEpisodeContext,
    formatCharactersForPrompt,
    formatLocationsForPrompt,
    formatPreviousEpisodesForPrompt,
    formatRecurringElementForPrompt,
    formatBeatsForPrompt,
} from '../utils/context-builder';
import {
    markJobProcessing,
    markJobCompleted,
    markJobFailed,
} from '../utils/job-tracking';

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


// Import shared content scaling utilities
import {
    calculateContentScaling,
    formatDuration,
    type ContentStyle,
} from '../utils/duration-scaling';


export async function processStoryGeneration(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<StoryGenerationResult> {
    const data = payload as StoryGenerationPayload;

    console.log(`[Story Generation] Processing for episode ${data.episodeId}`);

    // Mark job as processing
    await markJobProcessing(supabase, data.episodeId, 'story');

    try {
        // 1. Build rich context using shared context-builder (matches local server action)
        const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

        // 2. Calculate content scaling based on target duration
        const contentStyle = (data.contentStyle ?? 'dialogue-heavy') as ContentStyle;
        const scaling = calculateContentScaling({
            targetDurationSeconds: data.targetDuration,
            contentStyle,
        });

        // 3. Prepare variables for prompt template (same logic as local server action)
        const variables = {
            title: data.title,
            logline: data.logline,
            premise: episodeContext.premise,
            target_duration: data.targetDuration,
            duration_description: formatDuration(data.targetDuration),
            word_count_min: scaling.story.wordCountMin,
            word_count_max: scaling.story.wordCountMax,
            estimated_scene_count_min: scaling.screenplay.sceneCountMin,
            estimated_scene_count_max: scaling.screenplay.sceneCountMax,
            content_style: contentStyle,
            characters: formatCharactersForPrompt(episodeContext.characters),
            locations: formatLocationsForPrompt(episodeContext.locations),
            season_context: episodeContext.seasonPremise
                ? `This is Episode ${episodeContext.episodeNumber} of Season ${episodeContext.seasonNumber}. Season Premise: ${episodeContext.seasonPremise}`
                : '',
            previous_episodes: formatPreviousEpisodesForPrompt(episodeContext.previousEpisodes),
            genre: episodeContext.genre,
            target_audience: episodeContext.targetAudience,
            visual_style: episodeContext.visualStyle,
            style: data.style ?? 'balanced',
            recurring_element: formatRecurringElementForPrompt(episodeContext.recurringElement),
            plot_beats: formatBeatsForPrompt({
                synopsis: episodeContext.synopsis,
                beats: episodeContext.beats,
                moral: episodeContext.moral,
                signatureLine: episodeContext.signatureLine,
            }),
        };

        // 4. Execute LLM
        const { executeLLM } = await import('@kit/prompt-engine/server');

        const result = await executeLLM<{ story: StoryOutput }>({
            templateSlug: 'story-generation',
            variables,
            context: {
                name: 'story-generation',
                accountId: data.accountId,
                userId: data.userId,
            },
            supabaseClient: supabase,
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
            contentStyle: contentStyle,
            genre: episodeContext.genre,
            targetAudience: episodeContext.targetAudience,
            videoStyle: episodeContext.visualStyle,
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

        // Mark job as completed
        await markJobCompleted(supabase, data.episodeId, 'story', {
            model: result.metadata.model,
            provider: result.metadata.provider,
            costCents,
        });

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
    } catch (error) {
        // Mark job as failed
        await markJobFailed(
            supabase,
            data.episodeId,
            'story',
            error instanceof Error ? error.message : 'Unknown error',
        );
        throw error;
    }
}
