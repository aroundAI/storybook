/**
 * Ideation Director Skill
 *
 * Wraps story ideation as an agent-callable tool.
 * The Ideation Director generates diverse story concepts with strong hooks,
 * clear conflicts, and visual potential for a given premise.
 *
 * Supports partial regeneration: when weakIndices are provided, only the
 * ideas at those positions are regenerated (keeping strong ideas intact).
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface IdeaResult {
  ideas: Array<{
    title: string;
    logline: string;
    hook: string;
    conflict: string;
    themes: string[];
    visualPotential: string;
  }>;
}

/**
 * Tool: Generate Ideas
 *
 * Generates story ideas from a premise, genre, and audience context.
 * Optionally accepts weakIndices to regenerate only specific ideas.
 */
const generateIdeasTool = createTool({
  name: 'generateIdeas',
  description:
    'Generates story ideas for an episode based on a premise. Each idea includes a title, logline, hook, conflict, themes, and visual potential. Accepts optional weakIndices (JSON string of idea indices) to regenerate only weak ideas while preserving strong ones.',
  parameters: z.object({
    premise: z.string().describe('The story premise or topic to ideate on'),
    numberOfIdeas: z.number().default(3).describe('How many ideas to generate'),
    genre: z
      .string()
      .describe('Content genre (detective, romance, sci-fi, etc.)'),
    targetAudience: z.string().describe('Target audience description'),
    charactersContext: z
      .string()
      .optional()
      .default('')
      .describe('Pre-formatted character context from context-builder'),
    locationsContext: z
      .string()
      .optional()
      .default('')
      .describe('Pre-formatted location context from context-builder'),
    seasonContext: z
      .string()
      .optional()
      .default('')
      .describe('Season and episode number context string'),
    previousEpisodes: z
      .string()
      .optional()
      .default('')
      .describe('Summary of previous episodes for continuity'),
    visualStyle: z
      .string()
      .optional()
      .default('')
      .describe('Project visual style from project metadata'),
    recurringElements: z
      .string()
      .optional()
      .default('')
      .describe(
        'Recurring episode elements from project settings (e.g. ending pattern). Pass verbatim.',
      ),
    weakIndices: z
      .string()
      .optional()
      .describe(
        'JSON string of idea indices to regenerate (e.g. "[0, 2]"). Only those ideas are replaced; strong ideas are preserved.',
      ),
  }),

  execute: async (
    {
      premise,
      numberOfIdeas,
      genre,
      targetAudience,
      charactersContext,
      locationsContext,
      seasonContext,
      previousEpisodes,
      visualStyle,
      recurringElements,
      weakIndices,
    },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<IdeaResult>({
        templateSlug: 'story-ideation',
        variables: {
          premise,
          number_of_ideas: numberOfIdeas,
          genre,
          target_audience: targetAudience,
          characters: charactersContext ?? '',
          locations: locationsContext ?? '',
          season_context: seasonContext ?? '',
          previous_episodes: previousEpisodes ?? '',
          visual_style: visualStyle ?? '',
          style: 'balanced',
          recurring_element: recurringElements ?? '',
          ...(weakIndices ? { weak_indices: weakIndices } : {}),
        },
        context: {
          name: 'agent.ideationDirector.generateIdeas',
          accountId: context.accountId,
        },
      });

      const ideas = result.data.ideas;

      return toolSuccess({
        ideas,
        count: ideas.length,
        wasRegeneration: !!weakIndices,
        summary: `Generated ${ideas.length} story ideas: ${ideas.map((i) => `"${i.title}"`).join(', ')}`,
      });
    } catch (error) {
      return toolError(`Ideation Director failed: ${(error as Error).message}`);
    }
  },

  // OPT-2: Compact summary for conversation history
  // Replaces full idea objects with count + titles
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const ideas = d.ideas as Array<{ title: string }> | undefined;
    return {
      success: true,
      count: d.count,
      titles: ideas?.map((i) => i.title) ?? [],
      wasRegeneration: d.wasRegeneration,
      summary: d.summary,
    };
  },
});

export const ideationDirectorSkill: Skill = {
  name: 'ideation-director',
  description:
    'Generates diverse story concepts with strong hooks and clear conflicts. Can generate a full set of ideas or regenerate only weak ones when given weakIndices.',
  tools: [generateIdeasTool],
  contextPrompt: `You are the Ideation Director — an expert at generating diverse, compelling story concepts with strong hooks and clear conflicts.

Your ideas always:
- Have a specific, evocative title that hints at the story's core tension
- Include a one-sentence logline that conveys protagonist, conflict, and stakes
- Open with a hook that creates immediate curiosity or emotional engagement
- Present a clear, multi-layered conflict (internal + external)
- Suggest 2-3 thematic threads worth exploring
- Describe visual potential — what makes this idea cinematic and engaging on screen

When generating multiple ideas, ensure maximum diversity in tone, conflict type, and visual style.`,
  instructions: `1. Call generateIdeas with the premise and all available context (characters, locations, season, previous episodes, recurring elements)
2. Report back the full set of ideas with titles, loglines, hooks, conflicts, themes, and visual potential
3. For regeneration: include weakIndices to replace only the weak ideas while preserving strong ones
4. Ensure each idea is distinct in tone, conflict type, and visual approach`,
};
