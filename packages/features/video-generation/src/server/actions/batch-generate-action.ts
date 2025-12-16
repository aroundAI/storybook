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
import { BatchGenerateVideosActionSchema, PRIORITY_MAP } from './schemas';
import type {
  BatchGenerateResponse,
  BatchGenerateResult,
  BatchPriority,
} from './schemas';

// Default video duration if not specified on the shot
const DEFAULT_DURATION_SECONDS = 5;

interface ShotWithEpisode {
  id: string;
  video_url: string | null;
  prompt: string;
  duration_seconds: number | null;
  episodes: {
    project_id: string;
    projects: {
      id: string;
      account_id: string;
    };
  };
}

/**
 * Batch generate videos for multiple shots
 *
 * Flow:
 * 1. Validate max 50 shots
 * 2. Fetch all shots in single query
 * 3. Validate: all exist, same account, no existing videos
 * 4. Calculate total cost for all shots
 * 5. Check budget atomically for total
 * 6. Create jobs in parallel with Promise.allSettled()
 * 7. Return detailed results per shot
 */
export const batchGenerateVideosAction = enhanceAction(
  async (data): Promise<BatchGenerateResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'video.batch-generate',
      shotCount: data.shotIds.length,
      provider: data.provider,
    };

    logger.info(ctx, 'Starting batch video generation');

    const client = getSupabaseServerClient();
    const results: BatchGenerateResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Validate all shots exist and get their details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shots, error: shotsError } = await (client as any)
      .from('shots')
      .select(
        `
        id,
        video_url,
        prompt,
        duration_seconds,
        episodes!inner (
          project_id,
          projects:project_id (
            id,
            account_id
          )
        )
      `,
      )
      .in('id', data.shotIds)
      .is('deleted_at', null);

    if (shotsError) {
      logger.error({ ...ctx, error: shotsError }, 'Failed to fetch shots');
      throw new Error('Failed to fetch shots');
    }

    if (!shots || shots.length === 0) {
      throw new Error('No shots found');
    }

    if (shots.length !== data.shotIds.length) {
      const foundIds = new Set(shots.map((s: ShotWithEpisode) => s.id));
      const missingIds = data.shotIds.filter((id) => !foundIds.has(id));
      throw new Error(`Shots not found: ${missingIds.join(', ')}`);
    }

    // Check all shots belong to the same account
    const accountIds = new Set(
      shots.map((s: ShotWithEpisode) => s.episodes.projects.account_id),
    );

    if (accountIds.size > 1) {
      throw new Error('All shots must belong to the same account');
    }

    // Check none already have videos
    const shotsWithVideos = shots.filter(
      (s: ShotWithEpisode) => s.video_url !== null,
    );
    if (shotsWithVideos.length > 0) {
      throw new Error(
        `${shotsWithVideos.length} shot(s) already have videos: ${shotsWithVideos.map((s: ShotWithEpisode) => s.id).join(', ')}`,
      );
    }

    // Calculate total estimated cost
    const provider: VideoProvider = data.provider || 'kling';
    const mode = data.mode || 'std';
    let totalEstimatedCost = 0;

    for (const shot of shots as ShotWithEpisode[]) {
      const duration = shot.duration_seconds || DEFAULT_DURATION_SECONDS;
      const cost = await calculateVideoCost(provider, duration, mode);
      totalEstimatedCost += cost;
    }

    // Check budget for entire batch
    const accountId = (shots[0] as ShotWithEpisode).episodes.projects
      .account_id;
    const budgetCheck = await checkAndReserveBudget(
      accountId,
      totalEstimatedCost,
    );

    if (!budgetCheck.allowed) {
      logger.warn(
        { ...ctx, budgetCheck, totalEstimatedCost },
        'Insufficient budget for batch generation',
      );
      throw new Error(
        budgetCheck.message ||
          `Insufficient budget for batch. Required: $${(totalEstimatedCost / 100).toFixed(2)}, Available: $${(budgetCheck.remaining / 100).toFixed(2)}`,
      );
    }

    // Get priority from schema
    const priority =
      PRIORITY_MAP[data.priority as BatchPriority] || PRIORITY_MAP.normal;

    logger.info(
      { ...ctx, accountId, totalEstimatedCost, priority },
      'Creating batch generation jobs',
    );

    // Create jobs in parallel
    const jobPromises = (shots as ShotWithEpisode[]).map(async (shot) => {
      const duration = shot.duration_seconds || DEFAULT_DURATION_SECONDS;
      const estimatedCostCents = await calculateVideoCost(
        provider,
        duration,
        mode,
      );
      const generationJobId = randomUUID();
      const idempotencyKey = `batch-shot-${shot.id}-${Date.now()}`;
      const projectId = shot.episodes.project_id;

      try {
        // Create generation job record
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
            priority,
            input_data: {
              prompt: shot.prompt,
              duration,
              aspectRatio: '16:9',
              mode,
            },
            estimated_cost_cents: estimatedCostCents,
            started_at: new Date().toISOString(),
          });

        if (jobError) {
          throw jobError;
        }

        // Update shot status
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('shots')
          .update({
            status: 'queued',
            generation_job_id: generationJobId,
          })
          .eq('id', shot.id);

        // Add to queue
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
          priority,
        });

        return {
          shotId: shot.id,
          success: true,
          generationJobId,
        };
      } catch (error) {
        logger.error(
          { ...ctx, shotId: shot.id, error },
          'Failed to create job for shot',
        );

        return {
          shotId: shot.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Wait for all jobs to complete
    const jobResults = await Promise.allSettled(jobPromises);

    // Process results
    for (const result of jobResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.success) {
          successCount++;
        } else {
          failureCount++;
        }
      } else {
        // Should not happen with our error handling, but just in case
        results.push({
          shotId: 'unknown',
          success: false,
          error: result.reason?.message || 'Unknown error',
        });
        failureCount++;
      }
    }

    logger.info(
      { ...ctx, successCount, failureCount, totalEstimatedCost },
      'Batch video generation completed',
    );

    // Revalidate the project page
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      totalShots: data.shotIds.length,
      successCount,
      failureCount,
      totalEstimatedCostCents: totalEstimatedCost,
      results,
    };
  },
  {
    schema: BatchGenerateVideosActionSchema,
    auth: true,
  },
);
