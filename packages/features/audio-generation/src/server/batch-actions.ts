'use server';

import 'server-only';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  BatchError,
  BatchGenerateDialogueResult,
  BatchGenerateDialogueSchemaType,
  BatchJobStatus,
  CancelBatchResult,
  CancelBatchSchemaType,
  GetBatchStatusSchemaType,
  RetryFailedDialogueResult,
  RetryFailedDialogueSchemaType,
  VoiceAssignment,
} from '../lib/schemas/batch.schema';
import {
  BatchGenerateDialogueSchema,
  CancelBatchSchema,
  GetBatchStatusSchema,
  RetryFailedDialogueSchema,
} from '../lib/schemas/batch.schema';
import {
  type DialogueLineForBatch,
  startEpisodeVoiceRender,
} from './render-starts';
import { queueVoiceJobs } from './voice-queue-helper';

// Note: These actions use type assertions because the film studio tables
// (batch_generation_jobs, dialogue_lines, episodes) are not yet in the generated
// database types. The database schema will be aligned in a future update.
// RLS policies enforce project-level authorization.

interface BatchJobResponse {
  id: string;
  episode_id: string;
  account_id: string;
  status: string;
  total_lines: number;
  completed_lines: number;
  failed_lines: number;
  estimated_cost: number;
  actual_cost: number;
  voice_assignments: Record<string, VoiceAssignment>;
  errors: BatchError[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get TTS model for a project
 * Imports lazily to avoid circular dependency
 */
async function getProjectTTSModelForBatch(projectId: string): Promise<string> {
  const { getProjectTTSModel } = await import('./project-audio-settings');
  return getProjectTTSModel(projectId);
}

/**
 * Generate voice audio for all dialogue lines in an episode
 *
 * This action orchestrates batch voice generation by:
 * 1. Fetching all pending/failed dialogue lines for the episode
 * 2. Building voice assignments from user input or character profiles
 * 3. Estimating total cost
 * 4. Creating a batch job record for tracking
 * 5. Dispatching dialogue lines to the voice SQS queue
 *
 * Each dialogue line is processed independently by a Voice Worker Lambda.
 * Progress is tracked atomically via the `increment_batch_progress` RPC.
 *
 * @throws {Error} If episode not found or missing voice assignments
 */
const batchGenerateDialogue = enhanceAction(
  async (
    data: BatchGenerateDialogueSchemaType,
  ): Promise<BatchGenerateDialogueResult> => {
    // Apply defaults
    const overwriteExisting = data.overwriteExisting ?? false;

    const logger = await getLogger();
    const ctx = {
      name: 'batch.generateDialogue',
      episodeId: data.episodeId,
      overwriteExisting,
    };

    logger.info(ctx, 'Starting batch dialogue generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized batch generation attempt');
      throw new Error('Authentication required');
    }

    return startEpisodeVoiceRender(client, user.id, data);
  },
  {
    schema: BatchGenerateDialogueSchema,
  },
);

export const batchGenerateDialogueAction = returnRefusals(
  batchGenerateDialogue,
);

/**
 * Get status of a batch generation job
 *
 * Returns progress information, cost tracking, and any errors
 * that occurred during processing.
 *
 * @throws {Error} If job not found
 */
export const getBatchStatusAction = enhanceAction(
  async (data: GetBatchStatusSchemaType): Promise<BatchJobStatus> => {
    const logger = await getLogger();
    const ctx = {
      name: 'batch.getStatus',
      batchJobId: data.batchJobId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('batch_generation_jobs')
      .select(
        `
        id, episode_id, account_id, status, total_lines,
        completed_lines, failed_lines, estimated_cost, actual_cost,
        voice_assignments, errors, started_at, completed_at,
        created_at, updated_at
      `,
      )
      .eq('id', data.batchJobId)
      .single();

    if (error || !job) {
      logger.warn({ ...ctx, error }, 'Batch job not found');
      throw new Error(whyNoRow(error, 'Batch job not found'));
    }

    const jobData = job as BatchJobResponse;

    const pending =
      jobData.total_lines - jobData.completed_lines - jobData.failed_lines;
    const percentage =
      jobData.total_lines > 0
        ? Math.round(
            ((jobData.completed_lines + jobData.failed_lines) /
              jobData.total_lines) *
              100,
          )
        : 0;

    // Estimate completion time based on current progress
    let estimatedCompletionAt: string | null = null;
    if (
      jobData.status === 'processing' &&
      jobData.started_at &&
      jobData.completed_lines > 0
    ) {
      const elapsed = Date.now() - new Date(jobData.started_at).getTime();
      const avgTimePerLine = elapsed / jobData.completed_lines;
      const remainingTime = avgTimePerLine * pending;
      estimatedCompletionAt = new Date(
        Date.now() + remainingTime,
      ).toISOString();
    }

    return {
      batchJobId: jobData.id,
      status: jobData.status as BatchJobStatus['status'],
      progress: {
        total: jobData.total_lines,
        completed: jobData.completed_lines,
        failed: jobData.failed_lines,
        pending,
        percentage,
      },
      cost: {
        estimated: jobData.estimated_cost,
        actual: jobData.actual_cost,
      },
      errors: jobData.errors ?? [],
      startedAt: jobData.started_at,
      completedAt: jobData.completed_at,
      estimatedCompletionAt,
    };
  },
  {
    schema: GetBatchStatusSchema,
  },
);

/**
 * Retry failed dialogue lines in a batch job
 *
 * Creates a new processing run for only the dialogue lines
 * that failed in the original batch.
 *
 * @throws {Error} If job not found or no failed lines to retry
 */
const retryFailedDialogue = enhanceAction(
  async (
    data: RetryFailedDialogueSchemaType,
  ): Promise<RetryFailedDialogueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'batch.retryFailed',
      batchJobId: data.batchJobId,
    };

    logger.info(ctx, 'Retrying failed dialogue lines');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Get batch job
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('batch_generation_jobs')
      .select(
        `
        id, episode_id, account_id, status, total_lines,
        completed_lines, failed_lines, estimated_cost, actual_cost,
        voice_assignments, errors, started_at, completed_at,
        created_at, updated_at
      `,
      )
      .eq('id', data.batchJobId)
      .single();

    if (error || !job) {
      throw new Error(whyNoRow(error, 'Batch job not found'));
    }

    const jobData = job as BatchJobResponse;

    // A batch job is readable by every member of its account; retrying it
    // spends the key and writes lines, so it needs write access to the
    // episode, and is billed to the episode's account (KB-47)
    const target = await authorizeEpisodeTarget(client, jobData.episode_id);

    if (!target?.projectId) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'Batch voice retry refused',
      );
      throw new Error('Batch job not found');
    }

    if (jobData.failed_lines === 0) {
      throw new Error('No failed lines to retry');
    }

    // 2. Get failed dialogue lines
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: failedLines, error: linesError } = await (client as any)
      .from('dialogue_lines')
      .select(
        'id, episode_id, character_asset_id, text, audio_url, status, sequence_number',
      )
      .eq('episode_id', jobData.episode_id)
      .eq('status', 'failed');

    if (linesError || !failedLines || failedLines.length === 0) {
      throw new Error('No failed dialogue lines found');
    }

    const linesToRetry = failedLines as DialogueLineForBatch[];

    logger.info(
      { ...ctx, failedCount: linesToRetry.length },
      'Found failed lines to retry',
    );

    // 3. TTS model for the episode's project
    const ttsModel = await getProjectTTSModelForBatch(target.projectId);

    // 4. Reset job status for retry (reset failed count, preserve completed)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: retried, error: retriedError } = await (client as any)
      .from('batch_generation_jobs')
      .update({
        status: 'processing',
        failed_lines: 0,
        total_lines: jobData.completed_lines + linesToRetry.length,
        started_at: new Date().toISOString(),
        completed_at: null,
        errors: [],
      })
      .eq('id', data.batchJobId)
      .select('id');

    if (retriedError) {
      throw new Error(
        `Failed to update batch_generation_jobs: ${retriedError.message}`,
      );
    }

    requireAffectedRows(retried, "You can't retry this batch.");

    // 5. Dispatch failed lines to voice queue
    const voiceJobs = linesToRetry.map((line) => {
      const assignment = line.character_asset_id
        ? jobData.voice_assignments[line.character_asset_id]
        : null;

      return {
        dialogueLineId: line.id,
        batchJobId: jobData.id,
        episodeId: jobData.episode_id,
        voiceId: assignment?.voiceId ?? '',
        ttsModel,
        voiceSettings: {
          stability: assignment?.settings?.stability ?? 0.5,
          similarityBoost: assignment?.settings?.similarityBoost ?? 0.75,
          style: assignment?.settings?.style,
          speed: assignment?.settings?.speed,
        },
        text: line.text,
        characterAssetId: line.character_asset_id ?? undefined,
        userId: user.id,
        overwriteExisting: true,
      };
    });

    await queueVoiceJobs(target, voiceJobs);

    logger.info(
      { ...ctx, queuedCount: voiceJobs.length },
      'Failed lines dispatched to voice queue for retry',
    );

    return {
      batchJobId: jobData.id,
      retriedCount: linesToRetry.length,
      status: 'processing',
    };
  },
  {
    schema: RetryFailedDialogueSchema,
  },
);

