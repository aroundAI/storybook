/**
 * Story Ideation Handler
 *
 * Generates story ideas based on a premise.
 * Uses the Ideation Orchestrator for quality-gated idea generation:
 *   generateIdeas → evaluateIdeas → regenerate weak (max 1 cycle)
 *
 * Uses buildEpisodeContext for rich context (same as local server action).
 * No database writes — returns ideas to frontend via WebSocket.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatLocationsForPrompt,
  formatRecurringElementsForPrompt,
  formatVerifiedFactsForPrompt,
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
  qualityScore?: number;
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
      orchestratorSteps?: number;
    };
  };
}

export async function processStoryIdeation(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<StoryIdeationResult> {
  const data = payload as StoryIdeationPayload;

  console.log(
    `[Story Ideation] Starting AGENTIC pipeline for episode ${data.episodeId}`,
  );

  // 1. Build rich context using shared context-builder (matches local server action)
  const episodeContext = await buildEpisodeContext(data.episodeId, supabase);

  const seasonContext = episodeContext.seasonPremise
    ? `This is Episode ${episodeContext.episodeNumber}${episodeContext.seasonNumber ? ` of Season ${episodeContext.seasonNumber}` : ''}. Season Premise: ${episodeContext.seasonPremise}`
    : undefined;
  const directionNotes = episodeContext.seasonDirectionNotes
    ? `\n\n## SEASON CREATIVE DIRECTION (apply to this episode):\n${episodeContext.seasonDirectionNotes}`
    : '';

  const previousEpisodesContext =
    episodeContext.previousEpisodes.length > 0
      ? `Previous episodes in this season: ${episodeContext.previousEpisodes.map((ep) => `Ep${ep.number}: "${ep.title}"`).join(', ')}`
      : undefined;

  // 2. Run the Ideation Orchestrator
  const { runIdeationOrchestrator } = await import(
    '@kit/episodes/agent/ideation-orchestrator'
  );

  // Format verified facts for factual content types
  const verifiedFactsContext =
    episodeContext.verifiedFacts.length > 0
      ? formatVerifiedFactsForPrompt(episodeContext.verifiedFacts)
      : undefined;

  const orchestratorResult = await runIdeationOrchestrator({
    episodeId: data.episodeId,
    premise: data.premise || episodeContext.premise,
    numberOfIdeas: data.numberOfIdeas || 3,
    genre: episodeContext.genre ?? 'general',
    targetAudience: episodeContext.targetAudience ?? 'general',
    accountId: data.accountId,
    contentType: episodeContext.projectType,
    verifiedFactsContext,
    charactersContext: formatCharactersForPrompt(episodeContext.characters),
    locationsContext: formatLocationsForPrompt(episodeContext.locations),
    seasonContext: (seasonContext || directionNotes) ? (seasonContext ?? '') + directionNotes : undefined,
    previousEpisodesContext,
    visualStyle: episodeContext.visualStyle,
    recurringElementsContext: formatRecurringElementsForPrompt(
      episodeContext.recurringElements,
    ),
  });

  if (!orchestratorResult.success) {
    throw new Error(
      `Ideation Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
    );
  }

  const generatedAt = new Date().toISOString();

  console.log(
    `[Story Ideation] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, Ideas: ${orchestratorResult.ideas.length}`,
  );

  return {
    success: true,
    data: {
      ideas: orchestratorResult.ideas,
      metadata: {
        provider: 'orchestrator',
        model: 'multi-agent',
        costCents: 0,
        tokensUsed: 0,
        generatedAt,
        orchestratorSteps: orchestratorResult.orchestratorSteps,
      },
    },
  };
}
