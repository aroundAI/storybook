'use server';

import 'server-only';

import crypto from 'crypto';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { GenerationJobType } from '../../types';

const logger = await getLogger();

export type GenerationJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Generate idempotency key for deduplication
 */
function generateIdempotencyKey(
  referenceType: string,
  referenceId: string,
  jobType: string,
): string {
  const key = `${referenceType}:${referenceId}:${jobType}:${Date.now()}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

/**
 * Create a new generation job
 * Uses remote schema: reference_type, reference_id, input_data, account_id, project_id
 */
export const createGenerationJobAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const idempotencyKey = generateIdempotencyKey(
      'episode',
      data.episodeId,
      data.jobType,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('generation_jobs')
      .insert({
        idempotency_key: idempotencyKey,
        account_id: data.accountId,
        project_id: data.projectId,
        job_type: data.jobType,
        reference_type: 'episode',
        reference_id: data.episodeId,
        status: 'queued',
        input_data: data.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) {
      logger.error(
        { error, episodeId: data.episodeId, jobType: data.jobType },
        'Failed to create generation job',
      );
      throw new Error(`Failed to create job: ${error.message}`);
    }

    logger.info(
      { jobId: job.id, episodeId: data.episodeId, jobType: data.jobType },
      'Generation job created',
    );

    return { success: true, jobId: job.id };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      accountId: z.string().uuid(),
      projectId: z.string().uuid(),
      jobType: z.enum([
        'story',
        'screenplay',
        'shot_list',
        'translate-dialogue',
      ]),
      metadata: z.record(z.unknown()).optional(),
    }),
  },
);

/**
 * Get active generation jobs for an episode
 * Returns jobs that are queued or processing
 */
export const getActiveGenerationJobsAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jobs, error } = await (client as any)
      .from('generation_jobs')
      .select('id, job_type, status, created_at, started_at, input_data')
      .eq('reference_type', 'episode')
      .eq('reference_id', data.episodeId)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(
        { error, episodeId: data.episodeId },
        'Failed to fetch generation jobs',
      );
      throw new Error(`Failed to fetch jobs: ${error.message}`);
    }

    return { success: true, jobs: jobs ?? [] };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
    }),
  },
);

/**
 * Get active job for a specific type
 * Used by UI to check if a specific generation is in progress
 */
export const getActiveJobByTypeAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('generation_jobs')
      .select('id, job_type, status, created_at, started_at, input_data')
      .eq('reference_type', 'episode')
      .eq('reference_id', data.episodeId)
      .eq('job_type', data.jobType)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error(
        { error, episodeId: data.episodeId, jobType: data.jobType },
        'Failed to fetch generation job',
      );
      throw new Error(`Failed to fetch job: ${error.message}`);
    }

    return { success: true, job };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      jobType: z.enum([
        'story',
        'screenplay',
        'shot_list',
        'translate-dialogue',
      ]),
    }),
  },
);

/**
 * Update job status
 * Called by Lambda handlers on start, completion, or failure
 */
export async function updateGenerationJobStatus(
  jobId: string,
  status: GenerationJobStatus,
  options?: { errorMessage?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const client = getSupabaseServerClient();

  const updateData: Record<string, unknown> = { status };

  if (status === 'processing') {
    updateData.started_at = new Date().toISOString();
  }

  if (status === 'completed' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }

  if (options?.errorMessage) {
    updateData.error_message = options.errorMessage;
  }

  if (options?.metadata) {
    // Merge with existing input_data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (client as any)
      .from('generation_jobs')
      .select('input_data, output_data')
      .eq('id', jobId)
      .single();

    updateData.output_data = {
      ...((existing?.output_data as Record<string, unknown>) ?? {}),
      ...options.metadata,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any)
    .from('generation_jobs')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    logger.error({ error, jobId, status }, 'Failed to update job status');
    throw new Error(`Failed to update job: ${error.message}`);
  }

  logger.info({ jobId, status }, 'Generation job status updated');
}

/**
 * Complete a job by episode and type
 * Convenience function when jobId is not available
 */
export async function completeGenerationJobByType(
  episodeId: string,
  jobType: GenerationJobType,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const client = getSupabaseServerClient();

  const updateData: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  };

  if (metadata) {
    updateData.output_data = metadata;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any)
    .from('generation_jobs')
    .update(updateData)
    .eq('reference_type', 'episode')
    .eq('reference_id', episodeId)
    .eq('job_type', jobType)
    .in('status', ['queued', 'processing']);

  if (error) {
    logger.error(
      { error, episodeId, jobType },
      'Failed to complete job by type',
    );
  }

  logger.info({ episodeId, jobType }, 'Generation job completed by type');
}

/**
 * Fail a job by episode and type
 * Convenience function for error handling
 */
export async function failGenerationJobByType(
  episodeId: string,
  jobType: GenerationJobType,
  errorMessage: string,
): Promise<void> {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any)
    .from('generation_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('reference_type', 'episode')
    .eq('reference_id', episodeId)
    .eq('job_type', jobType)
    .in('status', ['queued', 'processing']);

  if (error) {
    logger.error(
      { error, episodeId, jobType, errorMessage },
      'Failed to mark job as failed',
    );
  }

  logger.warn({ episodeId, jobType, errorMessage }, 'Generation job failed');
}
