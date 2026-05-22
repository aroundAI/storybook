/**
 * Story Ideation Handler
 *
 * Generates story ideas based on a premise.
 * Uses buildEpisodeContext for rich context (same as local server action).
 * No database writes - just returns ideas to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatLocationsForPrompt,
  formatRecurringElementsForPrompt,
} from '../utils/context-builder';

interface StoryIdeationPayload {
  episodeId: string;
  premise: string;
  numberOfIdeas?: number;
  accountId: string;
  userId: string;
}

interface StoryIdea {
  title: string;
  logline: string;
  hook: string;
  conflict: string;
  themes: string[];
  visualPotential: string;
}

interface StoryIdeationResult {
  success: boolean;
  data: {
    ideas: StoryIdea[];
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
    };
  };
}

export async function processStoryIdeation(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<StoryIdeationResult> {
  const data = payload as StoryIdeationPayload;

  console.log(`[Story Ideation] Processing for episode ${data.episodeId}`);

  // 1. Build rich context using shared context-builder (matches local server action)
  const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

  // 2. Prepare variables for prompt template (same logic as local server action)
  const variables = {
    premise: data.premise || episodeContext.premise,
    number_of_ideas: data.numberOfIdeas || 3,
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
    recurring_element: formatRecurringElementsForPrompt(
      episodeContext.recurringElements,
    ),
  };

  // 3. Execute LLM
  const { executeLLM } = await import('@kit/prompt-engine/server');

  const result = await executeLLM<{ ideas: StoryIdea[] }>({
    templateSlug: 'story-ideation',
    variables,
    context: {
      name: 'story-ideation',
      accountId: data.accountId,
      userId: data.userId,
    },
    supabaseClient: supabase, // Required for Lambda execution
  });

  const costCents = Math.ceil((result.metadata.cost ?? 0) * 100);
  const generatedAt = new Date().toISOString();

  console.log(`[Story Ideation] Generated ${result.data.ideas.length} ideas`);

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
}
