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
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GenerateShotListSchema } from '../../schemas/shot-list.schema';
import type { GenerateShotListResponse, ScreenplayData } from '../../types';

/**
 * Generates a shot list from an episode's screenplay.
 *
 * This action validates the episode has a screenplay with scenes,
 * then queues the job to Lambda for background processing.
 *
 * Results are delivered via WebSocket when processing completes.
 */
export const generateShotListAction = enhanceAction(
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
      maxRequests: 30,
      windowMs: 60_000,
    });

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
      throw new Error('Episode not found');
    }

    // Validate screenplay exists
    const screenplayData = episode.screenplay_data as ScreenplayData | null;
    if (!screenplayData?.scenes?.length) {
      throw new Error(
        'Episode must have screenplay with scenes generated first',
      );
    }

    // Get project for account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (client as any)
      .from('projects')
      .select('account_id')
      .eq('id', episode.project_id)
      .single();

    const accountId = project?.account_id ?? 'unknown';

    // Queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    // Create generation job entry for tracking
    const jobData = {
      reference_type: 'episode',
      reference_id: data.episodeId,
      job_type: 'shot_list',
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

    await queueLlmJob({
      jobType: 'shot-generation',
      userId: user.id,
      payload: {
        episodeId: data.episodeId,
        version: episode.version,
        accountId,
        userId: user.id,
        projectId: episode.project_id,
      },
    });

    logger.info(ctx, 'Shot list generation job queued');
    return { success: true, queued: true };
  },
  { schema: GenerateShotListSchema },
);
