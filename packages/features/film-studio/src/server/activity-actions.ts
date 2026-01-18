'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetRecentActivitySchema } from '../lib/schemas/dashboard.schema';

export type ActivityType =
  | 'episode_created'
  | 'video_generated'
  | 'audio_generated'
  | 'published'
  | 'generation_completed'
  | 'generation_failed';

export interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  projectName: string;
  createdAt: string;
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
 * Get recent activity across all projects for an account
 * Combines data from generation_jobs and publishes tables
 */
export const getRecentActivityAction = enhanceAction(
  async (data) => {
    try {
      const client = getSupabaseServerClient();

      // Get recent generation jobs (completed or failed)
      const { data: jobs, error: jobsError } = await client
        .from('generation_jobs')
        .select(
          `
          id,
          job_type,
          status,
          created_at,
          completed_at,
          projects!inner(name)
        `,
        )
        .eq('account_id', data.accountId)
        .in('status', ['completed', 'failed'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(data.limit);

      if (jobsError) {
        throw new Error(
          `Failed to fetch generation jobs: ${jobsError.message}`,
        );
      }

      // Get recent publishes - filtered by account at SQL level
      const { data: publishes, error: publishesError } = await client
        .from('publishes')
        .select(
          `
          id,
          platform,
          status,
          published_at,
          created_at,
          episodes!inner(
            title,
            projects!inner(name, account_id)
          )
        `,
        )
        .eq('status', 'published')
        .eq('episodes.projects.account_id', data.accountId)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(data.limit);

      if (publishesError) {
        throw new Error(`Failed to fetch publishes: ${publishesError.message}`);
      }

      // Transform and combine activities
      const activities: Activity[] = [];

      // Add generation job activities
      if (jobs) {
        for (const job of jobs) {
          const projectName = safeGetNestedProperty<string>(
            job.projects,
            ['name'],
            'Unknown',
          );
          const isCompleted = job.status === 'completed';
          const jobTypeLabel = getJobTypeLabel(job.job_type);

          activities.push({
            id: job.id,
            type: isCompleted ? 'generation_completed' : 'generation_failed',
            description: isCompleted
              ? `${jobTypeLabel} generation completed`
              : `${jobTypeLabel} generation failed`,
            projectName,
            createdAt: job.completed_at || job.created_at,
          });
        }
      }

      // Add publish activities - SQL already filtered by account
      if (publishes) {
        for (const publish of publishes) {
          const projectName = safeGetNestedProperty<string>(
            publish.episodes,
            ['projects', 'name'],
            'Unknown',
          );

          activities.push({
            id: publish.id,
            type: 'published',
            description: `Published to ${publish.platform}`,
            projectName,
            createdAt: publish.published_at || publish.created_at,
          });
        }
      }

      // Sort by date and limit
      activities.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return activities.slice(0, data.limit);
    } catch (error) {
      console.error('Error fetching recent activity:', error);
      throw error;
    }
  },
  {
    schema: GetRecentActivitySchema,
  },
);

function getJobTypeLabel(jobType: string): string {
  const labels: Record<string, string> = {
    video: 'Video',
    voice: 'Voice',
    music: 'Music',
    sfx: 'Sound effect',
    story: 'Story',
    screenplay: 'Screenplay',
    shot_list: 'Shot list',
  };
  return labels[jobType] || jobType;
}
