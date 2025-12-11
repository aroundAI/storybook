'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
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
import { generateDialogueVoiceAction } from './voice-actions';
import {
  checkAccountBudget,
  estimateVoiceCost,
  getVoiceIdForCharacter,
  getVoiceSettings,
} from './voice-queries';

// Note: These actions use type assertions because the film studio tables
// (batch_generation_jobs, dialogue_lines, episodes) are not yet in the generated
// database types. The database schema will be aligned in a future update.
// RLS policies enforce project-level authorization.

/**
 * Film studio database response types for type-safe access to nested data
 */
interface EpisodeResponse {
  id: string;
  project_id: string;
  projects: {
    id: string;
    account_id: string;
  };
}

interface DialogueLineForBatch {
  id: string;
  episode_id: string;
  character_asset_id: string | null;
  text: string;
  audio_url: string | null;
  status: string;
  sequence_number: number;
}

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
 * Build voice assignments for all characters in dialogue lines
 * Merges user-provided assignments with character voice profiles
 */
async function buildVoiceAssignments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  dialogueLines: DialogueLineForBatch[],
  userAssignments?: Record<string, VoiceAssignment>,
): Promise<Record<string, VoiceAssignment>> {
  const assignments: Record<string, VoiceAssignment> = { ...userAssignments };

  // Get unique character IDs that don't have user-provided assignments
  const characterIds = [
    ...new Set(
      dialogueLines
        .map((line) => line.character_asset_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const missingCharacters = characterIds.filter((id) => !assignments[id]);

  // Fetch voice profiles for characters without user assignments
  for (const characterAssetId of missingCharacters) {
    const voiceId = await getVoiceIdForCharacter(client, characterAssetId);
    if (voiceId) {
      const settings = await getVoiceSettings(client, characterAssetId);
      assignments[characterAssetId] = {
        voiceId,
        settings,
      };
    }
  }

  return assignments;
}

/**
 * Options for background batch processing
 */
interface ProcessBatchOptions {
  /** Initial completed count (for retry scenarios) */
  initialCompleted?: number;
  /** Initial cost (for retry scenarios) */
  initialCost?: number;
  /** Previous errors to preserve (for retry scenarios) */
  previousErrors?: BatchError[];
}

/**
 * Process batch in background (non-blocking)
 * Note: In production, this should be moved to a queue system (BullMQ, Inngest, etc.)
 */
async function processBatchInBackground(
  batchJobId: string,
  dialogueLines: DialogueLineForBatch[],
  voiceAssignments: Record<string, VoiceAssignment>,
  concurrency: number,
  options: ProcessBatchOptions = {},
): Promise<void> {
  const logger = await getLogger();
  const ctx = {
    name: 'batch.process',
    batchJobId,
    totalLines: dialogueLines.length,
    concurrency,
  };

  logger.info(ctx, 'Starting batch processing');

  const client = getSupabaseServerClient();

  // Update status to processing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any)
    .from('batch_generation_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
    })
    .eq('id', batchJobId);

  // Initialize counters - preserve previous progress for retries
  let completed = options.initialCompleted ?? 0;
  let failed = 0;
  let actualCost = options.initialCost ?? 0;
  const errors: BatchError[] = [...(options.previousErrors ?? [])];

  // Process in batches with concurrency limit
  for (let i = 0; i < dialogueLines.length; i += concurrency) {
    // Check if cancelled before processing next batch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentJob } = await (client as any)
      .from('batch_generation_jobs')
      .select('status')
      .eq('id', batchJobId)
      .single();

    if (currentJob?.status === 'cancelled') {
      logger.info({ ...ctx, completed, failed }, 'Batch cancelled by user');
      break;
    }

    const batch = dialogueLines.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (line) => {
        const assignment = line.character_asset_id
          ? voiceAssignments[line.character_asset_id]
          : null;

        if (!assignment) {
          throw new Error(
            `No voice assignment for character: ${line.character_asset_id}`,
          );
        }

        return generateDialogueVoiceAction({
          dialogueLineId: line.id,
          voiceId: assignment.voiceId,
          settings: assignment.settings,
          overwriteExisting: true,
        });
      }),
    );

    // Process results
    results.forEach((result, index) => {
      const line = batch[index];
      if (!line) return;

      if (result.status === 'fulfilled') {
        if (result.value.status === 'completed') {
          completed++;
          actualCost += result.value.cost;
        } else {
          // generateDialogueVoiceAction returns failure result instead of throwing
          failed++;
          errors.push({
            dialogueLineId: line.id,
            error: result.value.error ?? 'Generation failed',
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        failed++;
        errors.push({
          dialogueLineId: line.id,
          error: result.reason?.message ?? 'Unknown error',
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Update progress after each batch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('batch_generation_jobs')
      .update({
        completed_lines: completed,
        failed_lines: failed,
        actual_cost: actualCost,
        errors,
      })
      .eq('id', batchJobId);

    logger.info(
      { ...ctx, completed, failed, batch: Math.floor(i / concurrency) + 1 },
      'Batch progress updated',
    );
  }

  // Mark as completed
  const finalStatus = failed === dialogueLines.length ? 'failed' : 'completed';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any)
    .from('batch_generation_jobs')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', batchJobId);

  logger.info(
    { ...ctx, status: finalStatus, completed, failed, actualCost },
    'Batch processing completed',
  );

  // Revalidate the episodes page
  revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');
}

/**
 * Generate voice audio for all dialogue lines in an episode
 *
 * This action orchestrates batch voice generation by:
 * 1. Fetching all pending/failed dialogue lines for the episode
 * 2. Building voice assignments from user input or character profiles
 * 3. Estimating total cost and checking budget
 * 4. Creating a batch job record for tracking
 * 5. Starting background processing
 *
 * @throws {Error} If episode not found, budget insufficient, or missing voice assignments
 */
export const batchGenerateDialogueAction = enhanceAction(
  async (
    data: BatchGenerateDialogueSchemaType,
  ): Promise<BatchGenerateDialogueResult> => {
    // Apply defaults
    const overwriteExisting = data.overwriteExisting ?? false;
    const concurrency = data.concurrency ?? 5;

    const logger = await getLogger();
    const ctx = {
      name: 'batch.generateDialogue',
      episodeId: data.episodeId,
      overwriteExisting,
      concurrency,
    };

    logger.info(ctx, 'Starting batch dialogue generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized batch generation attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch episode with account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id, projects!inner(id, account_id)')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    const episodeData = episode as EpisodeResponse;
    const accountId = episodeData.projects?.account_id;
    // projectId available for future use (e.g., cost tracking per project)
    const _projectId = episodeData.project_id;

    if (!accountId) {
      throw new Error('Could not determine account for episode');
    }

    // 2. Fetch dialogue lines for episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLines, error: linesError } = await (client as any)
      .from('dialogue_lines')
      .select(
        'id, episode_id, character_asset_id, text, audio_url, status, sequence_number',
      )
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (linesError) {
      logger.error({ ...ctx, error: linesError }, 'Failed to fetch dialogue');
      throw new Error('Failed to fetch dialogue lines');
    }

    const allLines = (dialogueLines ?? []) as DialogueLineForBatch[];

    // 3. Filter lines to process
    const linesToProcess = allLines.filter((line) => {
      if (overwriteExisting) return true;
      return !line.audio_url || line.status === 'failed';
    });

    if (linesToProcess.length === 0) {
      throw new Error(
        'No dialogue lines to process. All lines already have audio.',
      );
    }

    logger.info(
      { ...ctx, totalLines: allLines.length, toProcess: linesToProcess.length },
      'Filtered dialogue lines',
    );

    // 4. Build voice assignments
    const voiceAssignments = await buildVoiceAssignments(
      client,
      linesToProcess,
      data.voiceAssignments,
    );

    // Validate all characters have voice assignments
    const linesWithCharacter = linesToProcess.filter(
      (line) => line.character_asset_id,
    );
    const missingVoices = linesWithCharacter.filter(
      (line) => !voiceAssignments[line.character_asset_id!],
    );

    if (missingVoices.length > 0) {
      const missingCharacterIds = [
        ...new Set(missingVoices.map((l) => l.character_asset_id)),
      ];
      logger.warn(
        { ...ctx, missingCharacterIds },
        'Missing voice assignments for characters',
      );
      throw new Error(
        `Missing voice assignments for ${missingCharacterIds.length} character(s). ` +
          `Please assign voices or create voice profiles.`,
      );
    }

    // 5. Estimate total cost
    const estimatedCost = linesToProcess.reduce((total, line) => {
      return total + estimateVoiceCost(line.text.length);
    }, 0);

    // 6. Check budget
    const hasBudget = await checkAccountBudget(
      client,
      accountId,
      estimatedCost,
    );

    if (!hasBudget) {
      logger.warn({ ...ctx, estimatedCost, accountId }, 'Insufficient budget');
      throw new Error(
        `Insufficient budget for batch generation. ` +
          `Estimated cost: $${(estimatedCost / 100).toFixed(2)}. ` +
          `Please upgrade your plan or wait until next month.`,
      );
    }

    // 7. Create batch job
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: batchJob, error: jobError } = await (client as any)
      .from('batch_generation_jobs')
      .insert({
        episode_id: data.episodeId,
        account_id: accountId,
        status: 'queued',
        total_lines: linesToProcess.length,
        completed_lines: 0,
        failed_lines: 0,
        estimated_cost: estimatedCost,
        actual_cost: 0,
        voice_assignments: voiceAssignments,
        errors: [],
      })
      .select()
      .single();

    if (jobError || !batchJob) {
      logger.error({ ...ctx, error: jobError }, 'Failed to create batch job');
      throw new Error('Failed to create batch job');
    }

    const job = batchJob as BatchJobResponse;

    logger.info(
      { ...ctx, batchJobId: job.id, estimatedCost },
      'Batch job created',
    );

    // 8. Start background processing (fire and forget)
    // Note: Using void to explicitly ignore the promise for background processing
    void processBatchInBackground(
      job.id,
      linesToProcess,
      voiceAssignments,
      concurrency,
    );

    // 9. Return batch job info immediately
    const estimatedDuration =
      Math.ceil(linesToProcess.length / concurrency) * 10;

    return {
      batchJobId: job.id,
      episodeId: data.episodeId,
      totalLines: linesToProcess.length,
      estimatedCost,
      estimatedDuration,
      status: 'queued',
    };
  },
  {
    schema: BatchGenerateDialogueSchema,
  },
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
      .select('*')
      .eq('id', data.batchJobId)
      .single();

    if (error || !job) {
      logger.warn({ ...ctx, error }, 'Batch job not found');
      throw new Error('Batch job not found');
    }

    const jobData = job as BatchJobResponse;

    const pending =
      jobData.total_lines - jobData.completed_lines - jobData.failed_lines;
    const percentage =
      jobData.total_lines > 0
        ? Math.round((jobData.completed_lines / jobData.total_lines) * 100)
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
export const retryFailedDialogueAction = enhanceAction(
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
      .select('*')
      .eq('id', data.batchJobId)
      .single();

    if (error || !job) {
      throw new Error('Batch job not found');
    }

    const jobData = job as BatchJobResponse;

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

    // 3. Reset job status for retry (preserve completed_lines and actual_cost)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('batch_generation_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        completed_at: null,
      })
      .eq('id', data.batchJobId);

    // 4. Start background processing for failed lines
    // Pass existing progress to preserve it during retry
    void processBatchInBackground(
      jobData.id,
      linesToRetry,
      jobData.voice_assignments,
      5, // Default concurrency for retries
      {
        initialCompleted: jobData.completed_lines,
        initialCost: jobData.actual_cost,
        previousErrors: jobData.errors,
      },
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

/**
 * Cancel a batch generation job
 *
 * Stops processing of remaining dialogue lines. Lines that have
 * already been processed will retain their generated audio.
 *
 * @throws {Error} If job not found or already completed/cancelled
 */
export const cancelBatchAction = enhanceAction(
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('batch_generation_jobs')
      .select('status')
      .eq('id', data.batchJobId)
      .single();

    if (error || !job) {
      throw new Error('Batch job not found');
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new Error('Cannot cancel completed or already cancelled job');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('batch_generation_jobs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.batchJobId);

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
