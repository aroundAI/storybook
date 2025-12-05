'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateEpisodeSchema,
  CreateShotSchema,
  UpdateEpisodeSchema,
  UpdateShotSchema,
} from '../lib/schemas';

// Note: These actions assume the episodes and shots tables exist in the database.
// The tables will be created as part of the database migration in FILM-101.

export const createEpisodeAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

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
      throw error;
    }

    return { episode };
  },
  {
    schema: CreateEpisodeSchema,
  },
);

export const updateEpisodeAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

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
      throw error;
    }

    return { episode };
  },
  {
    schema: UpdateEpisodeSchema,
  },
);

export const deleteEpisodeAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('episodes')
      .delete()
      .eq('id', data.id);

    if (error) {
      throw error;
    }

    return { success: true };
  },
  {
    schema: UpdateEpisodeSchema.pick({ id: true }),
  },
);

export const createShotAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

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
      throw error;
    }

    return { shot };
  },
  {
    schema: CreateShotSchema,
  },
);

export const updateShotAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

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
      throw error;
    }

    return { shot };
  },
  {
    schema: UpdateShotSchema,
  },
);

export const deleteShotAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('shots')
      .delete()
      .eq('id', data.id);

    if (error) {
      throw error;
    }

    return { success: true };
  },
  {
    schema: UpdateShotSchema.pick({ id: true }),
  },
);
