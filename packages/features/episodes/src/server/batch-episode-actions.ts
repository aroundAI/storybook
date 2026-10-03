'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import {
  episodeRowFromOutline,
  episodeRowUpdateFromOutline,
} from '@kit/generation/episode-rows';
import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type BatchCreateEpisodesResponse,
  BatchCreateEpisodesSchema,
  DiscardGeneratedEpisodesSchema,
  type EpisodeOutline,
  type GenerateSeasonOutlineResponse,
  GenerateSeasonOutlineSchema,
  type RegenerateEpisodeOutlineResponse,
  RegenerateEpisodeOutlineSchema,
} from '../lib/schemas/batch-episode.schema';

/**
 * Generate season episode outlines via LLM (FILM-314)
 *
 * Uses the season-outline prompt template to generate 2-24 episode outlines
 * with proper story structure distribution.
 * In production, queues via SQS for background processing.
 */
const generateSeasonOutlineHandler = enhanceAction(
  async (
    data,
  ): Promise<{
    success: true;
    data?: GenerateSeasonOutlineResponse;
    queued?: boolean;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.generateSeasonOutline',
      projectId: data.projectId,
      seasonId: data.seasonId,
      episodeCount: data.episodeCount,
    };

    logger.info(ctx, 'Processing season outline request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized season outline generation attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'generateSeasonOutline', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    // Project write access, not a readable row: a public project's row is
    // readable by anyone signed in (KB-31)
    const target = await authorizeProjectTarget(client, data.projectId);

    if (!target) {
      throw new ActionRefusal('Project not found or access denied');
    }

    // Always queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    await queueLlmJob({
      jobType: 'season-outline',
      userId: user.id,
      target,
      payload: {
        projectId: data.projectId,
        seasonId: data.seasonId,
        seasonPremise: data.seasonPremise,
        episodeCount: data.episodeCount,
        startingNumber: data.startingNumber,
        genre: data.genre,
        style: data.style,
        userId: user.id,
      },
    });

    logger.info(ctx, 'Season outline job queued');
    return { success: true, queued: true };
  },
  { schema: GenerateSeasonOutlineSchema },
);

export const generateSeasonOutlineAction = returnRefusals(
  generateSeasonOutlineHandler,
);

/**
 * Batch create episodes from generated outlines (FILM-314)
 *
 * The season_outline stage's commit creates a row per outline when the
 * outlines are generated (FILM-1901), and returns each outline with its
 * row's id. An outline carrying an id updates that row with the preview's
 * edits; one without (an older client, or an outline added by hand) is
 * inserted with the next available number, as before.
 *
 * @throws {Error} If episode creation fails
 */
const batchCreateEpisodesHandler = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data: BatchCreateEpisodesResponse }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.batchCreate',
      projectId: data.projectId,
      seasonId: data.seasonId,
      episodeCount: data.episodes.length,
    };

    logger.info(ctx, 'Batch creating episodes');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized batch episode creation attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'batchCreateEpisodes', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    // Verify project access and get account ID
    const project = requireRow(
      await client
        .from('projects')
        .select('id, account_id')
        .eq('id', data.projectId)
        .single(),
      'Project not found or access denied',
    );

    const accountId = project.account_id;

    type CreatedEpisode = BatchCreateEpisodesResponse['episodes'][number];
    const createdEpisodes: CreatedEpisode[] = [];

    // Rows the season_outline commit made: apply the preview's edits
    const committed = data.episodes.filter(
      (ep): ep is EpisodeOutline & { id: string } => !!ep.id,
    );

    for (const ep of committed) {
      const { data: updated, error: updateError } = await client
        .from('episodes')
        .update(episodeRowUpdateFromOutline(ep))
        .eq('id', ep.id)
        .eq('project_id', data.projectId)
        .is('deleted_at', null)
        .select('id, number, title, status')
        .maybeSingle();

      if (updateError) {
        logger.error(
          { ...ctx, error: updateError, episodeId: ep.id },
          'Failed to update a generated episode',
        );
        throw new Error(`Failed to update episode: ${updateError.message}`);
      }

      // RLS filters a refused update to no row, without an error (KB-105)
      if (!updated) {
        throw new ActionRefusal('Episode not found or access denied');
      }

      createdEpisodes.push(updated);
    }

    const toInsert = data.episodes.filter((ep) => !ep.id);

    if (toInsert.length > 0) {
      // Get next episode number for the project/season
      let existingEpisodesQuery = client
        .from('episodes')
        .select('number')
        .eq('project_id', data.projectId)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(1);

      if (data.seasonId) {
        existingEpisodesQuery = existingEpisodesQuery.eq(
          'season_id',
          data.seasonId,
        );
      }

      const { data: existingEpisodes } = await existingEpisodesQuery;
      const nextNumber = (existingEpisodes?.[0]?.number ?? 0) + 1;

      const episodesToInsert = toInsert.map((ep: EpisodeOutline, index) =>
        episodeRowFromOutline(ep, {
          projectId: data.projectId,
          seasonId: data.seasonId ?? null,
          number: nextNumber + index,
        }),
      );

      // Insert all episodes atomically
      const { data: inserted, error: insertError } = await client
        .from('episodes')
        .insert(episodesToInsert)
        .select('id, number, title, status');

      if (insertError) {
        logger.error(
          { ...ctx, error: insertError },
          'Failed to batch create episodes',
        );
        throw new Error(`Failed to create episodes: ${insertError.message}`);
      }

      createdEpisodes.push(...(inserted ?? []));
    }

    createdEpisodes.sort((a, b) => a.number - b.number);

    // Create audit log
    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId,
      userId: user.id,
      action: 'create',
      objectType: 'episode',
      objectId: createdEpisodes[0]?.id ?? 'batch',
      objectName: `Batch of ${createdEpisodes.length} episodes`,
      scopes: [
        { type: 'account', id: accountId },
        { type: 'project', id: data.projectId },
      ],
      metadata: {
        operation: 'batch_create',
        count: createdEpisodes.length,
        seasonId: data.seasonId,
        episodeIds: createdEpisodes.map((ep: { id: string }) => ep.id),
      },
      ...networkContext,
    });

    logger.info(
      { ...ctx, createdCount: createdEpisodes.length },
      'Episodes batch created successfully',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      data: {
        success: true,
        episodes: createdEpisodes,
        count: createdEpisodes.length,
      },
    };
  },
  {
    schema: BatchCreateEpisodesSchema,
  },
);

