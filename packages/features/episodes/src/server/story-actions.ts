'use server';

import { refuseRunError } from '@kit/ai-gateway/refuse-run-error';
import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import type {
  StoryGenerationOutput,
  StoryIdeationOutput,
} from '@kit/prompt-engine/schemas';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GenerateFullStorySchema,
  GenerateStoryIdeasSchema,
  type GenerationMetadata,
} from '../lib/schemas/story.schema';
import { webRunCtx } from '../lib/server/web-run-ctx';
import { OptimisticLockError } from '../lib/status-workflow';
import type { EpisodeStatus } from '../lib/types';

/**
 * Response type for story ideation
 */
export interface GenerateStoryIdeasResponse {
  ideas: StoryIdeationOutput['ideas'];
  metadata: GenerationMetadata;
}

/**
 * Response type for full story generation
 */
export interface GenerateFullStoryResponse {
  story: StoryGenerationOutput['story'];
  episode: {
    id: string;
    status: string;
    version: number;
  };
  metadata: GenerationMetadata;
}

/**
 * Generate multiple story ideas from a premise
 *
 * Uses the story-ideation prompt template to generate 1-5 diverse story concepts.
 * In production, queues via SQS for background processing.
 *
 * The worker builds the prompt from the episode's canon on the service-role
 * key, so the caller must be able to write to the episode's project (KB-31).
 */
const generateStoryIdeasHandler = enhanceAction(
  async (
    data,
  ): Promise<{
    success: true;
    data?: GenerateStoryIdeasResponse;
    queued?: boolean;
  }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.generateStoryIdeas' };

    logger.info(ctx, 'Processing story ideation request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story ideation attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'generateStoryIdeas', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      logger.warn(
        { ...ctx, userId: user.id, episodeId: data.episodeId },
        'llm-job.refused',
      );
      throw new ActionRefusal('Episode not found');
    }

    // Always queue to Lambda for processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'story-ideation',
        userId: user.id,
        target,
        payload: {
          episodeId: data.episodeId,
          premise: data.premise,
          numberOfIdeas: data.numberOfIdeas,
          userId: user.id,
        },
        name: 'episodes.generateStoryIdeas',
      },
      await webRunCtx(client, target.accountId, user.id),
    ).catch(refuseRunError);
    await run.dispatch();

    logger.info(ctx, 'Story ideation job queued');
    return { success: true, queued: true };
  },
  {
    schema: GenerateStoryIdeasSchema,
  },
);

export const generateStoryIdeasAction = returnRefusals(
  generateStoryIdeasHandler,
);

/**
 * Generate a complete story from a selected idea and update the episode
 *
 * Uses the story-generation prompt template to create a 500-1000 word narrative.
 * In production, queues via SQS for background processing.
 */
const generateFullStory = enhanceAction(
  async (
    data,
  ): Promise<{
    success: true;
    data?: GenerateFullStoryResponse;
    queued?: boolean;
  }> => {
    console.log(
      '[story-actions] generateFullStoryAction called with:',
      data.episodeId,
    );

    const logger = await getLogger();
    const ctx = {
      name: 'episodes.generateFullStory',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Processing story generation request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story generation attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'generateFullStory', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      throw new ActionRefusal('Episode not found');
    }

    // Fetch current episode with project info for validation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select(
        `
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, story_data, screenplay_data, shot_list,
        target_duration_seconds, created_at, updated_at, deleted_at,
        project:projects(id, account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      logger.error({ ...ctx, error: fetchError }, 'Episode not found');
      throw new Error(whyNoRow(fetchError, 'Episode not found'));
    }

    // Check version for optimistic locking
    if (episode.version !== data.version) {
      throw new OptimisticLockError('episode');
    }

    // Validate status transition (must be in 'draft' to generate story)
    const currentStatus = episode.status as EpisodeStatus;
    if (currentStatus !== 'draft' && currentStatus !== 'story') {
      throw new Error(
        `Cannot generate story for episode in '${currentStatus}' status. Episode must be in 'draft' or 'story' status.`,
      );
    }

    const accountId = episode.project?.account_id;
    if (!accountId) {
      throw new Error('Project not found or access denied');
    }

    // Always queue to Lambda for processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'story-generation',
        userId: user.id,
        target,
        payload: {
          episodeId: data.episodeId,
          title: data.title,
          logline: data.logline,
          targetDuration: data.targetDuration,
          contentStyle: data.contentStyle,
          style: data.style,
          version: data.version,
          accountId,
          userId: user.id,
          projectId: episode.project_id,
          threadCandidates: data.threadCandidates,
          themes: data.themes,
          hook: data.hook,
          visualDirection: data.visualDirection,
        },
        name: 'episodes.generateStory',
      },
      await webRunCtx(client, target.accountId, user.id),
    ).catch(refuseRunError);

    // Create generation job entry for tracking
    const jobData = {
      reference_type: 'episode',
      reference_id: data.episodeId,
      job_type: 'story',
      run_id: run.id,
      status: 'queued',
      account_id: accountId,
      project_id: episode.project_id,
      idempotency_key: `story-${data.episodeId}-${Date.now()}`,
      input_data: { episodeId: data.episodeId, title: data.title },
    };

    console.log(
      '[story-actions] Creating generation job with data:',
      JSON.stringify(jobData, null, 2),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedJob, error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert(jobData)
      .select('id, reference_type, reference_id, status')
      .single();

    if (jobError) {
      console.error(
        '[story-actions] FAILED to create generation job:',
        jobError,
      );
      console.error('[story-actions] Job data was:', jobData);
      logger.warn(
        { ...ctx, error: jobError },
        'Failed to create generation job entry',
      );
    } else {
      console.log(
        '[story-actions] SUCCESS - Created generation job:',
        insertedJob,
      );
    }

    await run.dispatch();

    logger.info(ctx, 'Story generation job queued');
    return { success: true, queued: true };
  },
  {
    schema: GenerateFullStorySchema,
  },
);

export const generateFullStoryAction = returnRefusals(generateFullStory);
