'use server';

import 'server-only';

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
