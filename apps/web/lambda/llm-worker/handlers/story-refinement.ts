/**
 * Story Refinement Handler
 *
 * Refines an existing story based on user feedback.
 * Preserves previous story_data for undo capability.
 * Tracks refinement history in episode metadata.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import { executeLLMForLambda } from '../llm-utils';
import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatLocationsForPrompt,
  formatPreviousEpisodesForPrompt,
} from '../utils/context-builder';
import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface StoryRefinementPayload {
  episodeId: string;
  projectId: string;
  feedback: string;
  userId: string;
}

interface RefinementHistoryEntry {
  timestamp: string;
  feedback: string;
  type: 'story';
  userId: string;
}

interface StoryRefinementResult {
  success: boolean;
  data: {
    story: Record<string, unknown>;
    refinementApplied: boolean;
    episode: {
      id: string;
      status: string;
    };
    metadata: {
      provider: string;
      model: string;
      generatedAt: string;
    };
  };
}

export async function processStoryRefinement(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<StoryRefinementResult> {
  const data = payload as unknown as StoryRefinementPayload;

  console.log(`[Story Refinement] Processing for episode ${data.episodeId}`);

  await markJobProcessing(supabase, data.episodeId, 'story-refinement');

  try {
    // 1. Fetch current episode with story data
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select(
        `
        id, title, status, story_data, metadata,
        project:projects(id, account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    const storyData = episode.story_data as Record<string, unknown> | null;
    if (!storyData?.fullStory) {
      throw new Error('Episode must have a story before it can be refined');
    }

    // 2. Build episode context
    const episodeContext = await buildEpisodeContext(data.episodeId, supabase, {
      semanticContext: true,
      semanticQuery: [episode.title, storyData.episodeSummary]
        .filter((part): part is string => typeof part === 'string' && !!part)
        .join('\n'),
    });

    const charactersContext = formatCharactersForPrompt(
      episodeContext.characters,
    );
    const locationsContext = formatLocationsForPrompt(episodeContext.locations);
    const previousEpisodesContext = formatPreviousEpisodesForPrompt(
      episodeContext.previousEpisodes,
    );
    const seasonContext = episodeContext.seasonPremise
      ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
      : '';
    const directionNotes = episodeContext.seasonDirectionNotes
      ? `\n\n## SEASON CREATIVE DIRECTION (apply to this episode):\n${episodeContext.seasonDirectionNotes}`
      : '';

    console.log(
      `[Story Refinement] Context built: ${episodeContext.characters.length} characters, ${episodeContext.locations.length} locations`,
    );

    // 3. Call LLM with story-refinement template
    const result = await executeLLMForLambda<{
      story: Record<string, unknown>;
      newCharacters?: Array<{
        name: string;
        role: string;
        description: string;
      }>;
      newLocations?: Array<{ name: string; description: string }>;
    }>({
      templateSlug: 'story-refinement',
      variables: {
        current_story: JSON.stringify(storyData),
        characters: charactersContext || 'No characters defined.',
        locations: locationsContext || 'No locations defined.',
        feedback: data.feedback,
        season_context: seasonContext + directionNotes,
        previous_episodes: previousEpisodesContext,
      },
    });

    const refinedStory = result.data.story;
    const generatedAt = new Date().toISOString();

    console.log(
      `[Story Refinement] LLM response received. Tokens: ${result.metadata.tokens}`,
    );

    // 4. Guard: Skip write if episode was deleted
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', data.episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        '[Story Refinement] Episode was deleted during refinement. Skipping write.',
      );
      await markJobCompleted(supabase, data.episodeId, 'story-refinement', {
        skipped: true,
        reason: 'episode-deleted',
      });

      return {
        success: false,
        data: {
          story: {},
          refinementApplied: false,
          episode: { id: data.episodeId, status: 'draft' },
          metadata: {
            provider: 'skipped',
            model: 'skipped',
            generatedAt,
          },
        },
      };
    }

    // 5. Build updated story_data preserving existing metadata
    const updatedStoryData = {
      ...storyData,
      fullStory: refinedStory.fullText ?? storyData.fullStory,
      title: refinedStory.title ?? storyData.title,
      actBreakdown: refinedStory.actBreakdown ?? storyData.actBreakdown,
      characters: refinedStory.characters ?? storyData.characters,
      themes: refinedStory.themes ?? storyData.themes,
      tone: refinedStory.tone ?? storyData.tone,
      estimatedSceneCount:
        refinedStory.estimatedSceneCount ?? storyData.estimatedSceneCount,
      episodeSummary: refinedStory.episodeSummary ?? storyData.episodeSummary,
      sentimentScore: refinedStory.sentimentScore ?? storyData.sentimentScore,
      keyEvents: refinedStory.keyEvents ?? storyData.keyEvents,
      viralStructure: refinedStory.viralStructure ?? storyData.viralStructure,
      lastRefinedAt: generatedAt,
    };

    // 6. Save previous story_data and update refinement history in metadata
    const currentMetadata = (episode.metadata as Record<string, unknown>) ?? {};
    const refinementHistory =
      (currentMetadata.refinement_history as RefinementHistoryEntry[]) ?? [];

    refinementHistory.push({
      timestamp: generatedAt,
      feedback: data.feedback,
      type: 'story',
      userId: data.userId,
    });

    const updatedMetadata = {
      ...currentMetadata,
      previous_story_data: storyData,
      refinement_history: refinementHistory,
    };

    // 7. Update episode
    const { data: updatedEpisode, error: updateError } = await supabase
      .from('episodes')
      .update({
        story_data: updatedStoryData as unknown as Json,
        metadata: updatedMetadata as unknown as Json,
        updated_at: generatedAt,
      })
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .select('id, status')
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode not found or was deleted');
    }

    console.log(
      `[Story Refinement] Story refined successfully for episode ${data.episodeId}`,
    );

    await markJobCompleted(supabase, data.episodeId, 'story-refinement', {
      provider: result.metadata.provider,
      model: result.metadata.model,
      tokensUsed: result.metadata.tokens,
      feedback: data.feedback.substring(0, 200),
    });

    return {
      success: true,
      data: {
        story: updatedStoryData,
        refinementApplied: true,
        episode: {
          id: updatedEpisode.id,
          status: updatedEpisode.status,
        },
        metadata: {
          provider: result.metadata.provider,
          model: result.metadata.model,
          generatedAt,
        },
      },
    };
  } catch (error) {
    await markJobFailed(
      supabase,
      data.episodeId,
      'story-refinement',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