export const retryFailedDialogueAction = returnRefusals(retryFailedDialogue);

/**
 * Cancel a batch generation job
 *
 * Stops processing of remaining dialogue lines. Lines that have
 * already been processed will retain their generated audio.
 *
 * @throws {Error} If job not found or already completed/cancelled
 */
const cancelBatch = enhanceAction(
  async (data: CancelBatchSchemaType): Promise<CancelBatchResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'batch.cancel',
      batchJobId: data.batchJobId,
    };

    logger.info(ctx, 'Cancelling batch job');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const job = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('batch_generation_jobs')
        .select('status')
        .eq('id', data.batchJobId)
        .single(),
      'Batch job not found',
    );

    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new ActionRefusal(
        'Cannot cancel completed or already cancelled job',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cancelled, error: cancelledError } = await (client as any)
      .from('batch_generation_jobs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.batchJobId)
      .select('id');

    if (cancelledError) {
      throw new Error(
        `Failed to update batch_generation_jobs: ${cancelledError.message}`,
      );
    }

    requireAffectedRows(cancelled, "You can't cancel this batch.");

    logger.info(ctx, 'Batch job cancelled');

    return {
      success: true,
      batchJobId: data.batchJobId,
    };
  },
  {
    schema: CancelBatchSchema,
  },
);

