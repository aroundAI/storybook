'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  insertSeason,
  listSeasons,
  moveEpisodeToSeason,
  reorderSeasons,
  softDeleteSeason,
  updateSeasonRow,
} from '../../../server/season.service';
import {
  CreateSeasonSchema,
  DeleteSeasonKeepEpisodesSchema,
  DeleteSeasonSchema,
  GetProjectSeasonsSchema,
  MoveEpisodeToSeasonSchema,
  ReorderSeasonsSchema,
  UpdateSeasonSchema,
} from '../../schemas/season.schema';
import { OptimisticLockError } from '../../status-workflow';
import type {
  DeleteSeasonResponse,
  GetProjectSeasonsResponse,
  Season,
  SeasonWithEpisodeCount,
} from '../../types';

/**
 * Creates a new season for a project (numbering and retries: insertSeason)
 * - Creates audit log entry
 */
const createSeason = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.create', projectId: data.projectId };

    logger.info(ctx, 'Creating season');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized season creation attempt');
      throw new Error('Authentication required');
    }

    const inserted = await insertSeason(
      client,
      {
        projectId: data.projectId,
        number: data.number,
        name: data.name,
        description: data.description,
        directionNotes: data.directionNotes,
      },
      { warn: (detail, msg) => logger.warn({ ...ctx, detail }, msg) },
    ).catch((error) => {
      logger.error({ ...ctx, error }, 'Failed to create season');
      throw error;
    });

    if (!inserted.ok) {
      throw new ActionRefusal(inserted.refusal);
    }

    const season = inserted.data;

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
        objectType: 'season',
        objectId: season.id,
        objectName: season.name ?? `Season ${season.number}`,
        after: season,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: data.projectId },
          { type: 'season', id: season.id },
        ],
        ...networkContext,
      });
    }

    logger.info({ ...ctx, seasonId: season.id }, 'Season created');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return { success: true, data: season as Season };
  },
  {
    schema: CreateSeasonSchema,
  },
);

export const createSeasonAction = returnRefusals(createSeason);

/**
 * Fetches all seasons for a project with episode counts
 * Orders by season number
 * Excludes soft-deleted seasons
 */
export const getProjectSeasonsAction = enhanceAction(
  async (data): Promise<{ success: true; data: GetProjectSeasonsResponse }> => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.list', projectId: data.projectId };

    logger.info(ctx, 'Fetching project seasons');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const seasonsWithCount: SeasonWithEpisodeCount[] = await listSeasons(
      client,
      { projectId: data.projectId },
    ).catch((error) => {
      logger.error({ ...ctx, error }, 'Failed to fetch seasons');
      throw new Error('Failed to fetch seasons');
    });

    logger.info(
      { ...ctx, count: seasonsWithCount.length },
      'Seasons fetched successfully',
    );

    return {
      success: true,
      data: {
        seasons: seasonsWithCount,
      },
    };
  },
  {
    schema: GetProjectSeasonsSchema,
  },
);

/**
 * Updates an existing season with partial data
 * - Updates only provided fields
 * - Updates updated_at timestamp
 * - Creates audit log entry
 */
const updateSeason = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.update', seasonId: data.seasonId };

    logger.info(ctx, 'Updating season');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized season update attempt');
      throw new Error('Authentication required');
    }

    // Fetch current season for audit log
    const currentSeason = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('seasons')
        .select(
          `
        id, project_id, number, name, description, direction_notes,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `,
        )
        .eq('id', data.seasonId)
        .is('deleted_at', null)
        .single(),
      'Season not found',
    );

    let updated;

    try {
      updated = await updateSeasonRow(client, {
        seasonId: data.seasonId,
        version: data.version,
        name: data.name,
        description: data.description,
        directionNotes: data.directionNotes,
      });
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new ActionRefusal(error.message);
      }

      logger.error({ ...ctx, error }, 'Failed to update season');
      throw new Error('Failed to update season');
    }

    if (!updated.ok) {
      throw new ActionRefusal(updated.refusal);
    }

    const season = updated.data;

    // Create audit log
    const accountId = currentSeason.project?.account_id;
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'season',
        objectId: season.id,
        objectName: season.name ?? `Season ${season.number}`,
        before: currentSeason,
        after: season,
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: season.project_id },
          { type: 'season', id: season.id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, 'Season updated');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return { success: true, data: season as Season };
  },
  {
    schema: UpdateSeasonSchema,
  },
);

