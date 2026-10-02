/**
 * generation_jobs bookkeeping for a tracked stage. Moved here from the LLM
 * worker's `utils/job-tracking.ts`, which re-exports these: the worker
 * cannot import `@kit/episodes/server`, and commit owns the bookkeeping.
 *
 * Uses the remote schema: reference_type, reference_id, input_data,
 * output_data. The service role runs these, so RLS filters nothing (KB-105).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { GenerationJobType } from './types';

export type { GenerationJobType } from './types';

export type GenerationJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export async function markJobProcessing(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  jobType: GenerationJobType,
): Promise<void> {
  const { error } = await supabase
    .from('generation_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
    })
    .eq('reference_type', 'episode')
    .eq('reference_id', episodeId)
    .eq('job_type', jobType)
    .eq('status', 'queued');

  if (error) {
    console.warn(
      `[Job Tracking] Failed to mark job processing:`,
      error.message,
    );
  } else {
    console.log(
      `[Job Tracking] Marked ${jobType} as processing for episode ${episodeId}`,
    );
  }
}

export async function markJobCompleted(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  jobType: GenerationJobType,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const updateData: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  };

  if (metadata) {
    updateData.output_data = metadata;
  }

  const { error } = await supabase
    .from('generation_jobs')
    .update(updateData)
    .eq('reference_type', 'episode')
    .eq('reference_id', episodeId)
    .eq('job_type', jobType)
    .in('status', ['queued', 'processing']);

  if (error) {
    console.warn(`[Job Tracking] Failed to mark job completed:`, error.message);
  } else {
    console.log(
      `[Job Tracking] Marked ${jobType} as completed for episode ${episodeId}`,
    );
  }
}

export async function markJobFailed(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  jobType: GenerationJobType,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
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
    console.warn(`[Job Tracking] Failed to mark job failed:`, error.message);
  } else {
    console.log(
      `[Job Tracking] Marked ${jobType} as failed for episode ${episodeId}`,
    );
  }
}
