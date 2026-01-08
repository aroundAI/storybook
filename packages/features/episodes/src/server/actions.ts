'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateEpisodeSchema,
  DeleteEpisodeSchema,
  GetEpisodeSchema,
  ListProjectEpisodesSchema,
  UpdateEpisodeSchema,
  UpdateEpisodeStatusSchema,
} from '../lib/schemas';
import { generateEpisodeSlug } from '../lib/slug-utils';
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
      let episodeNumber: number;
      if (data.number) {
        episodeNumber = data.number;
      } else {
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

      // Generate slug from episode number and title
      const slug = generateEpisodeSlug(episodeNumber, data.title);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedEpisode, error } = await (client as any)
        .from('episodes')
        .insert({
          project_id: data.projectId,
          season_id: data.seasonId ?? null,
          number: episodeNumber,
          title: data.title,
          slug,
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
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url, final_video_url,
        localized_videos, localized_shorts, story_data, screenplay_data, shot_list,
        metadata, version, created_at, updated_at, deleted_at,
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
      .select(`
        id, episode_id, scene_number, shot_number, sequence_number,
        duration_seconds, scene_description, action_description,
        prompt, camera_direction, status, video_url, thumbnail_url,
        first_frame_url, last_frame_url, generation_job_id, generation_metadata,
        created_at, updated_at, deleted_at
      `)
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (shotsError) {
      logger.error({ ...ctx, error: shotsError }, 'Failed to fetch shots');
      throw new Error('Failed to fetch episode shots');
    }

    logger.info(ctx, 'Episode fetched with shots');

    // Transform snake_case database fields to camelCase TypeScript properties
    const transformedEpisode: EpisodeWithShots = {
      id: episode.id,
      slug: episode.slug,
      projectId: episode.project_id,
      seasonId: episode.season_id,
      number: episode.number,
      title: episode.title,
      description: episode.description,
      status: episode.status,
      durationSeconds: episode.duration_seconds,
      thumbnailUrl: episode.thumbnail_url,
      finalVideoUrl: episode.final_video_url,
      localizedVideos: episode.localized_videos ?? null,
      localizedShorts: episode.localized_shorts ?? null,
      storyData: episode.story_data,
      screenplayData: episode.screenplay_data,
      shotList: episode.shot_list,
      metadata: episode.metadata,
      version: episode.version,
      createdAt: episode.created_at,
      updatedAt: episode.updated_at,
      deletedAt: episode.deleted_at,
      shots: (shots ?? []).map((shot: Record<string, unknown>) => ({
        id: shot.id,
        episodeId: shot.episode_id,
        sceneNumber: shot.scene_number,
        shotNumber: shot.shot_number,
        sequenceNumber: shot.sequence_number,
        durationSeconds: shot.duration_seconds,
        sceneDescription: shot.scene_description,
        actionDescription: shot.action_description,
        prompt: shot.prompt,
        cameraDirection: shot.camera_direction,
        status: shot.status,
        videoUrl: shot.video_url,
        thumbnailUrl: shot.thumbnail_url,
        firstFrameUrl: shot.first_frame_url,
        lastFrameUrl: shot.last_frame_url,
        generationJobId: shot.generation_job_id,
        generationMetadata: shot.generation_metadata,
        createdAt: shot.created_at,
        updatedAt: shot.updated_at,
        deletedAt: shot.deleted_at,
      })),
      season: episode.season?.[0] ?? null,
    };

    return {
      success: true,
      data: transformedEpisode,
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
      .select(`
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `)
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
      .select(`
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url, final_video_url,
        localized_videos, story_data, screenplay_data, shot_list,
        metadata, version, created_at, updated_at, deleted_at
      `, { count: 'exact' })
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
      .select(`
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `)
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
      .select(`
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `)
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

// Shot CRUD actions have been moved to lib/server/mutations/shot-actions.ts (FILM-303)
// Shot list generation has been moved to lib/server/mutations/shot-list-actions.ts (FILM-307)
