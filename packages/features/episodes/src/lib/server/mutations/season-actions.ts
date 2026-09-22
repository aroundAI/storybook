'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateSeasonSchema,
  DeleteSeasonSchema,
  GetProjectSeasonsSchema,
  UpdateSeasonSchema,
} from '../../schemas/season.schema';
import type {
  DeleteSeasonResponse,
  GetProjectSeasonsResponse,
  Season,
  SeasonWithEpisodeCount,
} from '../../types';

/**
 * Creates a new season for a project
 * - Auto-assigns season number if not provided
 * - Prevents duplicate season numbers within same project
 * - Creates audit log entry
 */
export const createSeasonAction = enhanceAction(
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

    // Auto-assign season number with retry logic for race conditions
    const MAX_RETRIES = 3;
    let season;
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let seasonNumber = data.number;
      if (!seasonNumber) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingSeasons } = await (client as any)
          .from('seasons')
          .select('number')
          .eq('project_id', data.projectId)
          .is('deleted_at', null)
          .order('number', { ascending: false })
          .limit(1);

        seasonNumber = (existingSeasons?.[0]?.number ?? 0) + 1;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedSeason, error } = await (client as any)
        .from('seasons')
        .insert({
          project_id: data.projectId,
          number: seasonNumber,
          name: data.name,
          description: data.description ?? null,
          direction_notes: data.directionNotes ?? null,
        })
        .select()
        .single();

      if (!error) {
        season = insertedSeason;
        break;
      }

      // Check if it's a unique constraint violation (race condition)
      const isUniqueViolation =
        error.code === '23505' || error.message?.includes('unique');

      if (isUniqueViolation && !data.number && attempt < MAX_RETRIES - 1) {
        // Retry with a new auto-assigned number
        logger.warn(
          { ...ctx, attempt, error },
          'Season number conflict, retrying',
        );
        continue;
      }

      lastError = error;
      break;
    }

    if (!season) {
      logger.error({ ...ctx, error: lastError }, 'Failed to create season');
      throw new Error(
        `Failed to create season: ${lastError?.message ?? 'Unknown error'}`,
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

    // Fetch seasons first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: seasons, error } = await (client as any)
      .from('seasons')
      .select(
        `
        id, project_id, number, name, description, direction_notes,
        created_at, updated_at, deleted_at
      `,
      )
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch seasons');
      throw new Error('Failed to fetch seasons');
    }

    // Fetch episode counts separately, excluding soft-deleted episodes
    const seasonIds = (seasons ?? []).map((s: Season) => s.id);
    const episodeCounts: Record<string, number> = {};

    if (seasonIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: counts, error: countError } = await (client as any)
        .from('episodes')
        .select('season_id')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

      if (!countError && counts) {
        for (const episode of counts) {
          if (episode.season_id) {
            episodeCounts[episode.season_id] =
              (episodeCounts[episode.season_id] ?? 0) + 1;
          }
        }
      }
    }

    // Transform response to include episode count from our separate query
    const seasonsWithCount: SeasonWithEpisodeCount[] = (seasons ?? []).map(
      (season: Season) => ({
        ...season,
        episodeCount: episodeCounts[season.id] ?? 0,
      }),
    );

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentSeason, error: fetchError } = await (client as any)
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
      .single();

    if (fetchError || !currentSeason) {
      throw new ActionRefusal('Season not found');
    }

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.directionNotes !== undefined)
      updates.direction_notes = data.directionNotes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: season, error: updateError } = await (client as any)
      .from('seasons')
      .update(updates)
      .eq('id', data.seasonId)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update season');
      throw new Error('Failed to update season');
    }

    if (!season) {
      throw new ActionRefusal('Season not found');
    }

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
export const deleteSeasonAction = enhanceAction(
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
        throw new Error('Season not found');
      }

      const now = new Date().toISOString();

      // Soft delete season
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: seasonError } = await (client as any)
        .from('seasons')
        .update({ deleted_at: now })
        .eq('id', data.seasonId)
        .is('deleted_at', null);

      if (seasonError) {
        logger.error(
          { ...ctx, error: seasonError },
          'Failed to soft-delete season',
        );
        throw new Error('Failed to delete season');
      }

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
