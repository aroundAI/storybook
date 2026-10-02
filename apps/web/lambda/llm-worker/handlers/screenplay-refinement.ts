/**
 * Screenplay Refinement Handler
 *
 * Refines an existing screenplay based on user feedback.
 * Preserves previous screenplay_data for undo capability.
 * Tracks refinement history in episode metadata.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeForPrompt, sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import { whyNoRow } from '@kit/shared/rows';
import type { Database, Json } from '@kit/supabase/database';

import { executeLLMForLambda } from '../llm-utils';
import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatLocationsForPrompt,
} from '../utils/context-builder';
import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface RefinementHistoryEntry {
  timestamp: string;
  feedback: string;
  type: 'screenplay';
  userId: string;
}

interface ScreenplayRefinementResult {
  success: boolean;
  data: {
    screenplay: Record<string, unknown>;
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

export async function processScreenplayRefinement(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<ScreenplayRefinementResult> {
  const data = parseLlmJobPayload('screenplay-refinement', payload);

  console.log(
    `[Screenplay Refinement] Processing for episode ${data.episodeId}`,
  );

  await markJobProcessing(supabase, data.episodeId, 'screenplay-refinement');

  try {
    // 1. Fetch current episode with screenplay and story data
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select(
        `
        id, title, status, screenplay_data, story_data, metadata,
        project:projects(id, account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error(whyNoRow(episodeError, 'Episode not found'));
    }

    const screenplayData = episode.screenplay_data as Record<
      string,
      unknown
    > | null;
    if (!screenplayData?.scenes) {
      throw new Error(
        'Episode must have a screenplay before it can be refined',
      );
    }

    const storyData = episode.story_data as Record<string, unknown> | null;

    // 2. Build episode context
    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

    const charactersContext = formatCharactersForPrompt(
      episodeContext.characters,
    );
    const locationsContext = formatLocationsForPrompt(episodeContext.locations);

    console.log(
      `[Screenplay Refinement] Context built: ${episodeContext.characters.length} characters, ${episodeContext.locations.length} locations`,
    );

    // 3. Call LLM with screenplay-refinement template
    const result = await executeLLMForLambda<{
      screenplay: {
        scenes: Array<Record<string, unknown>>;
        metadata: Record<string, unknown>;
      };
    }>({
      templateSlug: 'screenplay-refinement',
      accountId: data.accountId,
      userId: data.userId,
      operationName: 'screenplay-refinement',
      variables: {
        // Stored text and the user's feedback, defused for the model (KB-101)
        current_screenplay: JSON.stringify(sanitizeStrings(screenplayData)),
        story_text: sanitizeForPrompt((storyData?.fullStory as string) ?? ''),
        characters: charactersContext || 'No characters defined.',
        locations: locationsContext || 'No locations defined.',
        feedback: sanitizeForPrompt(data.feedback),
      },
    });

    const refinedScreenplay = result.data.screenplay;
    const generatedAt = new Date().toISOString();

    console.log(
      `[Screenplay Refinement] LLM response received. Scenes: ${refinedScreenplay.scenes.length}, Tokens: ${result.metadata.tokens}`,
    );

    // 4. Guard: Skip write if episode was deleted
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', data.episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        '[Screenplay Refinement] Episode was deleted during refinement. Skipping write.',
      );
      await markJobCompleted(
        supabase,
        data.episodeId,
        'screenplay-refinement',
        {
          skipped: true,
          reason: 'episode-deleted',
        },
      );

      return {
        success: false,
        data: {
          screenplay: {},
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

    // 5. Build updated screenplay_data
    const updatedScreenplayData = {
      ...screenplayData,
      scenes: refinedScreenplay.scenes,
      metadata: refinedScreenplay.metadata,
      lastRefinedAt: generatedAt,
    };

    // 6. Save previous screenplay_data and update refinement history in metadata
    const currentMetadata = (episode.metadata as Record<string, unknown>) ?? {};
    const refinementHistory =
      (currentMetadata.refinement_history as RefinementHistoryEntry[]) ?? [];

    refinementHistory.push({
      timestamp: generatedAt,
      feedback: data.feedback,
      type: 'screenplay',
      userId: data.userId,
    });

    const updatedMetadata = {
      ...currentMetadata,
      previous_screenplay_data: screenplayData,
      refinement_history: refinementHistory,
    };

    // 7. Update episode
    const { data: updatedEpisode, error: updateError } = await supabase
      .from('episodes')
      .update({
        screenplay_data: updatedScreenplayData as Json,
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

    // 8. Re-insert dialogue lines from refined screenplay
    const characters = episodeContext.characters;
    const characterMap = new Map(
      (characters || []).map((c) => [c.name.toLowerCase(), c.id]),
    );

    const dialogueLines: Array<{
      episode_id: string;
      character_asset_id: string | null;
      text: string;
      sequence_number: number;
      scene_number: number;
      language: string;
      status: string;
    }> = [];

    let sequenceNumber = 1;
    for (const scene of refinedScreenplay.scenes) {
      const dialogue = (scene.dialogue ?? []) as Array<{
        character: string;
        text: string;
      }>;
      const sceneNumber = (scene.number ?? 0) as number;

      for (const line of dialogue) {
        const charName =
          typeof line.character === 'string'
            ? line.character.toLowerCase()
            : '';
        const characterId = charName
          ? characterMap.get(charName) || null
          : null;
        dialogueLines.push({
          episode_id: data.episodeId,
          character_asset_id: characterId,
          text: line.text,
          sequence_number: sequenceNumber++,
          scene_number: sceneNumber,
          language: 'en',
          status: 'pending',
        });
      }
    }

    if (dialogueLines.length > 0) {
      // Delete existing dialogue lines before inserting new ones
      await supabase
        .from('dialogue_lines')
        .delete()
        .eq('episode_id', data.episodeId);

      const { error: insertError } = await supabase
        .from('dialogue_lines')
        .insert(dialogueLines);

      if (insertError) {
        console.error(
          '[Screenplay Refinement] Failed to insert dialogue:',
          insertError,
        );
      }
    }

    console.log(
      `[Screenplay Refinement] Screenplay refined successfully. ${refinedScreenplay.scenes.length} scenes, ${dialogueLines.length} dialogue lines`,
    );

    await markJobCompleted(supabase, data.episodeId, 'screenplay-refinement', {
      provider: result.metadata.provider,
      model: result.metadata.model,
      tokensUsed: result.metadata.tokens,
      scenesCount: refinedScreenplay.scenes.length,
      dialogueLinesCount: dialogueLines.length,
      feedback: data.feedback.substring(0, 200),
    });

    return {
      success: true,
      data: {
        screenplay: updatedScreenplayData,
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
      'screenplay-refinement',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
