'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import type { AssetRow } from '@kit/assets';
import { mapRowToAsset } from '@kit/assets';
import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BatchShotCountSchema,
  BulkResetToStageSchema,
  BulkResetToStoryboardSchema,
  CreateEpisodeSchema,
  DeleteEpisodeSchema,
  GetEpisodeSchema,
  ListProjectEpisodesSchema,
  ResetEpisodeSchema,
  ResetToStageSchema,
  ResetToStoryboardSchema,
  UpdateEpisodeSchema,
  UpdateEpisodeStatusSchema,
} from '../lib/schemas';
import { CreateEpisodeWithContextSchema } from '../lib/schemas/create-episode-wizard.schema';
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
const createEpisode = enhanceAction(
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
      // A number chosen by the caller is never retried, so a clash on it is
      // theirs to resolve. An auto-assigned number that still clashes after
      // every retry is a failure, and stays thrown.
      if (data.number && lastError?.code === '23505') {
        throw new ActionRefusal(
          `Episode ${data.number} already exists in this project. Choose a different number.`,
        );
      }

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

export const createEpisodeAction = returnRefusals(createEpisode);

/**
 * Create an episode with full context from the Enhanced Create Episode Wizard.
 * Supports attaching facts, creative direction, and optional story auto-generation.
 */
const createEpisodeWithContext = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.createWithContext',
      projectId: data.projectId,
    };

    logger.info(ctx, 'Creating episode with context');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode creation attempt');
      throw new Error('Authentication required');
    }

    // 1. Get project for account_id
    const { data: project } = await client
      .from('projects')
      .select('account_id')
      .eq('id', data.projectId)
      .single();

    if (!project) {
      throw new ActionRefusal('Project not found or access denied');
    }

    // 2. Resolve or create season
    let seasonId = data.seasonId ?? null;

    if (data.newSeasonName && !seasonId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingSeasons } = await (client as any)
        .from('seasons')
        .select('number')
        .eq('project_id', data.projectId)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(1);

      const nextSeasonNumber = (existingSeasons?.[0]?.number ?? 0) + 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newSeason, error: seasonError } = await (client as any)
        .from('seasons')
        .insert({
          project_id: data.projectId,
          number: nextSeasonNumber,
          name: data.newSeasonName,
        })
        .select('id')
        .single();

      if (seasonError) {
        logger.error({ ...ctx, error: seasonError }, 'Failed to create season');
        throw new Error('Failed to create season');
      }

      seasonId = newSeason.id;
      logger.info({ ...ctx, seasonId }, 'Created new season inline');
    }

    // 3. Auto-assign episode number
    const MAX_RETRIES = 3;
    let episode;
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingEpisodes } = await (client as any)
        .from('episodes')
        .select('number')
        .eq('project_id', data.projectId)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(1);

      const episodeNumber = (existingEpisodes?.[0]?.number ?? 0) + 1;
      const slug = generateEpisodeSlug(episodeNumber, data.title);

      // Build story_data with creative direction
      const storyData: Record<string, unknown> = {};
      if (data.hook) {
        storyData.premise = data.hook;
        storyData.logline = data.hook;
      }

      // Build metadata with creative direction
      const metadata: Record<string, unknown> = {};
      if (data.visualTone) metadata.visual_tone = data.visualTone;
      if (data.toneNotes) metadata.tone_notes = data.toneNotes;
      if (data.contentStyle) metadata.content_style = data.contentStyle;
      if (data.targetDuration) metadata.target_duration = data.targetDuration;
      if (data.factIds?.length) metadata.source_fact_ids = data.factIds;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: insertedEpisode, error } = await (client as any)
        .from('episodes')
        .insert({
          project_id: data.projectId,
          season_id: seasonId,
          number: episodeNumber,
          title: data.title,
          slug,
          description: data.description ?? null,
          status: 'draft',
          story_data: Object.keys(storyData).length > 0 ? storyData : null,
          metadata,
          version: 1,
          target_duration_seconds: data.targetDuration ?? null,
        })
        .select()
        .single();

      if (!error) {
        episode = insertedEpisode;
        break;
      }

      const isUniqueViolation =
        error.code === '23505' || error.message?.includes('unique');

      if (isUniqueViolation && attempt < MAX_RETRIES - 1) {
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

    // 4. Link facts via episode_facts junction table
    if (data.factIds && data.factIds.length > 0) {
      const factLinkRows = data.factIds.map((factId) => ({
        episode_id: episode.id,
        fact_id: factId,
        linked_by: user.id,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: factLinkError } = await (client as any)
        .from('episode_facts')
        .upsert(factLinkRows, { onConflict: 'episode_id,fact_id' });

      if (factLinkError) {
        logger.warn(
          { ...ctx, error: factLinkError },
          'Failed to link facts to episode (non-fatal)',
        );
      } else {
        logger.info(
          { ...ctx, factCount: data.factIds.length },
          'Linked facts to episode',
        );
      }
    }

    // 5. Create audit log
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

    // 6. Optionally queue story generation immediately
    if (data.autoGenerateStory && data.hook) {
      try {
        const { queueLlmJob } = await import('@kit/prompt-engine/server');

        // The creator may still lack a writing role on the project (an
        // account member not in project_members): no story for them (KB-31)
        const target = await authorizeEpisodeTarget(client, episode.id);

        if (!target) {
          throw new Error('Cannot write to this project; story not queued');
        }

        // Create generation job entry
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).from('generation_jobs').insert({
          reference_type: 'episode',
          reference_id: episode.id,
          job_type: 'story',
          status: 'queued',
          account_id: project.account_id,
          project_id: data.projectId,
          idempotency_key: `story-${episode.id}-${Date.now()}`,
          input_data: { episodeId: episode.id, title: data.title },
        });

        await queueLlmJob({
          jobType: 'story-generation',
          userId: user.id,
          target,
          payload: {
            episodeId: episode.id,
            title: data.title,
            logline: data.hook,
            targetDuration: data.targetDuration ?? 300,
            contentStyle: data.contentStyle ?? 'dialogue-heavy',
            version: 1,
            accountId: project.account_id,
            userId: user.id,
            projectId: data.projectId,
          },
        });

        logger.info(
          { ...ctx, episodeId: episode.id },
          'Story generation queued',
        );
      } catch (queueError) {
        logger.warn(
          { ...ctx, error: queueError },
          'Failed to queue story generation (non-fatal)',
        );
      }
    }

    logger.info(
      { ...ctx, episodeId: episode.id },
      'Episode created with context',
    );
    revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');

    return {
      success: true,
      data: episode as Episode,
      seasonId,
      autoGenerateQueued: data.autoGenerateStory === true && !!data.hook,
    };
  },
  {
    schema: CreateEpisodeWithContextSchema,
  },
);

