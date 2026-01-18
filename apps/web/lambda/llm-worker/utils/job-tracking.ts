/**
 * Generation Job Tracking Utilities for Lambda
 *
 * These functions update job status directly via Supabase client
 * since Lambda handlers can't import from @kit/episodes/server
 *
 * Uses remote schema: reference_type, reference_id, input_data, output_data
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type GenerationJobType =
  | 'story'
  | 'screenplay'
  | 'shot_list'
  | 'translate-dialogue';

export type GenerationJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Mark a job as processing when Lambda starts execution
 */
export async function markJobProcessing(
  supabase: SupabaseClient,
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

/**
 * Mark a job as completed when Lambda finishes successfully
 */
export async function markJobCompleted(
  supabase: SupabaseClient,
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

/**
 * Mark a job as failed when Lambda encounters an error
 */
export async function markJobFailed(
  supabase: SupabaseClient,
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