export const cancelBatchAction = returnRefusals(cancelBatch);

/**
 * Reset stale 'generating' dialogue lines back to 'pending'
 * Called on audio studio mount to recover from crashes/stale state
 */
export const resetStaleGeneratingLinesAction = enhanceAction(
  async (data: { episodeId: string }): Promise<{ resetCount: number }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'batch.resetStale',
      episodeId: data.episodeId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Check for active batch jobs before resetting — don't kill running batches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: activeJob } = await (client as any)
      .from('batch_generation_jobs')
      .select('id, started_at')
      .eq('episode_id', data.episodeId)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only reset if no active job, or job is stale (>5 minutes without progress)
    if (activeJob?.started_at) {
      const elapsed =
        Date.now() - new Date(activeJob.started_at as string).getTime();
      const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

      if (elapsed < STALE_THRESHOLD_MS) {
        logger.info(
          { ...ctx, activeJobId: activeJob.id },
          'Active batch job found, skipping stale reset',
        );
        return { resetCount: 0 };
      }
    }

    // Reset any dialogue lines stuck in 'generating' status back to 'pending'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (client as any)
      .from('dialogue_lines')
      .update({ status: 'pending' })
      .eq('episode_id', data.episodeId)
      .eq('status', 'generating')
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to reset stale generating lines');
      return { resetCount: 0 };
    }

    const resetCount = updated?.length ?? 0;

    if (resetCount > 0) {
      logger.info(
        { ...ctx, resetCount },
        'Reset stale generating lines to pending',
      );

      // Also mark any stuck batch jobs as failed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('batch_generation_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
        })
        .eq('episode_id', data.episodeId)
        .in('status', ['queued', 'processing']);
    }

    return { resetCount };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
    }),
  },
);

/**
 * Check for an active or recently completed batch job for an episode.
 * Used on mount to resume polling if a batch is in progress.
 */
export const getActiveBatchForEpisodeAction = enhanceAction(
  async (data: { episodeId: string }): Promise<BatchJobStatus | null> => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Find the most recent active batch job for this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job } = await (client as any)
      .from('batch_generation_jobs')
      .select(
        `
        id, episode_id, account_id, status, total_lines,
        completed_lines, failed_lines, estimated_cost, actual_cost,
        voice_assignments, errors, started_at, completed_at,
        created_at, updated_at
      `,
      )
      .eq('episode_id', data.episodeId)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return null;
    }

    const jobData = job as BatchJobResponse;

    const pending =
      jobData.total_lines - jobData.completed_lines - jobData.failed_lines;
    const percentage =
      jobData.total_lines > 0
        ? Math.round(
            ((jobData.completed_lines + jobData.failed_lines) /
              jobData.total_lines) *
              100,
          )
        : 0;

    return {
      batchJobId: jobData.id,
      status: jobData.status as BatchJobStatus['status'],
      progress: {
        total: jobData.total_lines,
        completed: jobData.completed_lines,
        failed: jobData.failed_lines,
        pending,
        percentage,
      },
      cost: {
        estimated: jobData.estimated_cost,
        actual: jobData.actual_cost,
      },
      errors: jobData.errors ?? [],
      startedAt: jobData.started_at,
      completedAt: jobData.completed_at,
      estimatedCompletionAt: null,
    };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
    }),
  },
);