export const createEpisodeWithContextAction = returnRefusals(
  createEpisodeWithContext,
);

/**
 * Get verified facts for the Create Episode Wizard's fact picker.
 * Returns facts grouped by source for easy browsing.
 */
export const getProjectFactsForWizardAction = enhanceAction(
  async (data: {
    projectId: string;
  }): Promise<{
    success: true;
    data: {
      facts: Array<{
        id: string;
        claim: string;
        category: string | null;
        sourceTitle: string | null;
        sourceCitation: string | null;
        confidenceScore: number | null;
      }>;
      total: number;
    };
  }> => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: facts, error } = await (client as any)
      .from('verified_facts')
      .select(
        'id, claim, category, source_title, source_citation, confidence_score',
      )
      .eq('project_id', data.projectId)
      .in('verification_status', ['verified', 'pending_review'])
      .order('category', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      throw new Error('Failed to fetch facts');
    }

    const mappedFacts = (facts ?? []).map((f: Record<string, unknown>) => ({
      id: f.id as string,
      claim: f.claim as string,
      category: (f.category as string) ?? null,
      sourceTitle: (f.source_title as string) ?? null,
      sourceCitation: (f.source_citation as string) ?? null,
      confidenceScore: (f.confidence_score as number) ?? null,
    }));

    return {
      success: true,
      data: {
        facts: mappedFacts,
        total: mappedFacts.length,
      },
    };
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
    }),
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
        localized_videos, shorts_groups, story_data, screenplay_data, shot_list,
        metadata, version, created_at, updated_at, deleted_at,
        master_video_asset_id,
        master_video:assets!episodes_master_video_asset_id_fkey(*),
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
      .select(
        `
        id, episode_id, scene_number, shot_number, sequence_number,
        duration_seconds, scene_description, action_description,
        prompt, camera_direction, status, video_url, thumbnail_url,
        first_frame_url, last_frame_url, generation_job_id, generation_metadata,
        created_at, updated_at, deleted_at
      `,
      )
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (shotsError) {
      logger.error({ ...ctx, error: shotsError }, 'Failed to fetch shots');
      throw new Error('Failed to fetch episode shots');
    }

    // Fetch title cards (Asset[])
    const { data: titleCards, error: titleCardsError } = await client
      .from('assets')
      .select('*')
      .eq('episode_id', data.episodeId)
      .eq('type', 'master_title_card')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (titleCardsError) {
      logger.error(
        { ...ctx, error: titleCardsError },
        'Failed to fetch title cards',
      );
      // Non-critical, continue without title cards
    }

    logger.info(ctx, 'Episode fetched with shots');

    // Map titleCards with runtime safety check
    const mappedTitleCards = (
      Array.isArray(titleCards) ? (titleCards as AssetRow[]) : []
    ).map(mapRowToAsset);

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
      shortsGroups: episode.shorts_groups ?? null,
      storyData: episode.story_data,
      screenplayData: episode.screenplay_data,
      shotList: episode.shot_list,
      metadata: episode.metadata,
      version: episode.version,
      createdAt: episode.created_at,
      updatedAt: episode.updated_at,
      deletedAt: episode.deleted_at,
      masterVideoAssetId: episode.master_video_asset_id,
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
      titleCards: mappedTitleCards,
      masterVideoAsset: episode.master_video
        ? mapRowToAsset(episode.master_video as AssetRow)
        : null,
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
      .select(
        `
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `,
      )
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

    // Build query — lightweight select excludes large JSON blobs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('episodes')
      .select(
        `
        id, slug, project_id, season_id, number, title, description,
        status, duration_seconds, thumbnail_url, final_video_url,
        localized_videos, metadata, version, created_at, updated_at, deleted_at
      `,
        { count: 'exact' },
      )
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
      .select(
        `
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `,
      )
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

    // Security: Verify masterVideoAssetId belongs to the same project
    if (data.masterVideoAssetId !== undefined) {
      if (data.masterVideoAssetId !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: assetCheck, error: assetError } = await (client as any)
          .from('assets')
          .select('id, project_id')
          .eq('id', data.masterVideoAssetId)
          .single();

        if (assetError || !assetCheck) {
          throw new Error('Failed to verify asset access');
        }

        if (assetCheck.project_id !== currentEpisode.project_id) {
          throw new Error('Asset does not belong to this project');
        }
      }
      updates.master_video_asset_id = data.masterVideoAssetId;
    }

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
const deleteEpisode = enhanceAction(
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
      .select(
        `
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        created_at, updated_at, deleted_at,
        project:projects(account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      throw new ActionRefusal('Episode not found');
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

export const deleteEpisodeAction = returnRefusals(deleteEpisode);

// Shot CRUD actions have been moved to lib/server/mutations/shot-actions.ts (FILM-303)
// Shot list generation has been moved to lib/server/mutations/shot-list-actions.ts (FILM-307)

/**
 * Reset an episode back to draft state.
 * Clears story_data, screenplay_data, shot_list, deletes all shots rows,
 * and sets status to 'draft'. Intended as an escape hatch for episodes that
 * need to be fully regenerated from scratch.
 */
export const resetEpisodeAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.reset', episodeId: data.episodeId };

    logger.info(ctx, 'Resetting episode to draft');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode reset attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode for audit log and project context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select(
        `
        id, project_id, title, status, version,
        project:projects(account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      throw new Error('Episode not found');
    }

    // Optimistic lock: ensure the version the client holds matches what's in the DB
    if (episode.version !== data.version) {
      throw new OptimisticLockError('episode');
    }

    // Hard-delete all shots for this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: shotsError } = await (client as any)
      .from('shots')
      .delete()
      .eq('episode_id', data.episodeId);

    if (shotsError) {
      logger.error(
        { ...ctx, error: shotsError },
        'Failed to delete shots during reset',
      );
      throw new Error('Failed to delete shots');
    }

    // Hard-delete all dialogue lines for this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dialogueError } = await (client as any)
      .from('dialogue_lines')
      .delete()
      .eq('episode_id', data.episodeId);

    if (dialogueError) {
      logger.error(
        { ...ctx, error: dialogueError },
        'Failed to delete dialogue lines during reset',
      );
      throw new Error('Failed to delete dialogue lines');
    }

    // Hard-delete all audio tracks for this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: audioTracksError } = await (client as any)
      .from('audio_tracks')
      .delete()
      .eq('episode_id', data.episodeId);

    if (audioTracksError) {
      logger.warn(
        { ...ctx, error: audioTracksError },
        'Failed to delete audio tracks during reset (non-fatal)',
      );
    }

    // Hard-delete all audio cues for this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: audioCuesError } = await (client as any)
      .from('audio_cues')
      .delete()
      .eq('episode_id', data.episodeId);

    if (audioCuesError) {
      logger.warn(
        { ...ctx, error: audioCuesError },
        'Failed to delete audio cues during reset (non-fatal)',
      );
    }

    // ── Canon cleanup ──────────────────────────────────────────────
    // Delete narrative threads that were opened during this episode's generation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: threadsError } = await (client as any)
      .from('narrative_threads')
      .delete()
      .eq('opened_at', data.episodeId);

    if (threadsError) {
      logger.warn(
        { ...ctx, error: threadsError },
        'Failed to delete narrative threads during reset (non-fatal)',
      );
    }

    // Delete immutable events established in this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: immutableError } = await (client as any)
      .from('immutable_events')
      .delete()
      .eq('established_in', data.episodeId);

    if (immutableError) {
      logger.warn(
        { ...ctx, error: immutableError },
        'Failed to delete immutable events during reset (non-fatal)',
      );
    }

    // Delete character states from this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: charStatesError } = await (client as any)
      .from('character_states')
      .delete()
      .eq('episode_id', data.episodeId);

    if (charStatesError) {
      logger.warn(
        { ...ctx, error: charStatesError },
        'Failed to delete character states during reset (non-fatal)',
      );
    }

    // Delete state deltas (audit trail) from this episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deltasError } = await (client as any)
      .from('state_deltas')
      .delete()
      .eq('episode_id', data.episodeId);

    if (deltasError) {
      logger.warn(
        { ...ctx, error: deltasError },
        'Failed to delete state deltas during reset (non-fatal)',
      );
    }

    // Delete episode summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: summaryError } = await (client as any)
      .from('episode_summaries')
      .delete()
      .eq('episode_id', data.episodeId);

    if (summaryError) {
      logger.warn(
        { ...ctx, error: summaryError },
        'Failed to delete episode summary during reset (non-fatal)',
      );
    }

    // Clean stale episode references from other threads' episodes_touched arrays
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: touchedError } = await (client as any).rpc(
      'remove_episode_from_threads_touched',
      {
        p_episode_id: data.episodeId,
        p_project_id: episode.project_id,
      },
    );

    if (touchedError) {
      logger.warn(
        { ...ctx, error: touchedError },
        'Failed to clean episodes_touched during reset (non-fatal)',
      );
    }
    // ── End canon cleanup ──────────────────────────────────────────

    // Cancel all active generation jobs for this episode
    // Prevents ghost Lambda workers from writing stale data after reset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobsError } = await (client as any)
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: 'Cancelled: Episode was reset to draft',
        completed_at: new Date().toISOString(),
      })
      .eq('reference_id', data.episodeId)
      .eq('reference_type', 'episode')
      .in('status', ['queued', 'processing']);

    if (jobsError) {
      logger.warn(
        { ...ctx, error: jobsError },
        'Failed to cancel generation jobs during reset (non-fatal)',
      );
    }

    // Reset episode fields back to draft state, verifying version hasn't changed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        status: 'draft',
        story_data: null,
        screenplay_data: null,
        shot_list: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to reset episode');
      throw new Error('Failed to reset episode');
    }

    if (!updatedEpisode) {
      throw new OptimisticLockError('episode');
    }

    // Audit log
    const accountId = episode.project?.account_id;
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: { status: episode.status },
        after: { status: 'draft' },
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, 'Episode reset to draft');
    revalidatePath(
      '/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]',
      'layout',
    );

    return { success: true };
  },
  {
    schema: ResetEpisodeSchema,
  },
);