export const updateSeasonAction = returnRefusals(updateSeason);

/**
 * Soft deletes a season
 * - Sets deleted_at timestamp
 * - Sets season_id to NULL for all episodes in the season
 * - Creates audit log entry
 */
const deleteSeason = enhanceAction(
  async (data): Promise<DeleteSeasonResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.delete', seasonId: data.seasonId };

    logger.info(ctx, 'Deleting season');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized season deletion attempt');
      throw new Error('Authentication required');
    }

    try {
      // Fetch season for audit log
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: season, error: fetchError } = await (client as any)
        .from('seasons')
        .select(
          `
          id, project_id, number, name, description,
          created_at, updated_at, deleted_at,
          project:projects(account_id)
        `,
        )
        .eq('id', data.seasonId)
        .is('deleted_at', null)
        .single();

      if (fetchError || !season) {
        logger.error({ ...ctx, error: fetchError }, 'Season not found');
        throw new Error(whyNoRow(fetchError, 'Season not found'));
      }

      const now = new Date().toISOString();

      // Soft delete season
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: deletedSeason, error: seasonError } = await (client as any)
        .from('seasons')
        .update({ deleted_at: now })
        .eq('id', data.seasonId)
        .is('deleted_at', null)
        .select('id');

      if (seasonError) {
        logger.error(
          { ...ctx, error: seasonError },
          'Failed to soft-delete season',
        );
        throw new Error('Failed to delete season');
      }

      // RLS filters a refused update to no rows, without an error (KB-61).
      // Before the cascade: a refused season keeps its episodes.
      requireAffectedRows(
        deletedSeason,
        "The season wasn't deleted: it's already gone, or you can't delete it. Reload the page.",
      );

      // Cascade soft-delete all episodes in this season
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: episodesInSeason } = await (client as any)
        .from('episodes')
        .select('id')
        .eq('season_id', data.seasonId)
        .is('deleted_at', null);

      const episodeIds = (episodesInSeason ?? []).map(
        (e: { id: string }) => e.id,
      );

      if (episodeIds.length > 0) {
        // Soft-delete shots for all episodes in this season
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: shotsError } = await (client as any)
          .from('shots')
          .update({ deleted_at: now })
          .in('episode_id', episodeIds)
          .is('deleted_at', null);

        if (shotsError) {
          logger.error(
            { ...ctx, error: shotsError },
            'Failed to delete shots for season episodes',
          );
        }

        // Soft-delete all episodes in this season
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: episodesError } = await (client as any)
          .from('episodes')
          .update({ deleted_at: now })
          .eq('season_id', data.seasonId)
          .is('deleted_at', null);

        if (episodesError) {
          logger.error(
            { ...ctx, error: episodesError },
            'Failed to delete episodes in season',
          );
          throw new Error(
            'Failed to delete episodes in season. Please try again.',
          );
        }

        logger.info(
          { ...ctx, episodeCount: episodeIds.length },
          'Cascade deleted episodes and shots',
        );
      }

      // Create audit log (non-critical — don't let it break the delete)
      try {
        const accountId = season.project?.account_id;
        if (accountId) {
          const networkContext = await extractNetworkContext();

          await createAuditLog({
            accountId,
            userId: user.id,
            action: 'delete',
            objectType: 'season',
            objectId: season.id,
            objectName: season.name ?? `Season ${season.number}`,
            before: season,
            scopes: [
              { type: 'account', id: accountId },
              { type: 'project', id: season.project_id },
            ],
            ...networkContext,
          });
        }
      } catch (auditError) {
        logger.error(
          { ...ctx, error: auditError },
          'Failed to create audit log for season deletion (non-critical)',
        );
      }

      logger.info(ctx, 'Season deleted');
      revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

      return { success: true, seasonId: data.seasonId };
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        },
        'deleteSeasonAction failed',
      );
      throw error;
    }
  },
  {
    schema: DeleteSeasonSchema,
  },
);

