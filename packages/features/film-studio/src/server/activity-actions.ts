'use server';

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
 * Get recent activity across all projects for an account
 * Combines data from generation_jobs and publishes tables
 */
export const getRecentActivityAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // Get recent generation jobs (completed or failed)
    const { data: jobs } = await client
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

    // Get recent publishes
    const { data: publishes } = await client
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
          projects!inner(name)
        )
      `,
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(data.limit);

    // Transform and combine activities
    const activities: Activity[] = [];

    // Add generation job activities
    if (jobs) {
      for (const job of jobs) {
        const projectName =
          (job.projects as unknown as { name: string })?.name || 'Unknown';
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

    // Add publish activities
    if (publishes) {
      for (const publish of publishes) {
        const episode = publish.episodes as unknown as {
          title: string;
          projects: { name: string };
        };
        const projectName = episode?.projects?.name || 'Unknown';

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
