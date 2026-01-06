'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BatchCreateShotsSchema,
  CreateShotSchema,
  DeleteShotSchema,
  ReorderShotsSchema,
  UpdateShotSchema,
} from '../../schemas/shot.schema';
import type {
  BatchCreateShotsResponse,
  DeleteShotResponse,
  ReorderShotsResponse,
  Shot,
} from '../../types';

/**
 * Creates a new shot for an episode
 * Auto-assigns sequence_number based on existing shots
 */
export const createShotAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'shots.create', episodeId: data.episodeId };

    logger.info(ctx, 'Creating shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot creation attempt');
      throw new Error('Authentication required');
    }

    // Get next sequence number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingShots } = await (client as any)
      .from('shots')
      .select('sequence_number')
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: false })
      .limit(1);

    const nextSequenceNumber = (existingShots?.[0]?.sequence_number ?? 0) + 1;

    // Insert shot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error } = await (client as any)
      .from('shots')
      .insert({
        episode_id: data.episodeId,
        scene_number: data.sceneNumber,
        shot_number: data.shotNumber,
        sequence_number: nextSequenceNumber,
        scene_description: data.description,
        prompt: data.prompt,
        duration_seconds: data.durationSeconds,
        camera_direction: data.cameraDirection ?? null,
        status: 'pending',
        generation_metadata: data.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create shot');
      throw new Error(`Failed to create shot: ${error.message}`);
    }

    logger.info({ ...ctx, shotId: shot.id }, 'Shot created');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, shot: shot as Shot };
  },
  { schema: CreateShotSchema },
);

/**
 * Creates multiple shots from a shot list in a single transaction
 * Used by shot list generation to create all shots atomically
 */
export const batchCreateShotsAction = enhanceAction(
  async (data): Promise<BatchCreateShotsResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'shots.batchCreate',
      episodeId: data.episodeId,
      shotCount: data.shots.length,
    };

    logger.info(ctx, 'Batch creating shots');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized batch shot creation attempt');
      throw new Error('Authentication required');
    }

    // Verify user has access to episode (RLS will handle this)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    // Get next sequence number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingShots } = await (client as any)
      .from('shots')
      .select('sequence_number')
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: false })
      .limit(1);

    const nextSequenceNumber = (existingShots?.[0]?.sequence_number ?? 0) + 1;

    // Prepare batch insert
    const shotsToInsert = data.shots.map((shot, index) => ({
      episode_id: data.episodeId,
      scene_number: shot.sceneNumber,
      shot_number: shot.shotNumber,
      sequence_number: nextSequenceNumber + index,
      scene_description: shot.description,
      prompt: shot.prompt,
      duration_seconds: shot.durationSeconds,
      camera_direction: shot.cameraDirection ?? null,
      status: 'pending',
      generation_metadata: {
        characters: shot.characters ?? [],
        ...shot.metadata,
      },
    }));

    // Insert all shots atomically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shots, error } = await (client as any)
      .from('shots')
      .insert(shotsToInsert)
      .select();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to batch create shots');
      throw new Error(`Failed to create shots: ${error.message}`);
    }

    logger.info(
      { ...ctx, createdCount: shots?.length ?? 0 },
      'Shots batch created',
    );
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      shots: (shots ?? []) as Shot[],
      count: shots?.length ?? 0,
    };
  },
  { schema: BatchCreateShotsSchema },
);

/**
 * Reorders shots by updating sequence_numbers
 * Validates all shots belong to the same episode
 */
