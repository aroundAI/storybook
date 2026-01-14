'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import type {
  StoryGenerationOutput,
  StoryIdeationOutput,
} from '@kit/prompt-engine/schemas';
import { executeLLM } from '@kit/prompt-engine/server';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type ContentStyle,
  calculateContentScaling,
  formatDuration,
} from '../lib/duration-scaling';
import {
  GenerateFullStorySchema,
  GenerateStoryIdeasSchema,
  type GenerationMetadata,
} from '../lib/schemas/story.schema';
import { OptimisticLockError } from '../lib/status-workflow';
import type { EpisodeStatus } from '../lib/types';

/**
 * Response type for story ideation
 */
export interface GenerateStoryIdeasResponse {
  ideas: StoryIdeationOutput['ideas'];
  metadata: GenerationMetadata;
}

/**
 * Response type for full story generation
 */
export interface GenerateFullStoryResponse {
  story: StoryGenerationOutput['story'];
  episode: {
    id: string;
    status: string;
    version: number;
  };
  metadata: GenerationMetadata;
}

/**
 * Generate multiple story ideas from a premise
 *
 * Uses the story-ideation prompt template to generate 1-5 diverse story concepts.
 * In production, queues via SQS for background processing.
 */
export const generateStoryIdeasAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data?: GenerateStoryIdeasResponse; queued?: boolean }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.generateStoryIdeas' };

    logger.info(ctx, 'Processing story ideation request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story ideation attempt');
      throw new Error('Authentication required');
    }

    // Get user's account for cost tracking and authorization
    const { data: accountMemberships } = await client
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', user.id)
      .limit(1);

    if (!accountMemberships?.length) {
      const { data: personalAccount } = await client
        .from('accounts')
        .select('id')
        .eq('primary_owner_user_id', user.id)
        .limit(1);

      if (!personalAccount?.length) {
        logger.warn(ctx, 'User has no account for story ideation');
        throw new Error(
          'No account found. Please ensure you have an active account.',
        );
      }
    }

    const accountId = accountMemberships?.[0]?.account_id ?? user.id;

    // Check if we're in Lambda environment (production)
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // Production: Queue for background processing
      await queueLlmJob({
        jobType: 'story-ideation',
        userId: user.id,
        payload: {
          episodeId: data.episodeId,
          premise: data.premise,
          numberOfIdeas: data.numberOfIdeas,
          accountId,
          userId: user.id,
        },
      });

      logger.info(ctx, 'Story ideation job queued');
      return { success: true, queued: true };
    }

    // Local development: Run synchronously
    logger.info(ctx, 'Running synchronously (local dev mode)');

    // Build rich context for episode (Phase 1: Context Builder)
    const {
      buildEpisodeContext,
      formatCharactersForPrompt,
      formatLocationsForPrompt,
      formatRecurringElementForPrompt,
    } = await import('./context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId);

    // Prepare variables for prompt template
    const variables = {
      premise: episodeContext.premise,
      number_of_ideas: data.numberOfIdeas,
      characters: formatCharactersForPrompt(episodeContext.characters),
      locations: formatLocationsForPrompt(episodeContext.locations),
      season_context: episodeContext.seasonPremise
        ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
        : '',
      previous_episodes:
        episodeContext.previousEpisodes.length > 0
          ? `Previous episodes in this season: ${episodeContext.previousEpisodes.map((ep) => `Ep${ep.number}: "${ep.title}"`).join(', ')}`
          : '',
      genre: episodeContext.genre,
      target_audience: episodeContext.targetAudience,
      visual_style: episodeContext.visualStyle,
      style: 'balanced',
      recurring_element: formatRecurringElementForPrompt(
        episodeContext.recurringElement,
      ),
    };

    // Execute LLM with story-ideation template
    const result = await executeLLM<StoryIdeationOutput>({
      templateSlug: 'story-generation/story-ideation',
      variables,
      context: {
        name: 'story-ideation',
        accountId,
        userId: user.id,
      },
    });

    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    logger.info(
      {
        ...ctx,
        provider: result.metadata.provider,
        ideasGenerated: result.data.ideas.length,
      },
      'Story ideas generated successfully',
    );

    return {
      success: true,
      data: {
        ideas: result.data.ideas,
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
    schema: GenerateStoryIdeasSchema,
  },
);

/**
 * Generate a complete story from a selected idea and update the episode
 *
 * Uses the story-generation prompt template to create a 500-1000 word narrative.
 * In production, queues via SQS for background processing.
 */
export const generateFullStoryAction = enhanceAction(
  async (data): Promise<{ success: true; data?: GenerateFullStoryResponse; queued?: boolean }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.generateFullStory',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Processing story generation request');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch current episode with project info for validation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select(`
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, story_data, screenplay_data, shot_list,
        target_duration_seconds, created_at, updated_at, deleted_at,
        project:projects(id, account_id)
      `)
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !episode) {
      logger.error({ ...ctx, error: fetchError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // Check version for optimistic locking
    if (episode.version !== data.version) {
      throw new OptimisticLockError('episode');
    }

    // Validate status transition (must be in 'draft' to generate story)
    const currentStatus = episode.status as EpisodeStatus;
    if (currentStatus !== 'draft' && currentStatus !== 'story') {
      throw new Error(
        `Cannot generate story for episode in '${currentStatus}' status. Episode must be in 'draft' or 'story' status.`,
      );
    }

    const accountId = episode.project?.account_id;
    if (!accountId) {
      throw new Error('Project not found or access denied');
    }

    // Check if we're in Lambda environment (production)
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // Production: Queue for background processing
      await queueLlmJob({
        jobType: 'story-generation',
        userId: user.id,
        payload: {
          episodeId: data.episodeId,
          title: data.title,
          logline: data.logline,
          targetDuration: data.targetDuration,
          contentStyle: data.contentStyle,
          style: data.style,
          version: data.version,
          accountId,
          userId: user.id,
          projectId: episode.project_id,
        },
      });

      logger.info(ctx, 'Story generation job queued');
      return { success: true, queued: true };
    }

    // Local development: Run synchronously
    logger.info(ctx, 'Running synchronously (local dev mode)');

    const {
      buildEpisodeContext,
      formatCharactersForPrompt,
      formatLocationsForPrompt,
      formatPreviousEpisodesForPrompt,
      formatRecurringElementForPrompt,
      formatBeatsForPrompt,
    } = await import('./context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId);

    // Calculate content scaling based on target duration
    const contentStyle: ContentStyle = data.contentStyle ?? 'dialogue-heavy';
    const scaling = calculateContentScaling({
      targetDurationSeconds: data.targetDuration,
      contentStyle,
      genre: episodeContext.genre,
    });

    // Prepare variables for prompt template
    const variables = {
      title: data.title,
      logline: data.logline,
      premise: episodeContext.premise,
      target_duration: data.targetDuration,
      duration_description: formatDuration(data.targetDuration),
      word_count_min: scaling.story.wordCountMin,
      word_count_max: scaling.story.wordCountMax,
      estimated_scene_count_min: scaling.screenplay.sceneCountMin,
      estimated_scene_count_max: scaling.screenplay.sceneCountMax,
      content_style: contentStyle,
      characters: formatCharactersForPrompt(episodeContext.characters),
      locations: formatLocationsForPrompt(episodeContext.locations),
      season_context: episodeContext.seasonPremise
        ? `This is Episode ${episodeContext.episodeNumber} of Season ${episodeContext.seasonNumber}. Season Premise: ${episodeContext.seasonPremise}`
        : '',
      previous_episodes: formatPreviousEpisodesForPrompt(
        episodeContext.previousEpisodes,
      ),
      genre: episodeContext.genre,
      target_audience: episodeContext.targetAudience,
      visual_style: episodeContext.visualStyle,
      style: data.style ?? 'balanced',
      recurring_element: formatRecurringElementForPrompt(
        episodeContext.recurringElement,
      ),
      plot_beats: formatBeatsForPrompt({
        synopsis: episodeContext.synopsis,
        beats: episodeContext.beats,
        moral: episodeContext.moral,
        signatureLine: episodeContext.signatureLine,
      }),
    };

    // Execute LLM with story-generation template
    const result = await executeLLM<StoryGenerationOutput>({
      templateSlug: 'story-generation/story-generation',
      variables,
      context: {
        name: 'story-generation',
        accountId,
        userId: user.id,
      },
    });

    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    // Prepare story_data for episode
    const storyData = {
      premise: data.logline,
      fullStory: result.data.story.fullText,
      generatedAt,
      generatedBy: {
        model: result.metadata.model,
        provider: result.metadata.provider,
        costCents,
      },
      title: result.data.story.title,
      actBreakdown: result.data.story.actBreakdown,
      characters: result.data.story.characters,
      themes: result.data.story.themes,
      tone: result.data.story.tone,
      estimatedSceneCount: result.data.story.estimatedSceneCount,
      targetDuration: data.targetDuration,
      contentStyle: contentStyle,
      genre: episodeContext.genre,
      targetAudience: episodeContext.targetAudience,
      videoStyle: episodeContext.visualStyle,
      episodeSummary: result.data.story.episodeSummary,
      sentimentScore: result.data.story.sentimentScore,
      keyEvents: result.data.story.keyEvents,
    };

    // Update episode with story data and change status to 'story'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedEpisode, error: updateError } = await (client as any)
      .from('episodes')
      .update({
        story_data: storyData as Json,
        status: 'story',
        target_duration_seconds: data.targetDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version)
      .is('deleted_at', null)
      .select()
      .single();

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update episode');
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new OptimisticLockError('episode');
    }

    // Create audit log
    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId,
      userId: user.id,
      action: 'update',
      objectType: 'episode',
      objectId: episode.id,
      objectName: episode.title,
      before: episode,
      after: updatedEpisode,
      scopes: [
        { type: 'account', id: accountId },
        { type: 'project', id: episode.project_id },
        { type: 'episode', id: episode.id },
      ],
      metadata: {
        operation: 'story_generation',
        costCents,
        tokensUsed: result.metadata.tokens,
      },
      ...networkContext,
    });

    logger.info(
      {
        ...ctx,
        provider: result.metadata.provider,
        wordCount: result.data.story.fullText.split(/\s+/).length,
      },
      'Full story generated and episode updated',
    );

    revalidatePath('/home/[account]/projects/[id]', 'page');

    return {
      success: true,
      data: {
        story: result.data.story,
        episode: {
          id: updatedEpisode.id,
          status: updatedEpisode.status,
          version: updatedEpisode.version,
        },
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
    schema: GenerateFullStorySchema,
  },
);
