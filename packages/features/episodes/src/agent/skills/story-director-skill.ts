/**
 * Story Director Skill
 *
 * Wraps story generation as agent-callable tools.
 * The Story Director generates narrative content, and can be called with:
 * - Full episode brief (generate from scratch)
 * - Targeted revision instructions (revise only specific scenes/elements)
 *
 * This allows the Orchestrator to surgically fix weak points
 * without re-running the entire story pipeline.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

/**
 * Tool: Generate Story
 *
 * Generates a full story narrative from an episode brief.
 * Optionally accepts viral goals and revision instructions from the Orchestrator.
 */
const generateStoryTool = createTool({
  name: 'generateStory',
  description:
    'Generates a full story narrative for an episode. Accepts title, logline, genre, targetDuration, and optional viral goals to optimize for. Also accepts revisionInstructions if the Orchestrator wants the Story Director to revise a specific aspect (e.g. "Strengthen the opening hook — it currently lacks an anomaly or conflict in the first moment").',
  parameters: z.object({
    title: z.string().describe('Episode title'),
    logline: z.string().describe('One-sentence episode logline / premise'),
    genre: z.string().describe('Content genre'),
    targetAudience: z.string().describe('Target audience'),
    targetDurationSeconds: z
      .number()
      .describe('Target episode duration in seconds'),
    contentStyle: z
      .enum(['dialogue-heavy', 'balanced', 'action-heavy'])
      .default('dialogue-heavy')
      .describe('Content balance style'),
    characters: z
      .string()
      .optional()
      .describe(
        'Pre-formatted LOCKED IDENTITY character context from formatCharactersForPrompt. Pass verbatim — identities are non-negotiable.',
      ),
    locations: z
      .string()
      .optional()
      .describe(
        'Pre-formatted location context from formatLocationsForPrompt.',
      ),
    seasonContext: z
      .string()
      .optional()
      .describe('Season and episode number context string'),
    previousEpisodes: z
      .string()
      .optional()
      .describe('Summary of previous episodes for continuity'),
    visualStyle: z
      .string()
      .optional()
      .describe('Project visual style from project metadata'),
    ideationThemes: z
      .string()
      .optional()
      .describe(
        'Comma-separated themes from ideation that should guide story thematic direction',
      ),
    ideationHook: z
      .string()
      .optional()
      .describe(
        'Narrative hook from ideation — the unique angle that makes this story compelling',
      ),
    visualDirection: z
      .string()
      .optional()
      .describe(
        'Visual storytelling direction from ideation — how this story works visually',
      ),
    viralGoals: z
      .string()
      .optional()
      .describe(
        'Viral storytelling goals from the Orchestrator (e.g. "prioritize curiosity gap — end Act 1 with a withheld fact")',
      ),
    revisionInstructions: z
      .string()
      .optional()
      .describe(
        'Targeted revision instructions from the Orchestrator based on Viral Analyst feedback.',
      ),
    existingStoryText: z
      .string()
      .optional()
      .describe(
        'Existing story text to revise. If provided, the director revises rather than generating from scratch.',
      ),
    recurringElements: z
      .string()
      .optional()
      .describe(
        'Recurring episode elements from project settings (e.g. ending pattern: "Each episode ends with Dante writing a note in his detective journal"). Pass verbatim — the story MUST honour these patterns.',
      ),
  }),

  execute: async (
    {
      title,
      logline,
      genre,
      targetAudience,
      targetDurationSeconds,
      contentStyle,
      characters,
      locations,
      seasonContext,
      previousEpisodes,
      visualStyle,
      ideationThemes,
      ideationHook,
      visualDirection,
      viralGoals,
      revisionInstructions,
      existingStoryText,
      recurringElements,
    },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/ai-gateway');

      // Build the full prompt variables, injecting revision context if provided
      const promptContext = revisionInstructions
        ? `\n\n--- REVISION INSTRUCTIONS ---\n${revisionInstructions}${existingStoryText ? `\n\n--- EXISTING STORY TO REVISE ---\n${existingStoryText}` : ''}`
        : '';

      const { calculateContentScaling } = await import(
        '../../lib/duration-scaling'
      );
      const minutesDuration = Math.round(targetDurationSeconds / 60);
      const scaling = calculateContentScaling({
        targetDurationSeconds,
        contentStyle,
      });
      const wordCountMin = scaling.story.wordCountMin;
      const wordCountMax = scaling.story.wordCountMax;
      const sceneCountMin = scaling.screenplay.sceneCountMin;
      const sceneCountMax = scaling.screenplay.sceneCountMax;

      const result = await executeLLM<{
        story: {
          fullText: string;
          title: string;
          actBreakdown: { act1: string; act2: string; act3: string };
          characters: Array<{ name: string; role: string; arc: string }>;
          themes: string[];
          tone: string;
          estimatedSceneCount: number;
          episodeSummary: string;
          sentimentScore: number;
          keyEvents: string[];
          viralStructure: {
            openingHook: string;
            curiosityGap: string;
            emotionalArc: string[];
            setupPayoffPair: { setup: string; payoff: string };
            loopBeat: string;
            memorableScene: string;
          };
        };
      }>({
        templateSlug: 'story-generation',

        variables: {
          title,
          logline: logline + promptContext,
          premise: logline,
          genre,
          target_audience: targetAudience,
          target_duration: targetDurationSeconds,
          duration_description: `${minutesDuration} minutes`,
          word_count_min: wordCountMin,
          word_count_max: wordCountMax,
          estimated_scene_count_min: sceneCountMin,
          estimated_scene_count_max: sceneCountMax,
          content_style: contentStyle,
          // Inject pre-formatted context (no longer empty)
          characters: characters ?? '',
          locations: locations ?? '',
          season_context: seasonContext ?? '',
          previous_episodes: previousEpisodes ?? '',
          visual_style: visualStyle ?? '',
          recurring_element: recurringElements ?? '',
          canon_context: '',
          plot_beats: '',
          ideation_themes: ideationThemes ?? '',
          ideation_hook: ideationHook ?? '',
          visual_direction: visualDirection ?? '',
          // The Orchestrator's viral goals (KB-126: never read before)
          viral_goals: viralGoals
            ? `**Viral Storytelling Goals**: ${viralGoals}`
            : '',
          // From the job, not the LLM's tool arguments (KB-126)
          verified_facts:
            typeof context?._verifiedFacts === 'string'
              ? context._verifiedFacts
              : '',
        },
        context: {
          name: 'agent.storyDirector.generateStory',
          accountId: '',
        },
      });

      const story = result.data.story;

      return toolSuccess({
        storyText: story.fullText,
        title: story.title,
        actBreakdown: story.actBreakdown,
        characters: story.characters,
        themes: story.themes,
        tone: story.tone,
        estimatedSceneCount: story.estimatedSceneCount,
        episodeSummary: story.episodeSummary,
        sentimentScore: story.sentimentScore,
        keyEvents: story.keyEvents,
        viralStructure: story.viralStructure,
        wasRevision: !!revisionInstructions,
        summary: `Generated story "${story.title}" — ${story.fullText.split(/\s+/).length} words, ~${story.estimatedSceneCount} scenes`,
      });
    } catch (error) {
      return toolError(`Story Director failed: ${(error as Error).message}`);
    }
  },

  // OPT-2: Compact summary for conversation history
  // Replaces ~2000-4000 tokens of full story data with ~100 tokens
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      title: d.title,
      wordCount:
        typeof d.storyText === 'string'
          ? (d.storyText as string).split(/\s+/).length
          : 0,
      estimatedSceneCount: d.estimatedSceneCount,
      themes: d.themes,
      tone: d.tone,
      wasRevision: d.wasRevision,
      episodeSummary: d.episodeSummary,
      viralStructure: d.viralStructure
        ? {
            openingHook: (d.viralStructure as Record<string, string>)
              .openingHook,
            curiosityGap: (d.viralStructure as Record<string, string>)
              .curiosityGap,
          }
        : undefined,
      summary: d.summary,
    };
  },
});

export const storyDirectorSkill: Skill = {
  name: 'story-director',
  description:
    'Generates and revises story narratives. Can be called with a full brief for initial generation, or with targeted revision instructions to fix specific viral weaknesses identified by the Viral Analyst.',
  tools: [generateStoryTool],
  contextPrompt: `You are the Story Director — an expert screenwriter who thinks in hooks, emotional arcs, and compelling genre narratives.

Your stories always:
- Open according to the project's recurring elements. If a beginning element exists, honor it before the hook. Otherwise, open mid-conflict or with a jarring anomaly.
- Have a specific, urgent withheld fact driving the viewer to the finale  
- Move through 3 distinct emotional phases: intrigue → tension → catharsis
- Plant a detail in Act 1 that pays off unexpectedly in Act 3
- Let characters show emotions through behavior, not explicit statements

When given revisionInstructions, fix ONLY the identified weakness — preserve the rest of the story.`,
  instructions: `1. Call generateStory with the episode brief and any viralGoals from the Orchestrator
2. Report back the full storyText, title, themes, and tone
3. If the Orchestrator provides revisionInstructions later, call generateStory again with those instructions and the existingStoryText
4. Mark wasRevision=true so the Orchestrator tracks that a revision occurred`,
};
