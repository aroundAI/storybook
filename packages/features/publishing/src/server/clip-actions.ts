'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GenerateClipSchema } from '../lib/schemas/clip.schema';
import type { GeneratedClip } from '../lib/types';

/**
 * Generate a clip from a video
 * Creates a generation job and processes the clip
 */
export const generateClipAction = enhanceAction(
  async (
    {
      episodeId,
      videoUrl,
      startTime,
      endTime,
      title,
      cropSettings,
      aspectRatio,
    },
    _user,
  ) => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.generateClip',
      episodeId,
      startTime,
      endTime,
      aspectRatio,
    };

    logger.info(ctx, 'Starting clip generation');

    const client = getSupabaseServerClient();

    // Get episode to find project and account
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('project_id, projects(account_id)')
      .eq('id', episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    const project = episode.projects as { account_id: string } | null;
    if (!project) {
      throw new Error('Project not found');
    }

    // Generate idempotency key
    const idempotencyKey = `clip-${episodeId}-${startTime}-${endTime}-${Date.now()}`;

    // Create generation job record
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .insert({
        idempotency_key: idempotencyKey,
        account_id: project.account_id,
        project_id: episode.project_id,
        job_type: 'video',
        reference_type: 'episode',
        reference_id: episodeId,
        status: 'processing',
        input_data: {
          type: 'clip',
          videoUrl,
          startTime,
          endTime,
          title,
          cropSettings,
          aspectRatio,
        },
      })
      .select()
      .single();

    if (jobError || !job) {
      logger.error(
        { ...ctx, error: jobError },
        'Failed to create generation job',
      );
      throw new Error('Failed to create clip generation job');
    }

    logger.info({ ...ctx, jobId: job.id }, 'Created generation job');

    try {
      // Process the clip
      // In production, this would call FFmpeg or a video processing service
      const processedClip = await processClip({
        videoUrl,
        startTime,
        endTime,
        cropSettings,
        aspectRatio,
      });

      // Generate thumbnail from first frame
      const thumbnailUrl = await generateClipThumbnail(processedClip.clipUrl);

      // Update job with success
      await client
        .from('generation_jobs')
        .update({
          status: 'completed',
          output_data: {
            clipUrl: processedClip.clipUrl,
            thumbnailUrl,
            duration: endTime - startTime,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      logger.info(
        { ...ctx, jobId: job.id, clipUrl: processedClip.clipUrl },
        'Clip generation completed',
      );

      const result: GeneratedClip = {
        id: job.id,
        clipUrl: processedClip.clipUrl,
        thumbnailUrl,
        duration: endTime - startTime,
        title,
        aspectRatio,
      };

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update job with failure
      await client
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message: errorMessage,
        })
        .eq('id', job.id);

      logger.error(
        { ...ctx, jobId: job.id, error: errorMessage },
        'Clip generation failed',
      );
      throw error;
    }
  },
  {
    schema: GenerateClipSchema,
    auth: true,
  },
);

/**
 * Process clip using FFmpeg or cloud video service
 * This is a placeholder - in production would call actual processing service
 */
async function processClip(options: {
  videoUrl: string;
  startTime: number;
  endTime: number;
  cropSettings: {
    type: string;
    x: number;
    y: number;
    scale: number;
  };
  aspectRatio: string;
}): Promise<{ clipUrl: string }> {
  // In production, this would:
  // 1. Download the source video
  // 2. Use FFmpeg to extract and crop the clip
  // 3. Upload to storage and return URL
  //
  // Example FFmpeg command:
  // ffmpeg -i input.mp4 -ss {startTime} -to {endTime} \
  //   -vf "crop=ih*9/16:ih:iw*{cropX}-(ih*9/16/2):0,scale=1080:1920" \
  //   -c:a copy output.mp4

  // For now, return a placeholder URL with parameters
  const params = new URLSearchParams({
    start: options.startTime.toString(),
    end: options.endTime.toString(),
    crop: options.cropSettings.type,
    aspect: options.aspectRatio,
  });

  return {
    clipUrl: `${options.videoUrl}?clip=true&${params.toString()}`,
  };
}

/**
 * Generate thumbnail from clip
 * In production would extract first frame
 */
async function generateClipThumbnail(clipUrl: string): Promise<string> {
  // In production, this would extract a frame from the clip
  // For now, return a modified URL
  return clipUrl.replace(/\.(mp4|webm|mov)/, '_thumb.jpg');
}

/**
 * Get clips for an episode
 */
export async function getEpisodeClips(episodeId: string) {
  const client = getSupabaseServerClient();

  const { data: jobs, error } = await client
    .from('generation_jobs')
    .select(`
      id, job_type, account_id, project_id, reference_type, reference_id, status,
      input_data, output_data, error_message, created_at, completed_at
    `)
    .eq('reference_type', 'episode')
    .eq('reference_id', episodeId)
    .eq('status', 'completed')
    .contains('input_data', { type: 'clip' })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch clips: ${error.message}`);
  }

  return (jobs ?? []).map((job) => {
    const input = job.input_data as Record<string, unknown>;
    const output = job.output_data as Record<string, unknown>;

    return {
      id: job.id,
      clipUrl: output?.clipUrl as string,
      thumbnailUrl: output?.thumbnailUrl as string,
      duration: output?.duration as number,
      title: input?.title as string,
      aspectRatio: input?.aspectRatio as string,
      startTime: input?.startTime as number,
      endTime: input?.endTime as number,
    };
  });
}
