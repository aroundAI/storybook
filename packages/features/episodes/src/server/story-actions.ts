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
 * Does not modify any database records - purely generative.
 *
 * @throws {Error} If LLM call fails or output validation fails
 */
export const generateStoryIdeasAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data: GenerateStoryIdeasResponse }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.generateStoryIdeas' };

    logger.info(ctx, 'Generating story ideas');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story ideation attempt');
      throw new Error('Authentication required');
    }

    // Get user's account for cost tracking and authorization
    // User must belong to at least one account to use LLM features
    const { data: accountMemberships } = await client
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', user.id)
      .limit(1);

    if (!accountMemberships?.length) {
      // Fallback to personal account (where user is primary owner)
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

    // Build rich context for episode (Phase 1: Context Builder)
    const {
      buildEpisodeContext,
      formatCharactersForPrompt,
      formatLocationsForPrompt,
      formatRecurringElementForPrompt,
    } = await import('./context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId);

    // Prepare variables for prompt template (matching template variable names)
    const variables = {
      premise: episodeContext.premise,
      number_of_ideas: data.numberOfIdeas,

      // Characters MUST appear in all ideas
      characters: formatCharactersForPrompt(episodeContext.characters),

      // Locations MUST be used
      locations: formatLocationsForPrompt(episodeContext.locations),

      // Season arc for thematic alignment
      season_context: episodeContext.seasonPremise
        ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
        : '',

      // Continuity constraints
      previous_episodes:
        episodeContext.previousEpisodes.length > 0
          ? `Previous episodes in this season: ${episodeContext.previousEpisodes.map((ep) => `Ep${ep.number}: "${ep.title}"`).join(', ')}`
          : '',

      genre: episodeContext.genre,
      target_audience: episodeContext.targetAudience,
      visual_style: episodeContext.visualStyle,
      style: 'balanced', // Default style

      // Recurring story element (from project settings)
      recurring_element: formatRecurringElementForPrompt(
        episodeContext.recurringElement,
      ),
    };

    logger.info(
      {
        ...ctx,
        variables: { ...variables, premise: data.premise.substring(0, 50) },
      },
      'Executing story ideation prompt',
    );

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
 * Updates the episode's story_data JSONB field and changes status to 'story'.
 *
 * @throws {Error} If episode not found, LLM fails, validation fails, or optimistic lock fails
 */
export const generateFullStoryAction = enhanceAction(
  async (data): Promise<{ success: true; data: GenerateFullStoryResponse }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'episodes.generateFullStory',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Generating full story');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized story generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch current episode with project info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: fetchError } = await (client as any)
      .from('episodes')
      .select('*, project:projects(id, account_id)')
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

      // Content scaling - word count
      word_count_min: scaling.story.wordCountMin,
      word_count_max: scaling.story.wordCountMax,

      // Content scaling - estimated scene count (for story generation)
      estimated_scene_count_min: scaling.screenplay.sceneCountMin,
      estimated_scene_count_max: scaling.screenplay.sceneCountMax,

      // Content style
      content_style: contentStyle,

      // Rich character context
      characters: formatCharactersForPrompt(episodeContext.characters),

      // Rich location context
      locations: formatLocationsForPrompt(episodeContext.locations),

      // Season arc
      season_context: episodeContext.seasonPremise
        ? `This is Episode ${episodeContext.episodeNumber} of Season ${episodeContext.seasonNumber}. Season Premise: ${episodeContext.seasonPremise}`
        : '',

      // Continuity
      previous_episodes: formatPreviousEpisodesForPrompt(
        episodeContext.previousEpisodes,
      ),

      genre: episodeContext.genre,
      target_audience: episodeContext.targetAudience,
      visual_style: episodeContext.visualStyle,
      style: data.style ?? 'balanced',

      // Recurring story element (from project settings)
      recurring_element: formatRecurringElementForPrompt(
        episodeContext.recurringElement,
      ),

      // Plot beats from roadmap extraction (synopsis, beats, moral, signature line)
      plot_beats: formatBeatsForPrompt({
        synopsis: episodeContext.synopsis,
        beats: episodeContext.beats,
        moral: episodeContext.moral,
        signatureLine: episodeContext.signatureLine,
      }),
    };

    logger.info(
      { ...ctx, title: data.title, targetDuration: data.targetDuration },
      'Executing story generation prompt',
    );

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

    // Cost is in USD, convert to cents
    const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
    const generatedAt = new Date().toISOString();

    // Prepare story_data for episode (matching StoryData interface)
    const storyData = {
      // Core content from input and LLM output
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

      // Persist generation settings for downstream steps (screenplay, shot-list)
      targetDuration: data.targetDuration,
      contentStyle: contentStyle,
      genre: episodeContext.genre,
      targetAudience: episodeContext.targetAudience,
      videoStyle: episodeContext.visualStyle,

      // SCORE Framework fields (for episode continuity)
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
        target_duration_seconds: data.targetDuration, // Persist for screenplay/shot-list
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
        model: result.metadata.model,
        costCents,
        tokensUsed: result.metadata.tokens,
        wordCount: result.data.story.fullText.split(/\s+/).length,
        newVersion: updatedEpisode.version,
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