/**
 * Surgical reset: rewind an episode to the storyboard stage.
 * Keeps story_data, screenplay_data, and dialogue_lines intact.
 * Clears shots, audio tracks, audio cues, shot_list, and cancels
 * any active generation jobs.
 */
export const resetToStoryboardAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.resetToStoryboard',
      episodeId: data.episodeId,
    };

    logger.info(ctx, '[Reset to Storyboard] Starting surgical reset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, '[Reset to Storyboard] Unauthorized attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode for verification and audit log context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select(
        `
        id, project_id, title, status, version,
        project:projects(account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      throw new Error('Episode not found');
    }

    // Verify account access
    const accountId = episode.project?.account_id;
    if (accountId !== data.accountId) {
      logger.warn(
        { ...ctx, expectedAccount: data.accountId, actualAccount: accountId },
        '[Reset to Storyboard] Account mismatch',
      );
      throw new Error('Episode not found');
    }

    // 1. Cancel active generation jobs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobsError } = await (client as any)
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: 'Cancelled: Episode was reset to storyboard',
        completed_at: new Date().toISOString(),
      })
      .eq('reference_id', data.episodeId)
      .in('status', ['queued', 'processing']);

    if (jobsError) {
      logger.warn(
        { ...ctx, error: jobsError },
        '[Reset to Storyboard] Failed to cancel generation jobs (non-fatal)',
      );
    }

    // 2. Delete audio cues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: audioCuesError } = await (client as any)
      .from('audio_cues')
      .delete()
      .eq('episode_id', data.episodeId);

    if (audioCuesError) {
      logger.warn(
        { ...ctx, error: audioCuesError },
        '[Reset to Storyboard] Failed to delete audio cues (non-fatal)',
      );
    }

    // 3. Delete audio tracks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: audioTracksError } = await (client as any)
      .from('audio_tracks')
      .delete()
      .eq('episode_id', data.episodeId);

    if (audioTracksError) {
      logger.warn(
        { ...ctx, error: audioTracksError },
        '[Reset to Storyboard] Failed to delete audio tracks (non-fatal)',
      );
    }

    // 4. Hard-delete all shots
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: shotsError } = await (client as any)
      .from('shots')
      .delete()
      .eq('episode_id', data.episodeId);

    if (shotsError) {
      logger.error(
        { ...ctx, error: shotsError },
        '[Reset to Storyboard] Failed to delete shots',
      );
      throw new Error('Failed to delete shots');
    }

    // 5. Update episode: set status to 'storyboard', clear shot_list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        status: 'storyboard',
        shot_list: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (updateError || !updatedEpisode) {
      logger.error(
        { ...ctx, error: updateError },
        '[Reset to Storyboard] Failed to update episode',
      );
      throw new Error('Failed to update episode');
    }

    // Audit log
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: { status: episode.status },
        after: { status: 'storyboard' },
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, '[Reset to Storyboard] Episode reset to storyboard');
    revalidatePath(
      '/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]',
      'layout',
    );

    return { success: true };
  },
  {
    schema: ResetToStoryboardSchema,
  },
);

/**
 * Bulk surgical reset: rewind multiple episodes to the storyboard stage.
 * Loops through each episode and applies the same reset logic as
 * resetToStoryboardAction. Returns a summary with per-episode error tracking.
 */
export const bulkResetToStoryboardAction = enhanceAction(
  async (
    data,
  ): Promise<{
    success: boolean;
    resetCount: number;
    errors: Array<{ episodeId: string; error: string }>;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.bulkResetToStoryboard',
      count: data.episodeIds.length,
    };

    logger.info(ctx, '[Reset to Storyboard] Starting bulk reset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, '[Reset to Storyboard] Unauthorized bulk attempt');
      throw new Error('Authentication required');
    }

    let resetCount = 0;
    const errors: Array<{ episodeId: string; error: string }> = [];

    for (const episodeId of data.episodeIds) {
      try {
        // Fetch episode for verification
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: episode, error: fetchError } = await (client as any)
          .from('episodes')
          .select(
            `
            id, project_id, title, status, version,
            project:projects(account_id)
          `,
          )
          .eq('id', episodeId)
          .is('deleted_at', null)
          .single();

        if (fetchError || !episode) {
          errors.push({ episodeId, error: 'Episode not found' });
          continue;
        }

        // Verify account access
        const accountId = episode.project?.account_id;
        if (accountId !== data.accountId) {
          errors.push({ episodeId, error: 'Access denied' });
          continue;
        }

        // 1. Cancel active generation jobs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: 'Cancelled: Episode was reset to storyboard (bulk)',
            completed_at: new Date().toISOString(),
          })
          .eq('reference_id', episodeId)
          .in('status', ['queued', 'processing']);

        // 2. Delete audio cues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('audio_cues')
          .delete()
          .eq('episode_id', episodeId);

        // 3. Delete audio tracks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('audio_tracks')
          .delete()
          .eq('episode_id', episodeId);

        // 4. Hard-delete all shots
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: shotsError } = await (client as any)
          .from('shots')
          .delete()
          .eq('episode_id', episodeId);

        if (shotsError) {
          errors.push({ episodeId, error: 'Failed to delete shots' });
          continue;
        }

        // 5. Update episode
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (client as any)
          .from('episodes')
          .update({
            status: 'storyboard',
            shot_list: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', episodeId)
          .is('deleted_at', null);

        if (updateError) {
          errors.push({ episodeId, error: 'Failed to update episode' });
          continue;
        }

        // Audit log
        if (accountId) {
          const networkContext = await extractNetworkContext();

          await createAuditLog({
            accountId,
            userId: user.id,
            action: 'update',
            objectType: 'episode',
            objectId: episode.id,
            objectName: episode.title,
            before: { status: episode.status },
            after: { status: 'storyboard' },
            scopes: [
              { type: 'account', id: accountId },
              { type: 'project', id: episode.project_id },
              { type: 'episode', id: episode.id },
            ],
            ...networkContext,
          });
        }

        resetCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ episodeId, error: message });
        logger.error(
          { ...ctx, episodeId, error: err },
          '[Reset to Storyboard] Failed to reset episode in bulk',
        );
      }
    }

    logger.info(
      { ...ctx, resetCount, errorCount: errors.length },
      '[Reset to Storyboard] Bulk reset complete',
    );

    revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');

    return {
      success: errors.length === 0,
      resetCount,
      errors,
    };
  },
  {
    schema: BulkResetToStoryboardSchema,
  },
);

/**
 * Flexible reset: rewind an episode to any pipeline stage.
 * Clears all data produced AFTER the target stage.
 *
 * - `draft`: Full reset (same as resetEpisodeAction without optimistic locking)
 * - `story`: Keep story_data, clear screenplay + shots + audio + canon
 * - `screenplay` / `storyboard`: Keep story + screenplay + dialogue_lines, clear shots + audio
 */
const resetToStageHandler = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.resetToStage',
      episodeId: data.episodeId,
      targetStage: data.targetStage,
    };

    logger.info(ctx, '[Reset to Stage] Starting flexible reset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, '[Reset to Stage] Unauthorized attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode for verification and audit log context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select(
        `
        id, project_id, title, status, version,
        project:projects(account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      throw new ActionRefusal('Episode not found');
    }

    const accountId = episode.project?.account_id;

    // 1. Cancel active generation jobs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: jobsError } = await (client as any)
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: `Cancelled: Episode was reset to ${data.targetStage}`,
        completed_at: new Date().toISOString(),
      })
      .eq('reference_id', data.episodeId)
      .eq('reference_type', 'episode')
      .in('status', ['queued', 'processing']);

    if (jobsError) {
      logger.warn(
        { ...ctx, error: jobsError },
        '[Reset to Stage] Failed to cancel generation jobs (non-fatal)',
      );
    }

    // 2. Stage-specific cleanup
    if (data.targetStage === 'draft') {
      // ── Full reset: clear everything ──

      // Delete shots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: shotsError } = await (client as any)
        .from('shots')
        .delete()
        .eq('episode_id', data.episodeId);

      if (shotsError) {
        logger.error(
          { ...ctx, error: shotsError },
          '[Reset to Stage] Failed to delete shots',
        );
        throw new Error('Failed to delete shots');
      }

      // Delete dialogue lines
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dialogueError } = await (client as any)
        .from('dialogue_lines')
        .delete()
        .eq('episode_id', data.episodeId);

      if (dialogueError) {
        logger.error(
          { ...ctx, error: dialogueError },
          '[Reset to Stage] Failed to delete dialogue lines',
        );
        throw new Error('Failed to delete dialogue lines');
      }

      // Delete audio tracks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioTracksError } = await (client as any)
        .from('audio_tracks')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioTracksError) {
        logger.warn(
          { ...ctx, error: audioTracksError },
          '[Reset to Stage] Failed to delete audio tracks (non-fatal)',
        );
      }

      // Delete audio cues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioCuesError } = await (client as any)
        .from('audio_cues')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioCuesError) {
        logger.warn(
          { ...ctx, error: audioCuesError },
          '[Reset to Stage] Failed to delete audio cues (non-fatal)',
        );
      }

      // ── Canon cleanup ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: threadsError } = await (client as any)
        .from('narrative_threads')
        .delete()
        .eq('opened_at', data.episodeId);

      if (threadsError) {
        logger.warn(
          { ...ctx, error: threadsError },
          '[Reset to Stage] Failed to delete narrative threads (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: immutableError } = await (client as any)
        .from('immutable_events')
        .delete()
        .eq('established_in', data.episodeId);

      if (immutableError) {
        logger.warn(
          { ...ctx, error: immutableError },
          '[Reset to Stage] Failed to delete immutable events (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: charStatesError } = await (client as any)
        .from('character_states')
        .delete()
        .eq('episode_id', data.episodeId);

      if (charStatesError) {
        logger.warn(
          { ...ctx, error: charStatesError },
          '[Reset to Stage] Failed to delete character states (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deltasError } = await (client as any)
        .from('state_deltas')
        .delete()
        .eq('episode_id', data.episodeId);

      if (deltasError) {
        logger.warn(
          { ...ctx, error: deltasError },
          '[Reset to Stage] Failed to delete state deltas (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: summaryError } = await (client as any)
        .from('episode_summaries')
        .delete()
        .eq('episode_id', data.episodeId);

      if (summaryError) {
        logger.warn(
          { ...ctx, error: summaryError },
          '[Reset to Stage] Failed to delete episode summary (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: touchedError } = await (client as any).rpc(
        'remove_episode_from_threads_touched',
        {
          p_episode_id: data.episodeId,
          p_project_id: episode.project_id,
        },
      );

      if (touchedError) {
        logger.warn(
          { ...ctx, error: touchedError },
          '[Reset to Stage] Failed to clean episodes_touched (non-fatal)',
        );
      }
      // ── End canon cleanup ──
    } else if (data.targetStage === 'story') {
      // ── Keep story_data, clear everything after ──

      // Delete shots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: shotsError } = await (client as any)
        .from('shots')
        .delete()
        .eq('episode_id', data.episodeId);

      if (shotsError) {
        logger.error(
          { ...ctx, error: shotsError },
          '[Reset to Stage] Failed to delete shots',
        );
        throw new Error('Failed to delete shots');
      }

      // Delete dialogue lines
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dialogueError } = await (client as any)
        .from('dialogue_lines')
        .delete()
        .eq('episode_id', data.episodeId);

      if (dialogueError) {
        logger.error(
          { ...ctx, error: dialogueError },
          '[Reset to Stage] Failed to delete dialogue lines',
        );
        throw new Error('Failed to delete dialogue lines');
      }

      // Delete audio tracks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioTracksError } = await (client as any)
        .from('audio_tracks')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioTracksError) {
        logger.warn(
          { ...ctx, error: audioTracksError },
          '[Reset to Stage] Failed to delete audio tracks (non-fatal)',
        );
      }

      // Delete audio cues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioCuesError } = await (client as any)
        .from('audio_cues')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioCuesError) {
        logger.warn(
          { ...ctx, error: audioCuesError },
          '[Reset to Stage] Failed to delete audio cues (non-fatal)',
        );
      }

      // ── Canon cleanup (same as draft) ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: threadsError } = await (client as any)
        .from('narrative_threads')
        .delete()
        .eq('opened_at', data.episodeId);

      if (threadsError) {
        logger.warn(
          { ...ctx, error: threadsError },
          '[Reset to Stage] Failed to delete narrative threads (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: immutableError } = await (client as any)
        .from('immutable_events')
        .delete()
        .eq('established_in', data.episodeId);

      if (immutableError) {
        logger.warn(
          { ...ctx, error: immutableError },
          '[Reset to Stage] Failed to delete immutable events (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: charStatesError } = await (client as any)
        .from('character_states')
        .delete()
        .eq('episode_id', data.episodeId);

      if (charStatesError) {
        logger.warn(
          { ...ctx, error: charStatesError },
          '[Reset to Stage] Failed to delete character states (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deltasError } = await (client as any)
        .from('state_deltas')
        .delete()
        .eq('episode_id', data.episodeId);

      if (deltasError) {
        logger.warn(
          { ...ctx, error: deltasError },
          '[Reset to Stage] Failed to delete state deltas (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: summaryError } = await (client as any)
        .from('episode_summaries')
        .delete()
        .eq('episode_id', data.episodeId);

      if (summaryError) {
        logger.warn(
          { ...ctx, error: summaryError },
          '[Reset to Stage] Failed to delete episode summary (non-fatal)',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: touchedError } = await (client as any).rpc(
        'remove_episode_from_threads_touched',
        {
          p_episode_id: data.episodeId,
          p_project_id: episode.project_id,
        },
      );

      if (touchedError) {
        logger.warn(
          { ...ctx, error: touchedError },
          '[Reset to Stage] Failed to clean episodes_touched (non-fatal)',
        );
      }
      // ── End canon cleanup ──
    } else {
      // ── screenplay / storyboard: keep story + screenplay + dialogue_lines ──

      // Delete audio cues
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioCuesError } = await (client as any)
        .from('audio_cues')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioCuesError) {
        logger.warn(
          { ...ctx, error: audioCuesError },
          '[Reset to Stage] Failed to delete audio cues (non-fatal)',
        );
      }

      // Delete audio tracks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: audioTracksError } = await (client as any)
        .from('audio_tracks')
        .delete()
        .eq('episode_id', data.episodeId);

      if (audioTracksError) {
        logger.warn(
          { ...ctx, error: audioTracksError },
          '[Reset to Stage] Failed to delete audio tracks (non-fatal)',
        );
      }

      // Delete shots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: shotsError } = await (client as any)
        .from('shots')
        .delete()
        .eq('episode_id', data.episodeId);

      if (shotsError) {
        logger.error(
          { ...ctx, error: shotsError },
          '[Reset to Stage] Failed to delete shots',
        );
        throw new Error('Failed to delete shots');
      }
    }

    // 3. Build episode update based on target stage
    const episodeUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.targetStage === 'draft') {
      episodeUpdates.status = 'draft';
      episodeUpdates.story_data = null;
      episodeUpdates.screenplay_data = null;
      episodeUpdates.shot_list = null;
    } else if (data.targetStage === 'story') {
      episodeUpdates.status = 'draft';
      episodeUpdates.screenplay_data = null;
      episodeUpdates.shot_list = null;
    } else {
      // screenplay or storyboard
      episodeUpdates.status = 'storyboard';
      episodeUpdates.shot_list = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update(episodeUpdates)
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (updateError || !updatedEpisode) {
      logger.error(
        { ...ctx, error: updateError },
        '[Reset to Stage] Failed to update episode',
      );
      throw new Error('Failed to update episode');
    }

    // Audit log
    if (accountId) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'update',
        objectType: 'episode',
        objectId: episode.id,
        objectName: episode.title,
        before: { status: episode.status },
        after: { status: episodeUpdates.status },
        scopes: [
          { type: 'account', id: accountId },
          { type: 'project', id: episode.project_id },
          { type: 'episode', id: episode.id },
        ],
        ...networkContext,
      });
    }

    logger.info(ctx, `[Reset to Stage] Episode reset to ${data.targetStage}`);
    revalidatePath(
      '/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]',
      'layout',
    );

    return { success: true };
  },
  {
    schema: ResetToStageSchema,
  },
);

export const resetToStageAction = returnRefusals(resetToStageHandler);

/**
 * Bulk flexible reset: rewind multiple episodes to a specific pipeline stage.
 * Loops through each episode and applies the same stage-based cleanup logic
 * as resetToStageAction. Returns a summary with per-episode error tracking.
 */
export const bulkResetToStageAction = enhanceAction(
  async (
    data,
  ): Promise<{
    success: boolean;
    resetCount: number;
    errors: Array<{ episodeId: string; error: string }>;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.bulkResetToStage',
      count: data.episodeIds.length,
      targetStage: data.targetStage,
    };

    logger.info(ctx, '[Reset to Stage] Starting bulk reset via RPC');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, '[Reset to Stage] Unauthorized bulk attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode titles in bulk for audit logging
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes } = await (client as any)
      .from('episodes')
      .select('id, title, status, project_id')
      .in('id', data.episodeIds)
      .is('deleted_at', null);

    const episodeMap = new Map<
      string,
      { title: string; status: string; project_id: string }
    >();

    if (episodes) {
      for (const ep of episodes) {
        episodeMap.set(ep.id, {
          title: ep.title,
          status: ep.status,
          project_id: ep.project_id,
        });
      }
    }

    // Call the batch RPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResult, error: rpcError } = await (client as any).rpc(
      'bulk_reset_episodes_to_stage',
      {
        p_episode_ids: data.episodeIds,
        p_target_stage: data.targetStage,
        p_account_id: data.accountId,
      },
    );

    if (rpcError) {
      logger.error(
        { ...ctx, error: rpcError },
        '[Reset to Stage] RPC call failed',
      );
      throw new Error('Bulk reset failed: ' + rpcError.message);
    }

    const resetCount = rpcResult?.reset_count ?? 0;
    const rpcErrors: Array<{ episodeId: string; error: string }> = (
      rpcResult?.errors ?? []
    ).map((e: { episode_id: string; error: string }) => ({
      episodeId: e.episode_id ?? '',
      error: e.error,
    }));

    // Determine the new status based on target stage
    const newStatus =
      data.targetStage === 'draft' || data.targetStage === 'story'
        ? 'draft'
        : 'storyboard';

    // Create audit logs for each successfully reset episode
    if (resetCount > 0) {
      const networkContext = await extractNetworkContext();

      for (const episodeId of data.episodeIds) {
        const ep = episodeMap.get(episodeId);

        if (!ep) continue;

        try {
          await createAuditLog({
            accountId: data.accountId,
            userId: user.id,
            action: 'update',
            objectType: 'episode',
            objectId: episodeId,
            objectName: ep.title,
            before: { status: ep.status },
            after: { status: newStatus },
            scopes: [
              { type: 'account', id: data.accountId },
              { type: 'project', id: ep.project_id },
              { type: 'episode', id: episodeId },
            ],
            ...networkContext,
          });
        } catch (auditErr) {
          logger.warn(
            { ...ctx, episodeId, error: auditErr },
            '[Reset to Stage] Failed to create audit log (non-fatal)',
          );
        }
      }
    }

    logger.info(
      { ...ctx, resetCount, errorCount: rpcErrors.length },
      '[Reset to Stage] Bulk reset complete',
    );

    revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');

    return {
      success: rpcErrors.length === 0,
      resetCount,
      errors: rpcErrors,
    };
  },
  {
    schema: BulkResetToStageSchema,
  },
);

/**
 * Batch fetch shot counts for multiple episodes.
 * Returns a map of episodeId -> shotCount.
 * Used by the bulk generate modal to detect which episodes already have shots.
 */
export const batchGetShotCountsAction = enhanceAction(
  async (
    data,
  ): Promise<{
    success: boolean;
    counts: Array<{ episodeId: string; shotCount: number }>;
  }> => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const counts: Array<{ episodeId: string; shotCount: number }> = [];

    // Use a single query with grouping via RPC or individual count queries
    // Supabase JS doesn't support GROUP BY, so we do individual count queries
    // batched in Promise.all for performance
    const results = await Promise.all(
      data.episodeIds.map(async (episodeId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error } = await (client as any)
          .from('shots')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', episodeId)
          .is('deleted_at', null);

        return {
          episodeId,
          shotCount: error ? 0 : (count ?? 0),
        };
      }),
    );

    counts.push(...results);

    return { success: true, counts };
  },
  {
    schema: BatchShotCountSchema,
  },
);
