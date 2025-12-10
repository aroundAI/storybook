'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { randomUUID } from 'crypto';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  calculateVideoCost,
  checkAndReserveBudget,
} from '../../lib/cost-tracking';
import type { VideoProvider } from '../../lib/types';
import { addVideoGenerationJob } from '../../queue';
import { GenerateVideoActionSchema } from './schemas';
import type { GenerateVideoResponse } from './schemas';

// Default video duration if not specified on the shot
const DEFAULT_DURATION_SECONDS = 5;

// Estimated generation time based on duration (in seconds)
const ESTIMATED_TIME_MAP: Record<number, number> = {
  5: 180, // 3 minutes for 5s video
  10: 300, // 5 minutes for 10s video
};

/**
 * Generate video for a single shot
 *
 * Flow:
 * 1. Query shot with episode and project to get account_id
 * 2. Verify shot doesn't already have video
 * 3. Calculate estimated cost
 * 4. Check and reserve budget
 * 5. Create generation_jobs record
 * 6. Add job to queue
 * 7. Return success with job info
 */
export const generateVideoAction = enhanceAction(
  async (data): Promise<GenerateVideoResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'video.generate',
      shotId: data.shotId,
      provider: data.provider,
    };

    logger.info(ctx, 'Starting video generation');

    const client = getSupabaseServerClient();

    // Get shot with episode and project info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error: shotError } = await (client as any)
      .from('shots')
      .select(
        `
        *,
        episodes!inner (
          project_id,
          projects:project_id (
            id,
            account_id
          )
        )
      `,
      )
      .eq('id', data.shotId)
      .is('deleted_at', null)
      .single();

    if (shotError || !shot) {
      logger.warn({ ...ctx, error: shotError }, 'Shot not found');
      throw new Error('Shot not found');
    }

    // Check if shot already has video
    if (shot.video_url) {
      logger.info(ctx, 'Shot already has generated video');
      throw new Error('Shot already has generated video');
    }

    // Extract account and project info
    const projectId = shot.episodes.project_id;
    const accountId = shot.episodes.projects.account_id;
    const provider: VideoProvider = data.provider || 'kling';
    const mode = data.mode || 'std';
    const duration = shot.duration_seconds || DEFAULT_DURATION_SECONDS;

    logger.info(
      { ...ctx, accountId, projectId, provider, mode, duration },
      'Processing video generation request',
    );

    // Calculate estimated cost
    const estimatedCostCents = calculateVideoCost(provider, duration, mode);

    // Check and reserve budget
    const budgetCheck = await checkAndReserveBudget(
      accountId,
      estimatedCostCents,
    );

    if (!budgetCheck.allowed) {
      logger.warn(
        { ...ctx, budgetCheck, estimatedCostCents },
        'Insufficient budget for video generation',
      );
      throw new Error(budgetCheck.message || 'Insufficient budget');
    }

    // Create generation job record
    const generationJobId = randomUUID();
    const idempotencyKey = `shot-${shot.id}-${Date.now()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert({
        id: generationJobId,
        idempotency_key: idempotencyKey,
        account_id: accountId,
        project_id: projectId,
        job_type: 'video',
        reference_type: 'shot',
        reference_id: shot.id,
        provider,
        status: 'queued',
        input_data: {
          prompt: shot.prompt,
          duration,
          aspectRatio: '16:9', // Default, could be configurable
          mode,
          referenceImageUrl: data.referenceImageUrl,
        },
        estimated_cost_cents: estimatedCostCents,
        started_at: new Date().toISOString(),
      });

    if (jobError) {
      logger.error(
        { ...ctx, error: jobError },
        'Failed to create generation job',
      );
      throw jobError;
    }

    // Update shot status to queued
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('shots')
      .update({
        status: 'queued',
        generation_job_id: generationJobId,
      })
      .eq('id', shot.id);

    // Add job to queue
    await addVideoGenerationJob({
      accountId,
      projectId,
      shotId: shot.id,
      provider,
      generationJobId,
      prompt: shot.prompt,
      duration: duration.toString(),
      aspectRatio: '16:9',
      mode,
      referenceImageUrl: data.referenceImageUrl,
      priority: 5, // Default priority
    });

    logger.info(
      { ...ctx, generationJobId, estimatedCostCents },
      'Video generation job created and queued',
    );

    // Revalidate the project page
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      generationJobId,
      estimatedCostCents,
      estimatedTime: ESTIMATED_TIME_MAP[duration] || 300,
      message: 'Video generation started',
    };
  },
  {
    schema: GenerateVideoActionSchema,
    auth: true,
  },
);
