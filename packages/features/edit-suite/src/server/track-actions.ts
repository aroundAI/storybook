'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateTrackSchema,
  DeleteTrackSchema,
  UpdateTrackSchema,
} from '../lib/schemas';
import { mapEditTrackRow } from '../lib/types';
import { getEditSuiteClient } from './db-client';

/**
 * Create a new track in an edit project.
 */
export const createTrackAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'editSuite.createTrack',
      editProjectId: data.editProjectId,
    };

    logger.info(ctx, 'Creating track');

    const authClient = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(authClient);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const client = getEditSuiteClient();

    const { data: track, error } = await client
      .from('edit_tracks')
      .insert({
        edit_project_id: data.editProjectId,
        type: data.type,
        name: data.name,
        sort_order: data.sortOrder,
        volume: data.volume,
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create track');
      throw new Error(`Failed to create track: ${error.message}`);
    }

    logger.info({ ...ctx, trackId: track.id }, 'Track created');
    revalidatePath(
      '/home/[account]/studio/[projectId]/episodes/[episodeId]',
      'page',
    );

    return { success: true, track: mapEditTrackRow(track) };
  },
  { schema: CreateTrackSchema },
);

/**
 * Update track properties (name, volume, mute, solo, locked, height, order).
 */
export const updateTrackAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'editSuite.updateTrack', trackId: data.trackId };

    logger.info(ctx, 'Updating track');

    const authClient = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(authClient);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const client = getEditSuiteClient();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.sortOrder !== undefined) updates.sort_order = data.sortOrder;
    if (data.volume !== undefined) updates.volume = data.volume;
    if (data.isMuted !== undefined) updates.is_muted = data.isMuted;
    if (data.isSolo !== undefined) updates.is_solo = data.isSolo;
    if (data.isLocked !== undefined) updates.is_locked = data.isLocked;
    if (data.height !== undefined) updates.height = data.height;

    const { data: track, error } = await client
      .from('edit_tracks')
      .update(updates)
      .eq('id', data.trackId)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update track');
      throw new Error(`Failed to update track: ${error.message}`);
    }

    logger.info(ctx, 'Track updated');

    return { success: true, track: mapEditTrackRow(track) };
  },
  { schema: UpdateTrackSchema },
);

/**
 * Delete a track (cascades clips and keyframes via ON DELETE CASCADE).
 */
export const deleteTrackAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'editSuite.deleteTrack', trackId: data.trackId };

    logger.info(ctx, 'Deleting track');

    const authClient = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(authClient);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const client = getEditSuiteClient();

    const { error } = await client
      .from('edit_tracks')
      .delete()
      .eq('id', data.trackId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete track');
      throw new Error(`Failed to delete track: ${error.message}`);
    }

    logger.info(ctx, 'Track deleted');
    revalidatePath(
      '/home/[account]/studio/[projectId]/episodes/[episodeId]',
      'page',
    );

    return { success: true, trackId: data.trackId };
  },
  { schema: DeleteTrackSchema },
);
