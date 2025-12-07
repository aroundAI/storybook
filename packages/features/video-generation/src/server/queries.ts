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
    .select('*')
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
    .select('*')
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
    .select('*')
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
    .select('*')
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
