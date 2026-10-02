'use server';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const RefineStorySchema = z.object({
  episodeId: z.string().uuid(),
  projectId: z.string().uuid(),
  feedback: z.string().min(1).max(10000),
});

const RefineScreenplaySchema = z.object({
  episodeId: z.string().uuid(),
  projectId: z.string().uuid(),
  feedback: z.string().min(1).max(10000),
});

const UndoRefinementSchema = z.object({
  episodeId: z.string().uuid(),
  type: z.enum(['story', 'screenplay']),
});

/**
 * Queue a story refinement job to the LLM worker.
 * The Lambda handler will refine the story based on user feedback.
 */
const refineStoryHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.refineStory', episodeId: data.episodeId };
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story refinement attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'refineStory', {
      maxRequests: 30,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      throw new ActionRefusal('Episode not found');
    }

    // Verify episode exists and has a story
    const episode = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('episodes')
        .select('id, project_id, story_data, project:projects(id, account_id)')
        .eq('id', data.episodeId)
        .is('deleted_at', null)
        .single(),
      'Episode not found',
    );

    if (!episode.story_data?.fullStory) {
      throw new ActionRefusal(
        'Episode must have a story before it can be refined',
      );
    }

    const accountId = episode.project?.account_id;
    if (!accountId) {
      throw new ActionRefusal('Project not found or access denied');
    }

    const { openRunForJob } = await import('@kit/ai-gateway');
    const run = await openRunForJob(
      {
        jobType: 'story-refinement',
        userId: user.id,
        target,
        payload: {
          episodeId: data.episodeId,
          projectId: target.projectId,
          feedback: data.feedback,
          userId: user.id,
        },
        name: 'episodes.refineStory',
      },
      { client: client, accountId: target.accountId, userId: user.id },
    );

    // Create generation job for tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert({
        reference_type: 'episode',
        reference_id: data.episodeId,
        job_type: 'story-refinement',
        run_id: run.id,
        status: 'queued',
        account_id: accountId,
        project_id: episode.project_id,
        idempotency_key: `story-refinement-${data.episodeId}-${Date.now()}`,
        input_data: {
          episodeId: data.episodeId,
          feedback: data.feedback.substring(0, 200),
        },
      });

    if (jobError) {
      logger.warn(
        { ...ctx, error: jobError },
        'Failed to create generation job entry',
      );
    }

    await run.dispatch();

    logger.info(ctx, 'Story refinement queued');
    return { success: true as const, queued: true };
  },
  { schema: RefineStorySchema },
);

export const refineStoryAction = returnRefusals(refineStoryHandler);

/**
 * Queue a screenplay refinement job to the LLM worker.
 * The Lambda handler will refine the screenplay based on user feedback.
 */
const refineScreenplayHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.refineScreenplay',
      episodeId: data.episodeId,
    };
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized screenplay refinement attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'refineScreenplay', {
      maxRequests: 30,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      throw new ActionRefusal('Episode not found');
    }

    // Verify episode exists and has a screenplay
    const episode = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('episodes')
        .select(
          'id, project_id, screenplay_data, project:projects(id, account_id)',
        )
        .eq('id', data.episodeId)
        .is('deleted_at', null)
        .single(),
      'Episode not found',
    );

    if (!episode.screenplay_data?.scenes) {
      throw new ActionRefusal(
        'Episode must have a screenplay before it can be refined',
      );
    }

    const accountId = episode.project?.account_id;
    if (!accountId) {
      throw new ActionRefusal('Project not found or access denied');
    }

    const { openRunForJob } = await import('@kit/ai-gateway');
    const run = await openRunForJob(
      {
        jobType: 'screenplay-refinement',
        userId: user.id,
        target,
        payload: {
          episodeId: data.episodeId,
          projectId: target.projectId,
          feedback: data.feedback,
          userId: user.id,
        },
        name: 'episodes.refineScreenplay',
      },
      { client: client, accountId: target.accountId, userId: user.id },
    );

    // Create generation job for tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert({
        reference_type: 'episode',
        reference_id: data.episodeId,
        job_type: 'screenplay-refinement',
        run_id: run.id,
        status: 'queued',
        account_id: accountId,
        project_id: episode.project_id,
        idempotency_key: `screenplay-refinement-${data.episodeId}-${Date.now()}`,
        input_data: {
          episodeId: data.episodeId,
          feedback: data.feedback.substring(0, 200),
        },
      });

    if (jobError) {
      logger.warn(
        { ...ctx, error: jobError },
        'Failed to create generation job entry',
      );
    }

    await run.dispatch();

    logger.info(ctx, 'Screenplay refinement queued');
    return { success: true as const, queued: true };
  },
  { schema: RefineScreenplaySchema },
);

export const refineScreenplayAction = returnRefusals(refineScreenplayHandler);

/**
 * Undo the last refinement by restoring previous data from metadata.
 */
const undoRefinementHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.undoRefinement', episodeId: data.episodeId };
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized undo refinement attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode metadata
    const episode = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('episodes')
        .select('id, metadata, story_data, screenplay_data')
        .eq('id', data.episodeId)
        .is('deleted_at', null)
        .single(),
      'Episode not found',
    );

    const metadata = (episode.metadata ?? {}) as Record<string, unknown>;

    if (data.type === 'story') {
      const previousStoryData = metadata.previous_story_data;
      if (!previousStoryData) {
        throw new ActionRefusal('No previous story data available to restore');
      }

      // Restore previous story data and clear the backup
      const updatedMetadata = { ...metadata };
      delete updatedMetadata.previous_story_data;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: restored, error: restoredError } = await (client as any)
        .from('episodes')
        .update({
          story_data: previousStoryData,
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.episodeId)
        .select('id');

      if (restoredError) {
        throw new Error(`Failed to update episodes: ${restoredError.message}`);
      }

      requireAffectedRows(restored, "You can't change this episode.");

      logger.info(ctx, 'Story refinement undone');
    } else {
      const previousScreenplayData = metadata.previous_screenplay_data;
      if (!previousScreenplayData) {
        throw new ActionRefusal(
          'No previous screenplay data available to restore',
        );
      }

      // Restore previous screenplay data and clear the backup
      const updatedMetadata = { ...metadata };
      delete updatedMetadata.previous_screenplay_data;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: restored, error: restoredError } = await (client as any)
        .from('episodes')
        .update({
          screenplay_data: previousScreenplayData,
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.episodeId)
        .select('id');

      if (restoredError) {
        throw new Error(`Failed to update episodes: ${restoredError.message}`);
      }

      requireAffectedRows(restored, "You can't change this episode.");

      logger.info(ctx, 'Screenplay refinement undone');
    }

    return { success: true as const, restored: true };
  },
  { schema: UndoRefinementSchema },
);

export const undoRefinementAction = returnRefusals(undoRefinementHandler);
