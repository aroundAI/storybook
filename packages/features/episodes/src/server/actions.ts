'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateEpisodeSchema,
  CreateShotSchema,
  DeleteEpisodeSchema,
  GetEpisodeSchema,
  ListProjectEpisodesSchema,
  ReorderShotsSchema,
  UpdateEpisodeSchema,
  UpdateEpisodeStatusSchema,
  UpdateShotSchema,
} from '../lib/schemas';
import {
  InvalidStatusTransitionError,
  OptimisticLockError,
  isValidStatusTransition,
} from '../lib/status-workflow';
import type {
  Episode,
  EpisodeStatus,
  EpisodeWithShots,
  ListEpisodesResponse,
} from '../lib/types';

/**
 * Create a new episode
 * - Auto-assigns episode number if not provided
 * - Initializes in 'draft' status with version 1
 * - Creates audit log entry
 */
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

    // Auto-assign episode number with retry logic for race conditions
    // The database has a unique constraint (unique_episode_number_per_project)
    // so we retry if there's a conflict
    const MAX_RETRIES = 3;
    let episode;
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let episodeNumber = data.number;
      if (!episodeNumber) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingEpisodes } = await (client as any)
          .from('episodes')
          .select('number')
          .eq('project_id', data.projectId)
          .is('deleted_at', null)
          .order('number', { ascending: false })
          .limit(1);

        episodeNumber = (existingEpisodes?.[0]?.number ?? 0) + 1;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedEpisode, error } = await (client as any)
        .from('episodes')
        .insert({
          project_id: data.projectId,
          season_id: data.seasonId ?? null,
          number: episodeNumber,
          title: data.title,
          description: data.description ?? null,
          status: 'draft',
          metadata: {},
          version: 1,
        })
        .select()
        .single();

      if (!error) {
        episode = insertedEpisode;
        break;
      }

      // Check if it's a unique constraint violation (race condition)
      const isUniqueViolation =
        error.code === '23505' || error.message?.includes('unique');

      if (isUniqueViolation && !data.number && attempt < MAX_RETRIES - 1) {
        // Retry with a new auto-assigned number
        logger.warn(
          { ...ctx, attempt, error },
          'Episode number conflict, retrying',
        );
        continue;
      }

      lastError = error;
      break;
    }

    if (!episode) {
      logger.error({ ...ctx, error: lastError }, 'Failed to create episode');
      throw new Error(
        `Failed to create episode: ${lastError?.message ?? 'Unknown error'}`,
      );
    }

    // Get project for audit log scope
    const { data: project } = await client
      .from('projects')
      .select('account_id')
      .eq('id', data.projectId)
      .single();

    // Create audit log
    if (project) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'create',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        after: episode,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: data.projectId },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info({ ...ctx, episodeId: episode.id }, 'Episode created');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, data: episode as Episode };
  },
  {
    schema: CreateEpisodeSchema,
  },
);

/**
 * Get episode with all related shots and season info
 */
