'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type BatchCreateEpisodesResponse,
  BatchCreateEpisodesSchema,
  type EpisodeOutline,
  type GenerateSeasonOutlineResponse,
  GenerateSeasonOutlineSchema,
  type RegenerateEpisodeOutlineResponse,
  RegenerateEpisodeOutlineSchema,
} from '../lib/schemas/batch-episode.schema';
import { generateEpisodeSlug } from '../lib/slug-utils';

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
 * Creates all episodes atomically in a single database transaction.
 * Auto-assigns episode numbers starting from the next available number.
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
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new ActionRefusal('Project not found or access denied');
    }

    const accountId = project.account_id;

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

    // Prepare episode records for batch insert
    const episodesToInsert = data.episodes.map(
      (ep: EpisodeOutline, index: number) => {
        const episodeNumber = nextNumber + index;
        return {
          project_id: data.projectId,
          season_id: data.seasonId ?? null,
          number: episodeNumber,
          title: ep.title,
          slug: generateEpisodeSlug(episodeNumber, ep.title),
          description: ep.premise,
          status: 'draft',
          story_data: {
            premise: ep.premise,
            mainPlot: ep.mainPlot,
            characterFocus: ep.characterFocus ?? [],
            arcPosition: ep.arcPosition,
            generatedFromBatch: true,
          } as Json,
          version: 1,
        };
      },
    );

    // Insert all episodes atomically
    const { data: createdEpisodes, error: insertError } = await client
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
        seasonPremise: data.seasonPremise,
        episodeCount: 1,
        startingNumber: data.episodeNumber,
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