export const batchCreateEpisodesAction = returnRefusals(
  batchCreateEpisodesHandler,
);

/**
 * Discard generated draft episodes the user did not keep (FILM-1901)
 *
 * The season_outline stage's commit creates a row per outline when the
 * outlines are generated. When the user removes an outline in the preview,
 * or cancels the preview, the rows they did not keep are soft-deleted the
 * way the app deletes episodes, so the project shows the same episodes it
 * would have before the rows were created at commit. Only generated drafts
 * of this project are touched: a row a person made, or one already past
 * draft, is left alone.
 */
const discardGeneratedEpisodesHandler = enhanceAction(
  async (data): Promise<{ success: true; discarded: string[] }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.discardGenerated',
      projectId: data.projectId,
      episodeCount: data.episodeIds.length,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized generated episode discard attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'discardGeneratedEpisodes', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const project = requireRow(
      await client
        .from('projects')
        .select('id, account_id')
        .eq('id', data.projectId)
        .single(),
      'Project not found or access denied',
    );

    const now = new Date().toISOString();

    const { data: deleted, error } = await client
      .from('episodes')
      .update({ deleted_at: now })
      .eq('project_id', data.projectId)
      .in('id', data.episodeIds)
      .eq('status', 'draft')
      .eq('story_data->>generatedFromBatch', 'true')
      .is('deleted_at', null)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to discard generated episodes');
      throw new Error(`Failed to discard episodes: ${error.message}`);
    }

    // RLS filters a refused update to no rows, without an error (KB-61)
    const discarded = requireAffectedRows(
      deleted,
      "The generated episodes weren't removed: they're already gone, or you can't delete them. Reload the page.",
    ).map((row) => row.id);

    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId: project.account_id,
      userId: user.id,
      action: 'delete',
      objectType: 'episode',
      objectId: discarded[0] ?? 'batch',
      objectName: `${discarded.length} generated outlines discarded`,
      scopes: [
        { type: 'account', id: project.account_id },
        { type: 'project', id: data.projectId },
      ],
      metadata: {
        operation: 'discard_generated',
        count: discarded.length,
        episodeIds: discarded,
      },
      ...networkContext,
    });

    logger.info(
      { ...ctx, discardedCount: discarded.length },
      'Generated episodes discarded',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true, discarded };
  },
  { schema: DiscardGeneratedEpisodesSchema },
);

export const discardGeneratedEpisodesAction = returnRefusals(
  discardGeneratedEpisodesHandler,
);

/**
 * Regenerate a single episode outline with context (FILM-314)
 *
 * Uses surrounding episodes for narrative continuity when regenerating.
 * In production, queues via SQS for background processing.
 */
const regenerateEpisodeOutline = enhanceAction(
  async (
    data,
  ): Promise<{
    success: true;
    data?: RegenerateEpisodeOutlineResponse;
    queued?: boolean;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.regenerateOutline',
      projectId: data.projectId,
      episodeNumber: data.episodeNumber,
    };

    logger.info(ctx, 'Processing episode regeneration request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode regeneration attempt');
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'regenerateEpisodeOutline', {
      maxRequests: 120,
      windowMs: 60_000,
    });

    const target = await authorizeProjectTarget(client, data.projectId);

    if (!target) {
      throw new ActionRefusal('Project not found or access denied');
    }

    // Always queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    await queueLlmJob({
      jobType: 'season-outline', // Reuses season-outline handler for single episode
      userId: user.id,
      target,
      payload: {
        projectId: data.projectId,
        // The regenerated outline replaces the row the first outline made
        // for this number, in this season (FILM-1901)
        seasonId: data.seasonId,
        seasonPremise: data.seasonPremise,
        episodeCount: 1,
        startingNumber: data.episodeNumber,
        // The episode is written to fit between these (KB-121)
        surroundingEpisodes: data.surroundingEpisodes,
        additionalContext: data.additionalContext,
        userId: user.id,
      },
    });

    logger.info(ctx, 'Episode regeneration job queued');
    return { success: true, queued: true };
  },
  { schema: RegenerateEpisodeOutlineSchema },
);

export const regenerateEpisodeOutlineAction = returnRefusals(
  regenerateEpisodeOutline,
);