export const getEpisodeWithShotsAction = enhanceAction(
  async (data): Promise<{ success: true; data: EpisodeWithShots }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.getWithShots', episodeId: data.episodeId };

    logger.info(ctx, 'Fetching episode with shots');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch episode with season info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select(
        `
        *,
        season:seasons(id, name, number)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError) {
      logger.error({ ...ctx, error: episodeError }, 'Failed to fetch episode');
      throw new Error('Episode not found');
    }

    // Fetch related shots (excluding soft-deleted)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shots, error: shotsError } = await (client as any)
      .from('shots')
      .select('*')
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (shotsError) {
      logger.error({ ...ctx, error: shotsError }, 'Failed to fetch shots');
      throw new Error('Failed to fetch episode shots');
    }

    logger.info(ctx, 'Episode fetched with shots');

    return {
      success: true,
      data: {
        ...episode,
        shots: shots ?? [],
        season: episode.season?.[0] ?? null,
      } as EpisodeWithShots,
    };
  },
  {
    schema: GetEpisodeSchema,
  },
);

/**
 * Update episode status with workflow enforcement
 * - Validates status transition is allowed
 * - Uses optimistic locking to prevent conflicts
 * - Creates audit log entry
 */
export const updateEpisodeStatusAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.updateStatus', episodeId: data.episodeId };

    logger.info(ctx, 'Updating episode status');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch current episode state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentEpisode, error: fetchError } = await (client as any)
      .from('episodes')
      .select('*, project:projects(account_id)')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !currentEpisode) {
      throw new Error('Episode not found');
    }

    // Check version for optimistic locking
    if (currentEpisode.version !== data.version) {
      throw new OptimisticLockError('episode');
    }

    // Validate status transition
    if (
      !isValidStatusTransition(
        currentEpisode.status as EpisodeStatus,
        data.status,
      )
    ) {
      throw new InvalidStatusTransitionError(
        currentEpisode.status as EpisodeStatus,
        data.status,
      );
    }

    // Update status (version is auto-incremented by database trigger)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        status: data.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update episode status',
      );
      throw new Error('Failed to update episode status');
    }

    if (!episode) {
      throw new OptimisticLockError('episode');
    }

    // Create audit log
    const accountId = currentEpisode.project?.account_id;
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: currentEpisode,
        after: episode,
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info(
      { ...ctx, oldStatus: currentEpisode.status, newStatus: data.status },
      'Episode status updated',
    );
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, data: episode as Episode };
  },
  {
    schema: UpdateEpisodeStatusSchema,
  },
);

/**
 * List episodes for a project with filtering and pagination
 */
export const listProjectEpisodesAction = enhanceAction(
  async (data): Promise<{ success: true; data: ListEpisodesResponse }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.list', projectId: data.projectId };

    logger.info(ctx, 'Listing project episodes');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('episodes')
      .select('*', { count: 'exact' })
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);

    // Apply filters
    if (data.seasonId) {
      query = query.eq('season_id', data.seasonId);
    }

    if (data.status) {
      query = query.eq('status', data.status);
    }

    const { data: episodes, error, count } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to list episodes');
      throw new Error('Failed to list episodes');
    }

    logger.info({ ...ctx, count: episodes?.length ?? 0 }, 'Episodes listed');

    return {
      success: true,
      data: {
        episodes: (episodes ?? []) as Episode[],
        total: count ?? 0,
        hasMore: (count ?? 0) > data.offset + data.limit,
      },
    };
  },
  {
    schema: ListProjectEpisodesSchema,
  },
);

/**
 * Update episode with partial data
 * - Supports updating metadata, story_data, screenplay_data, shot_list
 * - Uses optimistic locking
 * - Creates audit log entry
 */
export const updateEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.update', episodeId: data.episodeId };

    logger.info(ctx, 'Updating episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode update attempt');
      throw new Error('Authentication required');
    }

    // Fetch current episode for audit log and version check
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentEpisode, error: fetchError } = await (client as any)
      .from('episodes')
      .select('*, project:projects(account_id)')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !currentEpisode) {
      throw new Error('Episode not found');
    }

    // Check version for optimistic locking
    if (currentEpisode.version !== data.version) {
      throw new OptimisticLockError('episode');
    }

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined) updates.description = data.description;
    if (data.storyData !== undefined)
      updates.story_data = data.storyData as Json;
    if (data.screenplayData !== undefined)
      updates.screenplay_data = data.screenplayData as Json;
    if (data.shotList !== undefined) updates.shot_list = data.shotList as Json;
    if (data.metadata !== undefined) updates.metadata = data.metadata as Json;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: updateError } = await (client as any)
      .from('episodes')
      .update(updates)
      .eq('id', data.episodeId)
      .eq('version', data.version)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update episode');
      throw new Error('Failed to update episode');
    }

    if (!episode) {
      throw new OptimisticLockError('episode');
    }

    // Create audit log
    const accountId = currentEpisode.project?.account_id;
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: currentEpisode,
        after: episode,
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, 'Episode updated');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, data: episode as Episode };
  },
  {
    schema: UpdateEpisodeSchema,
  },
);

/**
 * Soft delete episode and cascade to related shots
 * - Sets deleted_at timestamp instead of hard delete
 * - Cascades soft delete to all related shots
 * - Creates audit log entry
 */
export const deleteEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.delete', episodeId: data.episodeId };

    logger.info(ctx, 'Deleting episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode deletion attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode for audit log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select('*, project:projects(account_id)')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      throw new Error('Episode not found');
    }

    const now = new Date().toISOString();

    // Soft delete episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: episodeError } = await (client as any)
      .from('episodes')
      .update({ deleted_at: now })
      .eq('id', data.episodeId)
      .is('deleted_at', null);

    if (episodeError) {
      logger.error({ ...ctx, error: episodeError }, 'Failed to delete episode');
      throw new Error('Failed to delete episode');
    }

    // Hard delete related shots (shots table doesn't have deleted_at column)
    // TODO: Add deleted_at column to shots table in FILM-303 for soft delete consistency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: shotsError } = await (client as any)
      .from('shots')
      .delete()
      .eq('episode_id', data.episodeId);

    if (shotsError) {
      logger.error(
        { ...ctx, error: shotsError },
        'Failed to delete related shots',
      );
      // Don't throw - episode is already soft-deleted, log and continue
    }

    // Create audit log
    const accountId = episode.project?.account_id;
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'delete',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: episode,
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, 'Episode deleted');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, episodeId: data.episodeId };
  },
  {
    schema: DeleteEpisodeSchema,
  },
);

// ============================================================================
// Shot Actions (Out of scope for FILM-301, will be updated in FILM-303)
// ============================================================================

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

/**
 * Reorder shots by updating their sequence_number
 * Accepts an array of shot IDs in their new order
 */
export const reorderShotsAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'shots.reorder', episodeId: data.episodeId };

    logger.info(ctx, 'Reordering shots');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized shot reorder attempt');
      throw new Error('Authentication required');
    }

    // Verify all shots belong to this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingShots, error: fetchError } = await (client as any)
      .from('shots')
      .select('id')
      .eq('episode_id', data.episodeId);

    if (fetchError) {
      logger.error({ ...ctx, error: fetchError }, 'Failed to fetch shots');
      throw new Error('Failed to verify shots');
    }

    const existingIds = new Set(
      existingShots?.map((s: { id: string }) => s.id),
    );
    const invalidIds = data.shotIds.filter((id) => !existingIds.has(id));

    if (invalidIds.length > 0) {
      logger.warn(
        { ...ctx, invalidIds },
        'Invalid shot IDs in reorder request',
      );
      throw new Error('Some shots do not belong to this episode');
    }

    // Update sequence_number for each shot
    const updates = data.shotIds.map((id, index) => ({
      id,
      sequence_number: index + 1,
    }));

    // Batch update using individual updates (Supabase doesn't support bulk update with different values)
    for (const update of updates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (client as any)
        .from('shots')
        .update({ sequence_number: update.sequence_number })
        .eq('id', update.id);

      if (error) {
        logger.error(
          { ...ctx, shotId: update.id, error },
          'Failed to update shot sequence',
        );
        throw new Error('Failed to reorder shots');
      }
    }

    logger.info({ ...ctx, count: updates.length }, 'Shots reordered');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true };
  },
  {
    schema: ReorderShotsSchema,
  },
);
