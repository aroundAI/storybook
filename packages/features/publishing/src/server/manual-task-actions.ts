'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getLogger } from '@kit/shared/logger';

// --------------------------------------------------------
// Get Manual Tasks
// --------------------------------------------------------

const GetManualTasksSchema = z.object({
  accountId: z.string().uuid(),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']).optional(),
  taskType: z.enum(['mla_attachment', 'localized_thumbnail', 'end_screen', 'community_post', 'other']).optional(),
});

export const getManualTasksAction = enhanceAction(
  async (params) => {
    const logger = await getLogger();
    logger.info({ params }, 'Fetching manual tasks');

    const client = getSupabaseServerClient();

    let query = client
      .from('manual_tasks')
      .select('*')
      .eq('account_id', params.accountId)
      .order('created_at', { ascending: false });

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.taskType) {
      query = query.eq('task_type', params.taskType);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error }, 'Failed to fetch manual tasks');
      throw new Error('Failed to fetch manual tasks');
    }

    return data;
  },
  {
    schema: GetManualTasksSchema,
    auth: true,
  }
);

// --------------------------------------------------------
// Get Manual Task Counts
// --------------------------------------------------------

const GetManualTaskCountsSchema = z.object({
  accountId: z.string().uuid(),
});

export const getManualTaskCountsAction = enhanceAction(
  async (params) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('manual_tasks')
      .select('status')
      .eq('account_id', params.accountId);

    if (error) {
      logger.error({ error }, 'Failed to fetch manual task counts');
      throw new Error('Failed to fetch manual task counts');
    }

    const counts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      skipped: 0,
      blocked: 0,
    };

    data.forEach((task) => {
      const status = task.status as keyof typeof counts;
      if (counts[status] !== undefined) {
        counts[status]++;
      }
    });

    return counts;
  },
  {
    schema: GetManualTaskCountsSchema,
    auth: true,
  }
);

// --------------------------------------------------------
// Update Task Status
// --------------------------------------------------------

const UpdateManualTaskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']),
  notes: z.string().optional(),
});

export const updateManualTaskStatusAction = enhanceAction(
  async (params, user) => {
    const logger = await getLogger();
    logger.info({ params }, 'Updating manual task status');

    const client = getSupabaseServerClient();
    
    const updateData: any = {
      status: params.status,
      updated_at: new Date().toISOString(),
    };

    if (params.notes) {
      updateData.notes = params.notes;
    }

    if (params.status === 'in_progress') {
      updateData.started_at = new Date().toISOString();
      updateData.assigned_to = user.id;
    } else if (params.status === 'completed' || params.status === 'skipped') {
      updateData.completed_at = new Date().toISOString();
      updateData.completed_by = user.id;
    }

    const { data, error } = await client
      .from('manual_tasks')
      .update(updateData)
      .eq('id', params.taskId)
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to update manual task status');
      throw new Error('Failed to update manual task status');
    }

    return data;
  },
  {
    schema: UpdateManualTaskStatusSchema,
    auth: true,
  }
);

// --------------------------------------------------------
// Generate MLA Tasks
// --------------------------------------------------------

const GenerateMlaTasksSchema = z.object({
  publishId: z.string().uuid(),
  episodeId: z.string().uuid(),
});

export const generateMlaTasksAction = enhanceAction(
  async (params) => {
    const logger = await getLogger();
    logger.info({ params }, 'Generating MLA tasks');

    const client = getSupabaseServerClient();

    // 1. Get the publish record to get youtubeVideoId and account_id
    const { data: publishData, error: publishError } = await client
      .from('publishes')
      .select('*, episodes(account_id)') // wait, episodes might not have account_id directly, they have project_id. Let's join through project
      .eq('id', params.publishId)
      .single();

    if (publishError || !publishData) {
      logger.error({ error: publishError }, 'Failed to fetch publish data');
      throw new Error('Failed to fetch publish data');
    }

    const youtubeVideoId = publishData.platform_content_id;
    if (!youtubeVideoId) {
      logger.warn('No YouTube video ID found for publish', { publishId: params.publishId });
      return [];
    }

    // Get project and account details
    const { data: episodeData, error: episodeError } = await client
      .from('episodes')
      .select('title, project_id')
      .eq('id', params.episodeId)
      .single();
      
    if (episodeError || !episodeData) {
      logger.error({ error: episodeError }, 'Failed to fetch episode data');
      throw new Error('Failed to fetch episode data');
    }
    
    const { data: projectData, error: projectError } = await client
      .from('projects')
      .select('account_id')
      .eq('id', episodeData.project_id)
      .single();
      
    if (projectError || !projectData) {
      logger.error({ error: projectError }, 'Failed to fetch project data');
      throw new Error('Failed to fetch project data');
    }
    
    const accountId = projectData.account_id;

    // 2. Query dubbed_versions for the episode
    const { data: dubbedVersions, error: dubbedVersionsError } = await client
      .from('dubbed_versions')
      .select('*')
      .eq('episode_id', params.episodeId)
      .eq('status', 'ready')
      .not('final_video_url', 'is', null);

    if (dubbedVersionsError) {
      logger.error({ error: dubbedVersionsError }, 'Failed to fetch dubbed versions');
      throw new Error('Failed to fetch dubbed versions');
    }

    if (!dubbedVersions || dubbedVersions.length === 0) {
      logger.info('No ready dubbed versions found', { episodeId: params.episodeId });
      return [];
    }

    // 3. For each language track, create a manual_tasks record
    const tasksToInsert = dubbedVersions.map((dub) => {
      const languageMap: Record<string, string> = {
        en: 'English',
        es: 'Spanish',
        fr: 'French',
        de: 'German',
        it: 'Italian',
        pt: 'Portuguese',
        hi: 'Hindi',
        ja: 'Japanese',
        ko: 'Korean',
        zh: 'Chinese',
      };
      const languageLabel = languageMap[dub.language] || dub.language;

      return {
        account_id: accountId,
        publish_id: params.publishId,
        episode_id: params.episodeId,
        task_type: 'mla_attachment',
        priority: 'high',
        title: `Attach ${languageLabel} audio track to "${episodeData.title || publishData.title}"`,
        instructions: {
          videoTitle: episodeData.title || publishData.title,
          youtubeVideoId,
          youtubeStudioUrl: `https://studio.youtube.com/video/${youtubeVideoId}/edit`,
          language: dub.language,
          languageLabel,
          audioFileUrl: dub.final_video_url, // Assuming the final video URL contains the audio track we need
          steps: [
            `Download the ${languageLabel} audio file using the link below.`,
            `Click the "Open in YouTube Studio" button to go directly to this video's editor.`,
            `In YouTube Studio, go to the "Subtitles" or "Audio" tab.`,
            `Click "Add Language" and select "${languageLabel}".`,
            `Under "Audio", click "Add" and upload the downloaded file.`,
            `Save your changes in YouTube Studio.`,
            `Return here and mark this task as "Completed".`
          ],
        },
      };
    });

    const { data: insertedTasks, error: insertError } = await client
      .from('manual_tasks')
      .insert(tasksToInsert)
      .select();

    if (insertError) {
      logger.error({ error: insertError }, 'Failed to insert manual tasks');
      throw new Error('Failed to insert manual tasks');
    }

    return insertedTasks;
  },
  {
    schema: GenerateMlaTasksSchema,
    auth: true,
  }
);
