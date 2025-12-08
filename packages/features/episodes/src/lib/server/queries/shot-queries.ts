'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetEpisodeShotsSchema } from '../../schemas/shot.schema';
import type { GetEpisodeShotsResponse, ShotWithJobStatus } from '../../types';

/**
 * Fetches all shots for an episode with optional filtering
 * Includes generation job status if present
 */
export const getEpisodeShotsAction = enhanceAction(
  async (data): Promise<GetEpisodeShotsResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'shots.getForEpisode', episodeId: data.episodeId };

    logger.info(ctx, 'Fetching episode shots');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build query with generation job join
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('shots')
      .select(
        `
        *,
        generation_job:generation_jobs(
          id,
          status,
          provider,
          progress,
          error_message
        )
      `,
        { count: 'exact' },
      )
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);

    // Apply status filter if provided
    if (data.status) {
      query = query.eq('status', data.status);
    }

    const { data: shots, error, count } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch shots');
      throw new Error(`Failed to fetch shots: ${error.message}`);
    }

    // Transform to expected format
    const transformedShots: ShotWithJobStatus[] = (shots ?? []).map(
      (shot: Record<string, unknown>) => ({
        id: shot.id as string,
        episodeId: shot.episode_id as string,
        sceneNumber: shot.scene_number as number,
        shotNumber: shot.shot_number as number,
        sequenceNumber: shot.sequence_number as number,
        description: shot.description as string,
        prompt: shot.prompt as string | null,
        durationSeconds: shot.duration as number,
        status: shot.status as
          | 'pending'
          | 'generating'
          | 'completed'
          | 'failed',
        cameraDirection: shot.camera_direction as string | null,
        videoUrl: shot.video_url as string | null,
        thumbnailUrl: shot.thumbnail_url as string | null,
        generationJobId: shot.generation_job_id as string | null,
        metadata: shot.metadata as Record<string, unknown>,
        createdAt: shot.created_at as string,
        updatedAt: shot.updated_at as string,
        deletedAt: shot.deleted_at as string | null,
        generationJob: shot.generation_job
          ? Array.isArray(shot.generation_job)
            ? (shot.generation_job[0] ?? null)
            : shot.generation_job
          : null,
      }),
    );

    logger.info(
      { ...ctx, shotCount: transformedShots.length },
      'Episode shots fetched',
    );

    return {
      success: true,
      shots: transformedShots,
      total: count ?? 0,
      hasMore: (count ?? 0) > data.offset + data.limit,
    };
  },
  { schema: GetEpisodeShotsSchema },
);
