'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import type { SeasonOutlineOutput } from '@kit/prompt-engine/schemas';
import { executeLLM } from '@kit/prompt-engine/server';
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
export const generateSeasonOutlineAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data?: GenerateSeasonOutlineResponse; queued?: boolean }> => {
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

    // Verify project access and get account ID
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
    }

    const accountId = project.account_id;

    // Check if we're in Lambda environment (production)
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // Production: Queue for background processing
      await queueLlmJob({
        jobType: 'season-outline',
        userId: user.id,
        payload: {
          projectId: data.projectId,
          seasonId: data.seasonId,
          seasonPremise: data.seasonPremise,
          episodeCount: data.episodeCount,
          startingNumber: data.startingNumber,
          genre: data.genre,
          style: data.style,
          accountId,
          userId: user.id,
        },
      });

      logger.info(ctx, 'Season outline job queued');
      return { success: true, queued: true };
    }

    // Local development: Run synchronously
    logger.info(ctx, 'Running synchronously (local dev mode)');

    // Load project characters for context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: characters } = await (client as any)
      .from('characters')
      .select('name, description')
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .limit(20);

    // Load project locations for context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: locations } = await (client as any)
      .from('locations')
      .select('name, description')
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .limit(20);

    // Format characters for prompt
    const charactersFormatted = characters?.length
      ? characters
        .map(
          (c: { name: string; description: string }) =>
            `- ${c.name}: ${c.description}`,
        )
        .join('\n')
      : '';

    // Format locations for prompt
    const locationsFormatted = locations?.length
      ? locations
        .map(
          (l: { name: string; description: string }) =>
            `- ${l.name}: ${l.description}`,
        )
        .join('\n')
      : '';

    // Prepare variables for prompt template
    const variables = {
      season_premise: data.seasonPremise,
      episode_count: data.episodeCount,
      starting_number: data.startingNumber,
      genre: data.genre ?? '',
      style: data.style ?? '',
      characters: charactersFormatted,
      locations: locationsFormatted,
    };

    // Execute LLM with season-outline template
    const result = await executeLLM<SeasonOutlineOutput>({
      templateSlug: 'story-generation/season-outline',
      variables,
      context: {
        name: 'season-outline',
        accountId,
        userId: user.id,
      },
    });

    // Cost is in USD, convert to cents
    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    logger.info(
      {
        ...ctx,
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
        tokensUsed: result.metadata.tokens,
        episodesGenerated: result.data.episodes.length,
      },
      'Season outline generated successfully',
    );

    return {
      success: true,
      data: {
        success: true,
        episodes: result.data.episodes,
        metadata: {
          provider: result.metadata.provider,
          model: result.metadata.model,
          costCents,
          tokensUsed: result.metadata.tokens,
          generatedAt,
        },
      },
    };
  },
  {
    schema: GenerateSeasonOutlineSchema,
  },
);

/**
 * Batch create episodes from generated outlines (FILM-314)
 *
 * Creates all episodes atomically in a single database transaction.
 * Auto-assigns episode numbers starting from the next available number.
 *
 * @throws {Error} If episode creation fails
 */
export const batchCreateEpisodesAction = enhanceAction(
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

    // Verify project access and get account ID
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
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

/**
 * Regenerate a single episode outline with context (FILM-314)
 *
 * Uses surrounding episodes for narrative continuity when regenerating.
 * In production, queues via SQS for background processing.
 */
export const regenerateEpisodeOutlineAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data?: RegenerateEpisodeOutlineResponse; queued?: boolean }> => {
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

    // Verify project access and get account ID
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
    }

    const accountId = project.account_id;

    // Check if we're in Lambda environment (production)
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // Production: Queue for background processing
      await queueLlmJob({
        jobType: 'season-outline', // Reuses season-outline handler for single episode
        userId: user.id,
        payload: {
          projectId: data.projectId,
          seasonPremise: data.seasonPremise,
          episodeCount: 1,
          startingNumber: data.episodeNumber,
          surroundingEpisodes: data.surroundingEpisodes,
          accountId,
          userId: user.id,
        },
      });

      logger.info(ctx, 'Episode regeneration job queued');
      return { success: true, queued: true };
    }

    // Local development: Run synchronously
    logger.info(ctx, 'Running synchronously (local dev mode)');

    // Format surrounding episodes for context
    const surroundingContext = data.surroundingEpisodes?.length
      ? `\n**Surrounding Episodes for Context**:\n${data.surroundingEpisodes
        .map(
          (ep) =>
            `- Episode ${ep.number} "${ep.title}": ${ep.premise} (${ep.arcPosition})`,
        )
        .join('\n')}`
      : '';

    // Prepare variables for single episode regeneration
    const variables = {
      season_premise: data.seasonPremise,
      episode_count: 1,
      starting_number: data.episodeNumber,
      genre: '',
      style: '',
      characters: '',
      locations: surroundingContext,
    };

    // Execute LLM with season-outline template (for single episode)
    const result = await executeLLM<SeasonOutlineOutput>({
      templateSlug: 'story-generation/season-outline',
      variables,
      context: {
        name: 'episode-regenerate',
        accountId,
        userId: user.id,
      },
    });

    // Cost is in USD, convert to cents
    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    const regeneratedEpisode = result.data.episodes[0];

    if (!regeneratedEpisode) {
      throw new Error('Failed to regenerate episode outline');
    }

    logger.info(
      {
        ...ctx,
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
      },
      'Episode outline regenerated successfully',
    );

    return {
      success: true,
      data: {
        success: true,
        episode: regeneratedEpisode,
        metadata: {
          provider: result.metadata.provider,
          model: result.metadata.model,
          costCents,
          tokensUsed: result.metadata.tokens,
          generatedAt,
        },
      },
    };
  },
  {
    schema: RegenerateEpisodeOutlineSchema,
  },
);
