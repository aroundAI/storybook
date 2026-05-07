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
    recurringElement: z
      .string()
      .optional()
      .describe(
        'Recurring episode element from project settings (e.g. ending pattern: "Each episode ends with Dante writing a note in his detective journal"). Pass verbatim — the story MUST honour this pattern.',
      ),
  }),

  execute: async ({
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
    viralGoals,
    revisionInstructions,
    existingStoryText,
    recurringElement,
  }) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      // Build the full prompt variables, injecting revision context if provided
      const promptContext = revisionInstructions
        ? `\n\n--- REVISION INSTRUCTIONS ---\n${revisionInstructions}${existingStoryText ? `\n\n--- EXISTING STORY TO REVISE ---\n${existingStoryText}` : ''}`
        : '';

      const minutesDuration = Math.round(targetDurationSeconds / 60);
      const wordCountMin = minutesDuration * 120;
      const wordCountMax = minutesDuration * 180;
      const sceneCountMin = Math.max(3, Math.floor(minutesDuration / 1.5));
      const sceneCountMax = Math.max(5, Math.ceil(minutesDuration));

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
          style: 'balanced',
          recurring_element: recurringElement ?? '',
          canon_context: '',
          plot_beats: '',
          // Inject viral goals if provided
          ...(viralGoals ? { viral_goals: viralGoals } : {}),
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
});

export const storyDirectorSkill: Skill = {
  name: 'story-director',
  description:
    'Generates and revises story narratives. Can be called with a full brief for initial generation, or with targeted revision instructions to fix specific viral weaknesses identified by the Viral Analyst.',
  tools: [generateStoryTool],
  contextPrompt: `You are the Story Director — an expert screenwriter who thinks in hooks, emotional arcs, and compelling genre narratives.

Your stories always:
- Open mid-conflict or with a jarring anomaly (never with backstory)
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
