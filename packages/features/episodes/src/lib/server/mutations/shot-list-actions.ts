'use server';

/**
 * Shot List Generation Actions
 *
 * Entry point for generating shot lists from screenplay.
 * Validates episode and queues to Lambda for background processing.
 *
 * NOTE: The actual LLM processing and database insertion logic has been
 * moved to apps/web/lambda/llm-worker/handlers/shot-generation.ts
 */
import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GenerateShotListSchema } from '../../schemas/shot-list.schema';
import type { GenerateShotListResponse, ScreenplayData } from '../../types';
import { refuseRunError } from '../refusing-run-errors';
import { webRunCtx } from '../web-run-ctx';

/**
 * Generates a shot list from an episode's screenplay.
 *
 * This action validates the episode has a screenplay with scenes,
 * then queues the job to Lambda for background processing.
 *
 * Results are delivered via WebSocket when processing completes.
 */
const generateShotList = enhanceAction(
  async (
    data,
  ): Promise<GenerateShotListResponse | { success: true; queued: true }> => {
    const logger = await getLogger();
    const ctx = { name: 'shot-list.generate', episodeId: data.episodeId };

    logger.info(ctx, 'Processing shot list generation request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot list generation attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'generateShotList', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target) {
      throw new ActionRefusal('Episode not found');
    }

    // Fetch episode with screenplay_data for validation
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
      throw new Error(whyNoRow(episodeError, 'Episode not found'));
    }

    // Validate screenplay exists
    const screenplayData = episode.screenplay_data as ScreenplayData | null;
    if (!screenplayData?.scenes?.length) {
      throw new Error(
        'Episode must have screenplay with scenes generated first',
      );
    }

    const { accountId } = target;

    // Queue to Lambda for processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'shot-generation',
        userId: user.id,
        target,
        payload: {
          episodeId: data.episodeId,
          version: episode.version,
          shotDurationMin: data.shotDurationMin,
          shotDurationMax: data.shotDurationMax,
          accountId,
          userId: user.id,
          projectId: episode.project_id,
        },
        name: 'episodes.generateShotList',
      },
      await webRunCtx(client, target.accountId, user.id),
    ).catch(refuseRunError);

    // Create generation job entry for tracking
    const jobData = {
      reference_type: 'episode',
      reference_id: data.episodeId,
      job_type: 'shot_list',
      run_id: run.id,
      status: 'queued',
      account_id: accountId,
      project_id: episode.project_id,
      idempotency_key: `shots-${data.episodeId}-${Date.now()}`,
      input_data: { episodeId: data.episodeId },
    };
    console.log('[shot-list-actions] Creating job:', JSON.stringify(jobData));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedJob, error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert(jobData)
      .select('id')
      .single();

    if (jobError) {
      console.error('[shot-list-actions] FAILED:', jobError);
      logger.warn(
        { ...ctx, error: jobError },
        'Failed to create generation job entry',
      );
    } else {
      console.log('[shot-list-actions] SUCCESS:', insertedJob);
    }

    await run.dispatch();

    logger.info(ctx, 'Shot list generation job queued');
    return { success: true, queued: true };
  },
  { schema: GenerateShotListSchema },
);

export const generateShotListAction = returnRefusals(generateShotList);
