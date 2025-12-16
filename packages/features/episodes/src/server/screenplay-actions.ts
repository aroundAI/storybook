'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import type {
  Screenplay,
  ScreenplayConversionOutput,
} from '@kit/prompt-engine/schemas';
import { executeLLM } from '@kit/prompt-engine/server';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ConvertToScreenplaySchema } from '../lib/schemas';
import { OptimisticLockError } from '../lib/status-workflow';
import type { EpisodeStatus, StoryData } from '../lib/types';

/**
 * Response type for convertToScreenplayAction
 */
export interface ConvertToScreenplayResponse {
  screenplay: Screenplay;
  dialogueLinesCreated: number;
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
}

/**
 * Extract dialogue lines from screenplay scenes and prepare for database insertion
 * Matches character names to asset IDs for proper linking
 */
function extractDialogueLines(
  screenplay: Screenplay,
  episodeId: string,
  characters: Array<{ id: string; name: string }>,
): Array<{
  episode_id: string;
  scene_number: number;
  character_asset_id: string | null;
  character_name: string;
  text: string;
  emotion: string | null;
  sequence_number: number;
}> {
  // Create case-insensitive lookup map for character name -> asset ID
  const characterMap = new Map<string, string>();
  for (const char of characters) {
    // Normalize name to uppercase for matching
    characterMap.set(char.name.toUpperCase(), char.id);
  }

  const lines: Array<{
    episode_id: string;
    scene_number: number;
    character_asset_id: string | null;
    character_name: string;
    text: string;
    emotion: string | null;
    sequence_number: number;
  }> = [];

  let sequenceNumber = 1;

  for (const scene of screenplay.scenes) {
    for (const dialogue of scene.dialogue) {
      // Normalize dialogue character name for lookup
      const normalizedName = dialogue.character.toUpperCase();
      const characterAssetId = characterMap.get(normalizedName) ?? null;

      lines.push({
        episode_id: episodeId,
        scene_number: scene.number,
        character_asset_id: characterAssetId,
        character_name: dialogue.character,
        text: dialogue.text,
        emotion: dialogue.parenthetical ?? null,
        sequence_number: sequenceNumber++,
      });
    }
  }

  return lines;
}

/**
 * Convert episode story to screenplay format using LLM
 *
 * This action:
 * 1. Validates the episode exists and has story_data
 * 2. Validates episode is in 'story' status
 * 3. Calls LLM with screenplay-conversion prompt template
 * 4. Extracts dialogue lines and stores them in dialogue_lines table
 * 5. Updates episode with screenplay_data and transitions to 'storyboard' status
 * 6. Creates audit log entry
 *
 * @param data - Input containing episodeId and optional conversion settings
 * @returns Screenplay data with metadata
 */
export const convertToScreenplayAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data: ConvertToScreenplayResponse }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.convertToScreenplay',
      episodeId: data.episodeId,
    };
    const startTime = Date.now();

    logger.info(ctx, 'Starting screenplay conversion');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized screenplay conversion attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode with project info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('*, project:projects(id, account_id)')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // Validate story_data exists
    const storyData = episode.story_data as StoryData | null;
    if (!storyData?.fullStory) {
      logger.warn(ctx, 'Episode missing story_data');
      throw new Error('Episode must have story generated first');
    }

    // Validate status
    if (episode.status !== 'story') {
      logger.warn(
        { ...ctx, currentStatus: episode.status },
        'Invalid episode status for screenplay conversion',
      );
      throw new Error(
        `Invalid episode status: ${episode.status}. Expected 'story'`,
      );
    }

    const accountId = episode.project?.account_id;
    if (!accountId) {
      throw new Error('Unable to determine account for episode');
    }

    // Build context for character/location names (Phase 4)
    const { buildEpisodeContext } = await import('./context-builder');
    const episodeContext = await buildEpisodeContext(data.episodeId);

    const characterNames = episodeContext.characters.map((c) => c.name);
    const locationNames = episodeContext.locations.map((l) => l.name);

    // Execute LLM prompt
    logger.info(ctx, 'Executing screenplay conversion LLM');

    const result = await executeLLM<ScreenplayConversionOutput>({
      templateSlug: 'screenplay-conversion',
      variables: {
        story: storyData.fullStory,
        target_scene_count: data.targetSceneCount ?? 8,
        style: data.dialogueStyle ?? 'natural',
        character_names:
          characterNames.length > 0 ? characterNames.join(', ') : '',
        location_names:
          locationNames.length > 0 ? locationNames.join(', ') : '',
      },
      context: {
        name: 'screenplay-conversion',
        accountId,
        userId: user.id,
      },
    });

    const screenplay = result.data.screenplay;
    const costCents = Math.round((result.metadata.cost ?? 0) * 100);

    const totalDialogueCount = screenplay.scenes.reduce(
      (sum: number, scene) => sum + scene.dialogue.length,
      0,
    );

    logger.info(
      {
        ...ctx,
        sceneCount: screenplay.scenes.length,
        dialogueCount: totalDialogueCount,
        costCents,
        tokens: result.metadata.tokens,
      },
      'Screenplay conversion completed',
    );

    // Extract and insert dialogue lines with character asset ID mapping
    const dialogueLines = extractDialogueLines(
      screenplay,
      data.episodeId,
      episodeContext.characters,
    );

    if (dialogueLines.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dialogueError } = await (client as any)
        .from('dialogue_lines')
        .insert(dialogueLines);

      if (dialogueError) {
        logger.error(
          { ...ctx, error: dialogueError },
          'Failed to insert dialogue lines',
        );
        throw new Error(
          `Failed to create dialogue lines: ${dialogueError.message}`,
        );
      }

      logger.info(
        { ...ctx, dialogueLineCount: dialogueLines.length },
        'Dialogue lines inserted',
      );
    }

    // Prepare screenplay_data for storage
    const generatedAt = new Date().toISOString();
    const screenplayData = {
      scenes: screenplay.scenes,
      metadata: screenplay.metadata,
      generatedAt,
      generatedBy: {
        model: result.metadata.model,
        provider: result.metadata.provider,
        costCents,
      },
    };

    // Update episode with optimistic locking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        screenplay_data: screenplayData,
        status: 'storyboard' as EpisodeStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', episode.version)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update episode with screenplay data',
      );
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new OptimisticLockError('episode');
    }

    // Create audit log
    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId,
      userId: user.id,
      action: 'update',
      objectType: 'episode',
      objectId: episode.id,
      objectName: episode.title,
      before: { status: episode.status, screenplay_data: null },
      after: {
        status: updatedEpisode.status,
        screenplay_data: screenplayData,
      },
      scopes: [
        { type: 'account', id: accountId },
        { type: 'project', id: episode.project_id },
        { type: 'episode', id: episode.id },
      ],
      ...networkContext,
    });

    const duration = Date.now() - startTime;

    logger.info(
      {
        ...ctx,
        userId: user.id,
        projectId: episode.project_id,
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
        duration,
        sceneCount: screenplay.scenes.length,
        dialogueLineCount: dialogueLines.length,
      },
      'Screenplay conversion action completed',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      data: {
        screenplay,
        dialogueLinesCreated: dialogueLines.length,
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
  },
  {
    schema: ConvertToScreenplaySchema,
  },
);
