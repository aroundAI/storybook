/**
 * Season Outliner Skill
 *
 * Wraps season outline generation as an agent-callable tool.
 * The Season Outliner generates cohesive multi-episode outlines with
 * distinct conflicts, escalating stakes, and character arcs across
 * the entire season.
 *
 * Used by the Season Orchestrator to produce the initial episode
 * outline batch, and again for targeted revisions when the Arc
 * Evaluator identifies weak episodes.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

/** The neighbouring outlines the job carried, or none. */
function neighbouringFrom(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface EpisodeOutline {
  number: number;
  title: string;
  synopsis: string;
  beats: Array<{ label: string; content: string }>;
  moral?: string;
  signatureLine?: string;
  characterNames?: string[];
  locationNames?: string[];
  tags?: string[];
}

const generateSeasonOutlineTool = createTool({
  name: 'generateSeasonOutline',
  description:
    'Generates episode outlines for a full season. Each outline includes title, synopsis, story beats, optional moral/signature line, and tagged characters/locations. Pass revision context via recurringElements if the Arc Evaluator identified weak episodes to fix.',
  parameters: z.object({
    seasonPremise: z
      .string()
      .describe('The overarching season premise or logline'),
    episodeCount: z
      .number()
      .describe('Number of episodes to generate outlines for'),
    startingNumber: z
      .number()
      .describe('Starting episode number (e.g. 1 for a new season)'),
    genre: z
      .string()
      .describe('Content genre (detective, comedy, drama, etc.)'),
    style: z
      .string()
      .default('cinematic')
      .describe('Visual/narrative style for the season'),
    existingCharacters: z
      .string()
      .default('No characters defined yet.')
      .describe(
        'Pre-formatted character context. Pass verbatim from project data.',
      ),
    existingLocations: z
      .string()
      .default('No locations defined yet.')
      .describe(
        'Pre-formatted location context. Pass verbatim from project data.',
      ),
    recurringElements: z
      .string()
      .default('')
      .describe(
        'Recurring episode elements or revision context from Arc Evaluator (e.g. weak episode fixes).',
      ),
  }),

  execute: async (
    {
      seasonPremise,
      episodeCount,
      startingNumber,
      genre,
      style,
      existingCharacters,
      existingLocations,
      recurringElements,
    },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      // `season-outline` wraps its array under `wrapper_key: "episodes"`, so
      // executeLLM returns the array itself (KB-115).
      const result = await executeLLM<EpisodeOutline[]>({
        templateSlug: 'season-outline',
        variables: {
          season_premise: seasonPremise,
          episode_count: episodeCount,
          starting_number: startingNumber,
          genre,
          style,
          existing_characters: existingCharacters,
          existing_locations: existingLocations,
          recurring_element: recurringElements,
          // From the job, not the LLM's tool arguments (KB-121)
          surrounding_episodes: neighbouringFrom(
            context?._neighbouringEpisodes,
          ),
        },
        context: {
          name: 'agent.seasonOutliner.generateSeasonOutline',
          accountId: context.accountId,
        },
      });

      const episodes = result.data;

      return toolSuccess({
        episodes,
        count: episodes.length,
      });
    } catch (error) {
      return toolError(
        `Season outline generation failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep count and titles, drop full synopsis/beats per episode
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const episodes = d.episodes as EpisodeOutline[] | undefined;
    return {
      success: true,
      count: d.count,
      titles: episodes?.map((ep) => ep.title) ?? [],
    };
  },
});

export const seasonOutlinerSkill: Skill = {
  name: 'season-outliner',
  description:
    'Generates cohesive multi-episode season outlines with distinct conflicts, escalating stakes, and character arcs. Can be called for initial generation or targeted revision of weak episodes.',
  tools: [generateSeasonOutlineTool],
  contextPrompt: `You are the Season Outliner — an expert showrunner who designs cohesive multi-episode arcs.

Your season outlines always:
- Give each episode a distinct central conflict that avoids repetition across the season
- Escalate stakes progressively — early episodes establish, middle episodes complicate, late episodes resolve
- Track character arcs across episodes so growth feels earned, not sudden
- Plant season-level setups in early episodes that pay off in later ones
- Balance standalone episode satisfaction with overarching season momentum`,
  instructions: `1. Call generateSeasonOutline with the full season premise and all project context (characters, locations, recurring elements)
2. Report back the complete episodes array with count
3. Season outlines must have distinct episode conflicts that avoid repetition — each episode needs its own unique central tension
4. If the Orchestrator provides revision context via recurringElements, regenerate with targeted fixes`,
};
