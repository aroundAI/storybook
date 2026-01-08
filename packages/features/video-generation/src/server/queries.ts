import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { VideoGenerationJob } from '../lib/types';

// Note: These queries assume the generation_jobs table exists in the database.
// The table will be created as part of the database migration in FILM-101.

export async function getGenerationJob(jobId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('generation_jobs')
    .select(`
      id, account_id, project_id, job_type, reference_type, reference_id,
      provider, provider_job_id, status, input_data, output_data,
      estimated_cost_cents, cost_cents, error_message, error_code,
      max_retries, retry_count, timeout_seconds, idempotency_key,
      started_at, completed_at, created_at, updated_at
    `)
    .eq('id', jobId)
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as VideoGenerationJob,
    error: null,
  };
}

export async function getGenerationJobsByShot(shotId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('generation_jobs')
    .select(`
      id, account_id, project_id, job_type, reference_type, reference_id,
      provider, provider_job_id, status, input_data, output_data,
      estimated_cost_cents, cost_cents, error_message, error_code,
      max_retries, retry_count, timeout_seconds, idempotency_key,
      started_at, completed_at, created_at, updated_at
    `)
    .eq('shot_id', shotId)
    .order('started_at', { ascending: false });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as VideoGenerationJob[],
    error: null,
  };
}

export async function getPendingGenerationJobs() {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('generation_jobs')
    .select(`
      id, account_id, project_id, job_type, reference_type, reference_id,
      provider, provider_job_id, status, input_data, output_data,
      estimated_cost_cents, cost_cents, error_message, error_code,
      max_retries, retry_count, timeout_seconds, idempotency_key,
      started_at, completed_at, created_at, updated_at
    `)
    .in('status', ['pending', 'processing'])
    .order('started_at', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as VideoGenerationJob[],
    error: null,
  };
}

export async function getCompletedGenerationJobs(limit = 10) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('generation_jobs')
    .select(`
      id, account_id, project_id, job_type, reference_type, reference_id,
      provider, provider_job_id, status, input_data, output_data,
      estimated_cost_cents, cost_cents, error_message, error_code,
      max_retries, retry_count, timeout_seconds, idempotency_key,
      started_at, completed_at, created_at, updated_at
    `)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as VideoGenerationJob[],
    error: null,
  };
}
