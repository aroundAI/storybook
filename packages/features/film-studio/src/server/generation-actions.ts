'use server';

import 'server-only';

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

  // Handle invalid date
  if (isNaN(startTime)) {
    return 0;
  }

  const elapsed = Date.now() - startTime;

  // Handle negative elapsed time (clock skew)
  if (elapsed < 0) {
    return 0;
  }

  const estimatedDuration = getEstimatedDuration(jobType);
  const progress = Math.round((elapsed / estimatedDuration) * 100);

  // Clamp between 0 and 95
  return Math.max(0, Math.min(progress, 95));
}

/**
 * Get active and queued generation jobs for an account
 */
export const getActiveGenerationsAction = enhanceAction(
  async (data) => {
    try {
      const client = getSupabaseServerClient();

      const { data: jobs, error } = await client
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

      if (error) {
        throw new Error(`Failed to fetch generation jobs: ${error.message}`);
      }

      if (!jobs) {
        return [];
      }

      return jobs.map((job) => {
        const projectName = safeGetNestedProperty<string>(
          job.projects,
          ['name'],
          'Unknown',
        );
        const inputData = job.input_data as { name?: string } | null;

        const progress = calculateProgress(
          job.status,
          job.started_at,
          job.job_type,
        );

        return {
          id: job.id,
          jobType: job.job_type,
          name: inputData?.name || getDefaultJobName(job.job_type),
          status: job.status as 'queued' | 'processing',
          progress,
          projectName,
        };
      });
    } catch (error) {
      console.error('Error fetching active generations:', error);
      throw error;
    }
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
