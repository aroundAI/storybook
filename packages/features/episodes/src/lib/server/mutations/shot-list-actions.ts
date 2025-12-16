'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { executeLLM } from '@kit/prompt-engine/server';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GenerateShotListSchema,
  ShotListGenerationOutputSchema,
} from '../../schemas/shot-list.schema';
import type {
  GenerateShotListResponse,
  ScreenplayData,
  ShotListData,
  StoryData,
} from '../../types';
import {
  formatScreenplayForPrompt,
  formatStoryForPrompt,
} from '../../utils/format-for-prompt';
import { batchCreateShotsAction } from './shot-actions';

/**
 * Generates a shot list from an episode's screenplay or story using LLM
 * Creates shot records and updates episode.shot_list with metadata
 */
export const generateShotListAction = enhanceAction(
  async (data): Promise<GenerateShotListResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'shot-list.generate', episodeId: data.episodeId };
    const startTime = Date.now();

    logger.info(ctx, 'Starting shot list generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot list generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode with screenplay_data and story_data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select(
        'id, project_id, screenplay_data, story_data, status, version, title',
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // Get project for account context (needed for LLM analytics)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (client as any)
      .from('projects')
      .select('account_id')
      .eq('id', episode.project_id)
      .single();

    const accountId = project?.account_id ?? 'unknown';

    // Determine input source (screenplay preferred, story as fallback)
    const inputSource = episode.screenplay_data
      ? {
          type: 'screenplay' as const,
          data: episode.screenplay_data as ScreenplayData,
        }
      : episode.story_data
        ? { type: 'story' as const, data: episode.story_data as StoryData }
        : null;

    if (!inputSource) {
      throw new Error('Episode must have screenplay or story generated first');
    }

    logger.info(
      { ...ctx, inputSource: inputSource.type },
      'Using input source for generation',
    );

    // Format input for prompt
    const screenplayText =
      inputSource.type === 'screenplay'
        ? formatScreenplayForPrompt(inputSource.data)
        : formatStoryForPrompt(inputSource.data);

    if (!screenplayText || screenplayText.length < 50) {
      throw new Error('Insufficient content for shot list generation');
    }

    // Execute LLM prompt
    const llmResult = await executeLLM<{ shotList: unknown }>({
      templateSlug: 'shot-list-generation',
      variables: {
        screenplay_text: screenplayText,
        shot_duration_min: data.shotDurationMin,
        shot_duration_max: data.shotDurationMax,
        video_provider: data.videoProvider,
      },
      context: {
        name: 'shot-list.generate',
        accountId,
        userId: user.id,
      },
      temperature: 0.5,
    });

    // Validate LLM output
    const validated = ShotListGenerationOutputSchema.parse(llmResult.data);
    const generatedShots = validated.shotList.shots;
    const shotListMetadata = validated.shotList.metadata;

    logger.info(
      {
        ...ctx,
        shotCount: generatedShots.length,
        totalDuration: shotListMetadata.totalDuration,
      },
      'LLM generated shot list',
    );

    // Prepare shots for batch creation
    const shotsToCreate = generatedShots.map((shot) => ({
      sceneNumber: shot.sceneNumber,
      shotNumber: shot.shotNumber,
      description: shot.description,
      prompt: shot.prompt,
      durationSeconds: shot.duration,
      cameraDirection: shot.cameraDirection,
      characters: shot.characters,
      metadata: {
        location: shot.metadata.location,
        timeOfDay: shot.metadata.timeOfDay,
        mood: shot.metadata.mood,
        lighting: shot.metadata.lighting,
        shotType: shot.shotType,
        action: shot.action,
      },
    }));

    // Create shots using batch action
    const batchResult = await batchCreateShotsAction({
      episodeId: data.episodeId,
      shots: shotsToCreate,
    });

    if (!batchResult.success) {
      throw new Error('Failed to create shot records');
    }

    // Prepare shot_list metadata for episode
    const shotListData: ShotListData = {
      shots: generatedShots.map((shot) => ({
        sequenceNumber: shot.sequenceNumber,
        sceneNumber: shot.sceneNumber,
        duration: shot.duration,
        sceneDescription: shot.description,
        actionDescription: shot.action,
        prompt: shot.prompt,
        cameraDirection: shot.cameraDirection,
        characters: shot.characters,
      })),
      generatedAt: new Date().toISOString(),
      approvedAt: null,
      totalEstimatedDuration: shotListMetadata.totalDuration,
      generatedBy: {
        model: llmResult.metadata.model,
        provider: llmResult.metadata.provider,
        costCents: Math.round((llmResult.metadata.cost ?? 0) * 100),
      },
      metadata: {
        totalShots: shotListMetadata.totalShots,
        shotTypes: shotListMetadata.shotTypes,
        locations: shotListMetadata.locations,
        characters: shotListMetadata.characters,
        inputSource: inputSource.type,
      },
    };

    // Update episode with shot_list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        shot_list: shotListData as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', episode.version)
      .select('id, status, version')
      .single();

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update episode with shot list',
      );
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode was modified by another user');
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        ...ctx,
        duration,
        shotCount: generatedShots.length,
        shotsCreated: batchResult.count,
        provider: llmResult.metadata.provider,
        model: llmResult.metadata.model,
      },
      'Shot list generation completed',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      shots: generatedShots,
      shotsCreated: batchResult.count,
      episode: {
        id: updatedEpisode.id,
        status: updatedEpisode.status,
        version: updatedEpisode.version,
      },
      metadata: {
        provider: llmResult.metadata.provider,
        model: llmResult.metadata.model,
        costCents: Math.round((llmResult.metadata.cost ?? 0) * 100),
        tokensUsed: llmResult.metadata.tokens,
        generatedAt: shotListData.generatedAt!,
        totalShots: shotListMetadata.totalShots,
        totalDuration: shotListMetadata.totalDuration,
        inputSource: inputSource.type,
      },
    };
  },
  { schema: GenerateShotListSchema },
);
