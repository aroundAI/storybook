'use server';

import 'server-only';

import { randomUUID } from 'crypto';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export interface GenerationStatusJob {
  id: string;
  jobType: 'video' | 'voice' | 'music' | 'story';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  name: string;
  projectName: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  outputUrl?: string;
}

const GetGenerationStatusSchema = z.object({
  accountId: z.string().uuid(),
});

const CancelJobSchema = z.object({
  accountId: z.string().uuid(),
  jobId: z.string().uuid(),
});

const RetryJobSchema = z.object({
  accountId: z.string().uuid(),
  jobId: z.string().uuid(),
});

/**
 * Safely extracts a nested property from Supabase join data
 */
function safeGetNestedProperty<T>(
  obj: unknown,
  path: string[],
  defaultValue: T,
): T {
  let current: unknown = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return defaultValue;
    }
  }
  return current as T;
}

/**
 * Calculate progress with NaN and invalid date handling
 */
function calculateProgress(
  status: string,
  startedAt: string | null,
  jobType: string,
): number {
  if (status !== 'processing' || !startedAt) {
    return 0;
  }

  const startTime = new Date(startedAt).getTime();

  if (isNaN(startTime)) {
    return 0;
  }

  const elapsed = Date.now() - startTime;

  if (elapsed < 0) {
    return 0;
  }

  const estimatedDuration = getEstimatedDuration(jobType);
  const progress = Math.round((elapsed / estimatedDuration) * 100);

  return Math.max(0, Math.min(progress, 95));
}

function getEstimatedDuration(jobType: string): number {
  const durations: Record<string, number> = {
    video: 120000,
    voice: 30000,
    music: 60000,
    sfx: 20000,
    story: 45000,
    screenplay: 60000,
    shot_list: 30000,
  };
  return durations[jobType] || 60000;
}

function getDefaultJobName(jobType: string): string {
  const names: Record<string, string> = {
    video: 'Video generation',
    voice: 'Voice generation',
    music: 'Music generation',
    sfx: 'SFX generation',
    story: 'Story generation',
    screenplay: 'Screenplay conversion',
    shot_list: 'Shot list generation',
  };
  return names[jobType] || 'Generation job';
}

/**
 * Get generation status for all jobs (queued, processing, completed, failed)
 */
export const getGenerationStatusAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: jobs, error } = await client
      .from('generation_jobs')
      .select(
        `
        id,
        job_type,
        status,
        started_at,
        input_data,
        output_data,
        error_message,
        created_at,
        completed_at,
        projects (name)
      `,
      )
      .eq('account_id', data.accountId)
      .in('status', ['queued', 'processing', 'completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to fetch generation jobs: ${error.message}`);
    }

    return {
      jobs:
        jobs?.map((job) => {
          const projectName = safeGetNestedProperty<string>(
            job.projects,
            ['name'],
            'Unknown project',
          );
          const inputData = job.input_data as { name?: string } | null;
          const outputData = job.output_data as {
            videoUrl?: string;
            audioUrl?: string;
          } | null;

          const progress = calculateProgress(
            job.status,
            job.started_at,
            job.job_type,
          );

          return {
            id: job.id,
            jobType: job.job_type as GenerationStatusJob['jobType'],
            status: job.status as GenerationStatusJob['status'],
            progress,
            name: inputData?.name || getDefaultJobName(job.job_type),
            projectName,
            error: job.error_message ?? undefined,
            createdAt: job.created_at,
            completedAt: job.completed_at ?? undefined,
            outputUrl: outputData?.videoUrl || outputData?.audioUrl,
          };
        }) || [],
    };
  },
  { schema: GetGenerationStatusSchema },
);

/**
 * Cancel a queued or processing job
 */
export const cancelJobAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('generation_jobs')
      .update({ status: 'cancelled' })
      .eq('id', data.jobId)
      .eq('account_id', data.accountId)
      .in('status', ['queued', 'processing']);

    if (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }

    return { success: true };
  },
  {
    schema: CancelJobSchema,
  },
);

/**
 * Retry a failed job by creating a new job with the same input
 */
export const retryJobAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: job, error: fetchError } = await client
      .from('generation_jobs')
      .select('*')
      .eq('id', data.jobId)
      .eq('account_id', data.accountId)
      .eq('status', 'failed')
      .single();

    if (fetchError || !job) {
      throw new Error('Job not found or not in failed state');
    }

    // Generate a new idempotency key for the retry
    const idempotencyKey = `retry-${job.id}-${randomUUID()}`;

    const { data: newJob, error: insertError } = await client
      .from('generation_jobs')
      .insert({
        idempotency_key: idempotencyKey,
        job_type: job.job_type,
        account_id: job.account_id,
        project_id: job.project_id,
        reference_type: job.reference_type,
        reference_id: job.reference_id,
        input_data: job.input_data,
        provider: job.provider,
        estimated_cost_cents: job.estimated_cost_cents,
        priority: job.priority,
        status: 'queued',
        retry_count: (job.retry_count || 0) + 1,
        max_retries: job.max_retries,
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Failed to retry job: ${insertError.message}`);
    }

    return { success: true, newJobId: newJob?.id };
  },
  {
    schema: RetryJobSchema,
  },
);
