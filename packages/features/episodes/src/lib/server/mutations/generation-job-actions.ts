'use server';

import 'server-only';

import crypto from 'crypto';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

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