export const deleteSeasonAction = returnRefusals(deleteSeason);

/**
 * FILM-2201: renumbers a project's seasons in the order given. Project owner
 * or admin (seasons_update); a list that leaves a season out or repeats one
 * is refused.
 */
const reorderSeasonsHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.reorder', projectId: data.projectId };
    const client = getSupabaseServerClient();

    const result = await reorderSeasons(client, data).catch((error) => {
      logger.error({ ...ctx, error }, 'Failed to reorder seasons');
      throw error;
    });

    if (!result.ok) {
      throw new ActionRefusal(result.refusal);
    }

    logger.info(ctx, 'Seasons reordered');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return { seasons: result.data as Season[] };
  },
  { schema: ReorderSeasonsSchema },
);

export const reorderSeasonsAction = returnRefusals(reorderSeasonsHandler);

/**
 * FILM-2201: deletes a season and moves its episodes to Unsorted. Nothing of
 * the episodes is deleted ("Delete Season & Episodes" stays deleteSeasonAction).
 */
const deleteSeasonKeepEpisodes = enhanceAction(
  async (data, user) => {
    const logger = await getLogger();
    const ctx = { name: 'seasons.deleteKeepEpisodes', seasonId: data.seasonId };
    const client = getSupabaseServerClient();

    const { data: season } = await client
      .from('seasons')
      .select('id, project_id, number, name, project:projects(account_id)')
      .eq('id', data.seasonId)
      .is('deleted_at', null)
      .maybeSingle();

    let result;

    try {
      result = await softDeleteSeason(client, data);
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new ActionRefusal(error.message);
      }

      logger.error({ ...ctx, error }, 'Failed to delete season');
      throw error;
    }

    if (!result.ok) {
      throw new ActionRefusal(result.refusal);
    }

    const accountId = season?.project?.account_id;

    if (season && accountId) {
      try {
        await createAuditLog({
          accountId,
          userId: user.id,
          action: 'delete',
          objectType: 'season',
          objectId: season.id,
          objectName: season.name ?? `Season ${season.number}`,
          before: season,
          scopes: [
            { type: 'account', id: accountId },
            { type: 'project', id: season.project_id },
          ],
          ...(await extractNetworkContext()),
        });
      } catch (auditError) {
        logger.error(
          { ...ctx, error: auditError },
          'Failed to create audit log for season deletion (non-critical)',
        );
      }
    }

    logger.info(
      { ...ctx, episodesMoved: result.data.episodesMoved },
      'Season deleted, episodes kept',
    );
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return result.data;
  },
  { schema: DeleteSeasonKeepEpisodesSchema },
);

export const deleteSeasonKeepEpisodesAction = returnRefusals(
  deleteSeasonKeepEpisodes,
);

/** FILM-2201: moves an episode into a season of its project, or to Unsorted. */
const moveEpisodeToSeasonHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.moveToSeason', episodeId: data.episodeId };
    const client = getSupabaseServerClient();

    let result;

    try {
      result = await moveEpisodeToSeason(client, data);
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new ActionRefusal(error.message);
      }

      logger.error({ ...ctx, error }, 'Failed to move episode');
      throw error;
    }

    if (!result.ok) {
      throw new ActionRefusal(result.refusal);
    }

    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return result.data;
  },
  { schema: MoveEpisodeToSeasonSchema },
);

export const moveEpisodeToSeasonAction = returnRefusals(
  moveEpisodeToSeasonHandler,
);
