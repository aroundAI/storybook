'use server';

import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import type { Screenplay } from '@kit/prompt-engine/schemas';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ConvertToScreenplaySchema } from '../lib/schemas';
import type { StoryData } from '../lib/types';

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

// Constants for dialogue duration estimation
const WORDS_PER_SECOND = 2.5; // ~150 words/min speaking rate
const GAP_BETWEEN_DIALOGUES = 0.5; // seconds between dialogue lines

/**
 * Estimate dialogue duration from text word count
 */
function estimateDialogueDuration(text: string): number {
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(1, wordCount / WORDS_PER_SECOND);
}

/**
 * Extract dialogue lines from screenplay scenes and prepare for database insertion
 * Matches character names to asset IDs for proper linking
 * Calculates timeline positions based on scene durations
 */
function _extractDialogueLines(
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
  timeline_start_seconds: number;
  estimated_duration_seconds: number;
}> {
  // Create case-insensitive lookup map for character name -> asset ID
  const characterMap = new Map<string, string>();
  for (const char of characters) {
    // Normalize name to uppercase for matching
    characterMap.set(char.name.toUpperCase(), char.id);
  }

  // Calculate scene start times based on estimatedDuration
  const sceneStartTimes = new Map<number, number>();
  let cumulativeTime = 0;
  for (const scene of screenplay.scenes) {
    sceneStartTimes.set(scene.number, cumulativeTime);
    cumulativeTime += scene.estimatedDuration;
  }

  // Track dialogue offset within each scene
  const sceneDialogueOffsets = new Map<number, number>();

  const lines: Array<{
    episode_id: string;
    scene_number: number;
    character_asset_id: string | null;
    character_name: string;
    text: string;
    emotion: string | null;
    sequence_number: number;
    timeline_start_seconds: number;
    estimated_duration_seconds: number;
  }> = [];

  let sequenceNumber = 1;

  for (const scene of screenplay.scenes) {
    const sceneStart = sceneStartTimes.get(scene.number) ?? 0;

    for (const dialogue of scene.dialogue) {
      // Normalize dialogue character name for lookup
      const normalizedName = dialogue.character.toUpperCase();
      const characterAssetId = characterMap.get(normalizedName) ?? null;

      // Get current offset within scene
      const dialogueOffset = sceneDialogueOffsets.get(scene.number) ?? 0;

      // Calculate duration from text
      const duration = estimateDialogueDuration(dialogue.text);

      // Calculate timeline position
      const timelineStart = sceneStart + dialogueOffset;

      lines.push({
        episode_id: episodeId,
        scene_number: scene.number,
        character_asset_id: characterAssetId,
        character_name: dialogue.character,
        text: dialogue.text,
        emotion: dialogue.parenthetical ?? null,
        sequence_number: sequenceNumber++,
        timeline_start_seconds: timelineStart,
        estimated_duration_seconds: duration,
      });

      // Update offset for next dialogue in this scene
      sceneDialogueOffsets.set(
        scene.number,
        dialogueOffset + duration + GAP_BETWEEN_DIALOGUES,
      );
    }
  }

  return lines;
}

/**
 * Convert episode story to screenplay format using LLM
 *
 * In production, queues via SQS for background processing.
 */
export const convertToScreenplayAction = enhanceAction(
  async (
    data,
  ): Promise<{
    success: true;
    data?: ConvertToScreenplayResponse;
    queued?: boolean;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.convertToScreenplay',
      episodeId: data.episodeId,
    };
    const _startTime = Date.now();

    logger.info(ctx, 'Processing screenplay conversion request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized screenplay conversion attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'convertToScreenplay', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      throw new ActionRefusal('Episode not found');
    }

    // Fetch episode with project info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select(
        `
        id, project_id, season_id, number, slug, title, description, status, version,
        story_data, screenplay_data, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(id, account_id, metadata)
      `,
      )
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

    // Always queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    // Create generation job entry for tracking
    const jobData = {
      reference_type: 'episode',
      reference_id: data.episodeId,
      job_type: 'screenplay',
      status: 'queued',
      account_id: accountId,
      project_id: episode.project_id,
      idempotency_key: `screenplay-${data.episodeId}-${Date.now()}`,
      input_data: { episodeId: data.episodeId },
    };
    console.log('[screenplay-actions] Creating job:', JSON.stringify(jobData));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedJob, error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert(jobData)
      .select('id')
      .single();

    if (jobError) {
      console.error('[screenplay-actions] FAILED:', jobError);
      logger.warn(
        { ...ctx, error: jobError },
        'Failed to create generation job entry',
      );
    } else {
      console.log('[screenplay-actions] SUCCESS:', insertedJob);
    }

    await queueLlmJob({
      jobType: 'screenplay-conversion',
      userId: user.id,
      target,
      payload: {
        episodeId: data.episodeId,
        dialogueStyle: data.dialogueStyle,
        contentStyle: data.contentStyle,
        version: episode.version,
        accountId,
        userId: user.id,
        projectId: episode.project_id,
      },
    });

    logger.info(ctx, 'Screenplay conversion job queued');
    return { success: true, queued: true };
  },
  {
    schema: ConvertToScreenplaySchema,
  },
);