export const reorderShotsAction = enhanceAction(
  async (data): Promise<ReorderShotsResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'shots.reorder',
      episodeId: data.episodeId,
      shotCount: data.shotIds.length,
    };

    logger.info(ctx, 'Reordering shots');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Verify all shots belong to the same episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shots, error: fetchError } = await (client as any)
      .from('shots')
      .select('id, episode_id')
      .in('id', data.shotIds)
      .is('deleted_at', null);

    if (fetchError) {
      throw new Error(`Failed to fetch shots: ${fetchError.message}`);
    }

    if (!shots || shots.length !== data.shotIds.length) {
      throw new Error('Some shots not found');
    }

    const episodeIds = [
      ...new Set(shots.map((s: { episode_id: string }) => s.episode_id)),
    ];
    if (episodeIds.length > 1 || episodeIds[0] !== data.episodeId) {
      throw new Error('All shots must belong to the same episode');
    }

    // Update sequence numbers
    const updatedShots = [];
    for (let index = 0; index < data.shotIds.length; index++) {
      const shotId = data.shotIds[index];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: shot, error } = await (client as any)
        .from('shots')
        .update({
          sequence_number: index + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shotId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update shot ${shotId}: ${error.message}`);
      }

      updatedShots.push(shot);
    }

    logger.info(ctx, 'Shots reordered');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      shots: updatedShots as Shot[],
      count: updatedShots.length,
    };
  },
  { schema: ReorderShotsSchema },
);

/**
 * Updates an existing shot
 * Only updates provided fields
 */
export const updateShotAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'shots.update', shotId: data.shotId };

    logger.info(ctx, 'Updating shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot update attempt');
      throw new Error('Authentication required');
    }

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.description !== undefined)
      updates.scene_description = data.description;
    if (data.prompt !== undefined) updates.prompt = data.prompt;
    if (data.durationSeconds !== undefined) {
      updates.duration_seconds = data.durationSeconds;
    }
    if (data.cameraDirection !== undefined) {
      updates.camera_direction = data.cameraDirection;
    }
    if (data.status !== undefined) updates.status = data.status;
    if (data.videoUrl !== undefined) updates.video_url = data.videoUrl;
    if (data.thumbnailUrl !== undefined) {
      updates.thumbnail_url = data.thumbnailUrl;
    }
    if (data.firstFrameUrl !== undefined) {
      updates.first_frame_url = data.firstFrameUrl;
    }
    if (data.lastFrameUrl !== undefined) {
      updates.last_frame_url = data.lastFrameUrl;
    }
    if (data.metadata !== undefined)
      updates.generation_metadata = data.metadata;

    // Video clip trimming fields (Phase 1: Video Clip Trimming)
    if (data.trimInPoint !== undefined) updates.trim_in_point = data.trimInPoint;
    if (data.trimOutPoint !== undefined) updates.trim_out_point = data.trimOutPoint;
    if (data.sourceDuration !== undefined) updates.source_duration = data.sourceDuration;

    // Timeline positioning
    if (data.timelineStartSeconds !== undefined) {
      updates.timeline_start_seconds = data.timelineStartSeconds;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error } = await (client as any)
      .from('shots')
      .update(updates)
      .eq('id', data.shotId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update shot');
      throw new Error(`Failed to update shot: ${error.message}`);
    }

    if (!shot) {
      throw new Error('Shot not found');
    }

    logger.info(ctx, 'Shot updated');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, shot: shot as Shot };
  },
  { schema: UpdateShotSchema },
);

/**
 * Soft deletes a shot and reorders remaining shots to close the gap
 * Cancels any in-progress generation job
 */
export const deleteShotAction = enhanceAction(
  async (data): Promise<DeleteShotResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'shots.delete', shotId: data.shotId };

    logger.info(ctx, 'Deleting shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot deletion attempt');
      throw new Error('Authentication required');
    }

    // Get shot to find its episode and sequence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error: fetchError } = await (client as any)
      .from('shots')
      .select('episode_id, sequence_number, generation_job_id')
      .eq('id', data.shotId)
      .is('deleted_at', null)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch shot: ${fetchError.message}`);
    }

    if (!shot) {
      throw new Error('Shot not found');
    }

    // Cancel generation job if exists and in progress
    if (shot.generation_job_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: job } = await (client as any)
        .from('generation_jobs')
        .select('status')
        .eq('id', shot.generation_job_id)
        .single();

      if (job && ['pending', 'processing'].includes(job.status)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({ status: 'cancelled' })
          .eq('id', shot.generation_job_id);
      }
    }

    const now = new Date().toISOString();

    // Soft delete shot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (client as any)
      .from('shots')
      .update({ deleted_at: now })
      .eq('id', data.shotId);

    if (deleteError) {
      logger.error({ ...ctx, error: deleteError }, 'Failed to delete shot');
      throw new Error(`Failed to delete shot: ${deleteError.message}`);
    }

    // Reorder remaining shots to close gap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: remainingShots } = await (client as any)
      .from('shots')
      .select('id, sequence_number')
      .eq('episode_id', shot.episode_id)
      .gt('sequence_number', shot.sequence_number)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: true });

    if (remainingShots && remainingShots.length > 0) {
      for (const remainingShot of remainingShots) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('shots')
          .update({
            sequence_number: remainingShot.sequence_number - 1,
            updated_at: now,
          })
          .eq('id', remainingShot.id);
      }
    }

    logger.info(ctx, 'Shot deleted');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      shotId: data.shotId,
    };
  },
  { schema: DeleteShotSchema },
);
