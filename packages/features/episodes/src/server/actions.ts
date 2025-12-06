'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateEpisodeSchema,
  CreateShotSchema,
  UpdateEpisodeSchema,
  UpdateShotSchema,
} from '../lib/schemas';

// Note: These actions use type assertions because the internal type definitions
// differ from the generated database types. The database schema will be aligned
// in a future update. RLS policies enforce project-level authorization.

export const createEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.create', projectId: data.projectId };

    logger.info(ctx, 'Creating episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode creation attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error } = await (client as any)
      .from('episodes')
      .insert({
        project_id: data.projectId,
        title: data.title,
        description: data.description,
        episode_number: data.episodeNumber,
        script: data.script,
        metadata: data.metadata,
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create episode');
      throw error;
    }

    logger.info({ ...ctx, episodeId: episode.id }, 'Episode created');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, episode };
  },
  {
    schema: CreateEpisodeSchema,
  },
);

export const updateEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.update', episodeId: data.id };

    logger.info(ctx, 'Updating episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode update attempt');
      throw new Error('Authentication required');
    }

    const updateData: Record<string, unknown> = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.episodeNumber !== undefined)
      updateData.episode_number = data.episodeNumber;
    if (data.script !== undefined) updateData.script = data.script;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.duration !== undefined) updateData.duration = data.duration;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error } = await (client as any)
      .from('episodes')
      .update(updateData)
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update episode');
      throw error;
    }

    logger.info(ctx, 'Episode updated');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, episode };
  },
  {
    schema: UpdateEpisodeSchema,
  },
);

export const deleteEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.delete', episodeId: data.id };

    logger.info(ctx, 'Deleting episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode deletion attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('episodes')
      .delete()
      .eq('id', data.id);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete episode');
      throw error;
    }

    logger.info(ctx, 'Episode deleted');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true };
  },
  {
    schema: UpdateEpisodeSchema.pick({ id: true }),
  },
);

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error } = await (client as any)
      .from('shots')
      .insert({
        episode_id: data.episodeId,
        scene_number: data.sceneNumber,
        shot_number: data.shotNumber,
        description: data.description,
        duration: data.duration,
        camera_angle: data.cameraAngle,
        camera_movement: data.cameraMovement,
        prompt: data.prompt,
        metadata: data.metadata,
        generation_settings: data.generationSettings,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create shot');
      throw error;
    }

    logger.info({ ...ctx, shotId: shot.id }, 'Shot created');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, shot };
  },
  {
    schema: CreateShotSchema,
  },
);

export const updateShotAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'shots.update', shotId: data.id };

    logger.info(ctx, 'Updating shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot update attempt');
      throw new Error('Authentication required');
    }

    const updateData: Record<string, unknown> = {};

    if (data.sceneNumber !== undefined)
      updateData.scene_number = data.sceneNumber;
    if (data.shotNumber !== undefined) updateData.shot_number = data.shotNumber;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.duration !== undefined) updateData.duration = data.duration;
    if (data.cameraAngle !== undefined)
      updateData.camera_angle = data.cameraAngle;
    if (data.cameraMovement !== undefined)
      updateData.camera_movement = data.cameraMovement;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.videoUrl !== undefined) updateData.video_url = data.videoUrl;
    if (data.thumbnailUrl !== undefined)
      updateData.thumbnail_url = data.thumbnailUrl;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.generationSettings !== undefined)
      updateData.generation_settings = data.generationSettings;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error } = await (client as any)
      .from('shots')
      .update(updateData)
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update shot');
      throw error;
    }

    logger.info(ctx, 'Shot updated');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, shot };
  },
  {
    schema: UpdateShotSchema,
  },
);

export const deleteShotAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'shots.delete', shotId: data.id };

    logger.info(ctx, 'Deleting shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot deletion attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('shots')
      .delete()
      .eq('id', data.id);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete shot');
      throw error;
    }

    logger.info(ctx, 'Shot deleted');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true };
  },
  {
    schema: UpdateShotSchema.pick({ id: true }),
  },
);
