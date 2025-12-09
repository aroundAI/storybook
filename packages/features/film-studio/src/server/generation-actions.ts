'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetActiveGenerationsSchema } from '../lib/schemas/dashboard.schema';

export interface GenerationJob {
  id: string;
  jobType: string;
  name: string;
  status: 'queued' | 'processing';
  progress: number;
  projectName: string;
}

/**
 * Get active and queued generation jobs for an account
 */
export const getActiveGenerationsAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: jobs } = await client
      .from('generation_jobs')
      .select(
        `
        id,
        job_type,
        status,
        started_at,
        created_at,
        input_data,
        projects!inner(name)
      `,
      )
      .eq('account_id', data.accountId)
      .in('status', ['queued', 'processing'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (!jobs) {
      return [];
    }

    return jobs.map((job) => {
      const projectName =
        (job.projects as unknown as { name: string })?.name || 'Unknown';
      const inputData = job.input_data as { name?: string } | null;

      // Calculate estimated progress based on time elapsed
      let progress = 0;
      if (job.status === 'processing' && job.started_at) {
        const startTime = new Date(job.started_at).getTime();
        const elapsed = Date.now() - startTime;
        const estimatedDuration = getEstimatedDuration(job.job_type);
        progress = Math.min(
          Math.round((elapsed / estimatedDuration) * 100),
          95,
        );
      }

      return {
        id: job.id,
        jobType: job.job_type,
        name: inputData?.name || getDefaultJobName(job.job_type),
        status: job.status as 'queued' | 'processing',
        progress,
        projectName,
      };
    });
  },
  {
    schema: GetActiveGenerationsSchema,
  },
);

function getEstimatedDuration(jobType: string): number {
  // Estimated duration in milliseconds
  const durations: Record<string, number> = {
    video: 120000, // 2 minutes
    voice: 30000, // 30 seconds
    music: 60000, // 1 minute
    sfx: 20000, // 20 seconds
    story: 45000, // 45 seconds
    screenplay: 60000, // 1 minute
    shot_list: 30000, // 30 seconds
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
