/**
 * Story Orchestrator
 *
 * Stage 1 of the 3-stage content generation pipeline.
 * Runs the story quality loop: generate → evaluate → revise → validate canon.
 *
 * Skills:
 *   - Story Director    (generateStory)    — write / revise narrative
 *   - Viral Analyst     (evaluateContent)  — score against 7 viral dimensions
 *   - Continuity Guardian (buildMemoryContext → checkContinuity) — validate canon
 *
 * Does NOT run screenplay or shots — those are separate stages.
 * maxSteps: 8 — worst-case story(1)+viral(1)+continuity(2)+revision(1)+rescore(1) = 6
 *
 * After this stage:
 *   - story_data written to DB
 *   - viral_quality written to DB
 *   - episode status → 'story'
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import type { EpisodeViralQuality, ViralDimensionScores } from '../lib/types';
import { continuitySkill } from './skills/continuity-skill';
import { storyDirectorSkill } from './skills/story-director-skill';
import { viralAnalystSkill } from './skills/viral-analyst-skill';

export interface StoryOrchestratorInput {
  episodeId: string;
  episodeTitle: string;
  episodeLogline: string;
  genre: string;
  targetAudience: string;
  targetDurationSeconds: number;
  contentStyle?: 'dialogue-heavy' | 'balanced' | 'action-heavy';
  projectId: string;
  episodeNumber: number;
  accountId: string;
  // Pre-formatted context blocks from context-builder
  charactersContext: string;
  locationsContext: string;
  seasonContext?: string;
  previousEpisodesContext?: string;
  visualStyle?: string;
  // Recurring element from project settings (e.g. episode ending pattern)
  recurringElementContext?: string;
}

export interface StoryOrchestratorResult {
  success: boolean;
  viralQuality: EpisodeViralQuality | null;
  storyText?: string;
  // Full story metadata for DB write
  storyTitle?: string;
  actBreakdown?: { act1: string; act2: string; act3: string };
  storyCharacters?: Array<{ name: string; role: string; arc: string }>;
  themes?: string[];
  tone?: string;
  estimatedSceneCount?: number;
  episodeSummary?: string;
  sentimentScore?: number;
  keyEvents?: string[];
  viralStructure?: Record<string, unknown>;
  orchestratorSteps: number;
  error?: string;
}

interface StoryOrchestratorOutput {
  overallScore: number;
  decision: 'pass' | 'revised' | 'flag';
  whyThisWorks: string;
  whatToImprove: string;
  dimensionScores: ViralDimensionScores;
  revisionsApplied: string[];
  finalStoryText?: string;
}

/**
 * Runs the Story stage orchestrator for an episode.
 * Coordinates Story Director → Viral Analyst → Continuity Guardian.
 * Stops once story quality is acceptable (score ≥ 0.65 OR 1 revision applied).
 */
export async function runStoryOrchestrator(
  input: StoryOrchestratorInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
): Promise<StoryOrchestratorResult> {
  console.log(`[Story Orchestrator] Starting for episode ${input.episodeId}`);

  const result: AgentRunResult<StoryOrchestratorOutput> =
    await runAgent<StoryOrchestratorOutput>(
      {
        name: 'story-orchestrator',
        systemPrompt: STORY_SYSTEM_PROMPT,
        tools: [],
        skills: [storyDirectorSkill, viralAnalystSkill, continuitySkill],
        maxSteps: 8,
        budgetLimits: {
          maxTotalTokens: 200_000,
          maxCostUSD: 2.0,
          maxLatencyMs: 300_000,
        },
      },
      {
        userPrompt: buildStoryPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Story Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      viralQuality: null,
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  const output = result.data;

  // Extract story data from tool steps (more reliable than LLM synthesis for large text)
  type GenerateStoryResult = {
    storyText?: string;
    title?: string;
    actBreakdown?: { act1: string; act2: string; act3: string };
    characters?: Array<{ name: string; role: string; arc: string }>;
    themes?: string[];
    tone?: string;
    estimatedSceneCount?: number;
    episodeSummary?: string;
    sentimentScore?: number;
    keyEvents?: string[];
    viralStructure?: Record<string, unknown>;
  };
  const storyStep = result.steps.findLast(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateStory' &&
      s.toolResult?.success,
  );
  const storyStepData = storyStep?.toolResult?.data as
    | GenerateStoryResult
    | undefined;
  const storyTextFromSteps = storyStepData?.storyText;
  const resolvedStoryText = storyTextFromSteps ?? output.finalStoryText;

  console.log(
    `[Story Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Story: ${resolvedStoryText?.split(/\s+/).length ?? 0} words, ` +
      `Viral score: ${output.overallScore ?? 'N/A'}`,
  );

  const viralQuality: EpisodeViralQuality = {
    overallScore: output.overallScore,
    decision: output.decision,
    whyThisWorks: output.whyThisWorks,
    whatToImprove: output.whatToImprove,
    dimensionScores: output.dimensionScores,
    revisionsApplied: output.revisionsApplied,
    orchestratorSteps: result.steps.length,
    reelCandidates: [],
  };

  // Persist viral_quality to the episode
  try {
    const { error } = await supabase
      .from('episodes')
      .update({ viral_quality: viralQuality })
      .eq('id', input.episodeId);

    if (error) {
      console.warn(
        `[Story Orchestrator] Failed to persist viral_quality: ${(error as { message: string }).message}`,
      );
    } else {
      console.log(
        `[Story Orchestrator] viral_quality persisted. Score: ${viralQuality.overallScore}, Decision: ${viralQuality.decision}`,
      );
    }
  } catch (err) {
    console.warn('[Story Orchestrator] Persist error (non-fatal):', err);
  }

  return {
    success: true,
    viralQuality,
    storyText: resolvedStoryText,
    storyTitle: storyStepData?.title,
    actBreakdown: storyStepData?.actBreakdown,
    storyCharacters: storyStepData?.characters,
    themes: storyStepData?.themes,
    tone: storyStepData?.tone,
    estimatedSceneCount: storyStepData?.estimatedSceneCount,
    episodeSummary: storyStepData?.episodeSummary,
    sentimentScore: storyStepData?.sentimentScore,
    keyEvents: storyStepData?.keyEvents,
    viralStructure: storyStepData?.viralStructure,
    orchestratorSteps: result.steps.length,
  };
}

const STORY_SYSTEM_PROMPT = `You are the Story Pipeline Director — a focused quality loop for story generation.

You coordinate three specialist agents to produce a high-quality story:

1. **Story Director** (generateStory) — Creates/revises narrative with character context.
2. **Viral Analyst** (evaluateContent) — Scores story on 7 viral dimensions. Returns overallScore and revision priorities.
3. **Continuity Guardian** (buildMemoryContext → checkContinuity) — Validates story against established canon.

## Your Decision Logic

1. ALWAYS start with Story Director. Pass characters, locations, seasonContext, previousEpisodes, and recurringElement verbatim.
2. THEN run Viral Analyst (evaluateContent) to score the story.
3. THEN run Continuity Guardian (buildMemoryContext then checkContinuity).
4. IF Viral Analyst score < 0.65 AND you haven't revised yet → call Story Director ONCE with revisionInstructions targeting the weakest dimensions. Then re-score with Viral Analyst.
5. IF Continuity Guardian finds violations with severity=error → call Story Director with targeted revisionInstructions.
6. STOP once: score ≥ 0.65 OR 1 revision cycle is complete (don't loop more than once — time budget matters).

## CRITICAL CONSTRAINTS
- Do NOT call generateScreenplay, analyzeScenes, or generateShots — those run in separate pipeline stages.
- Do NOT try to do everything perfectly — one revision loop is the maximum.
- The recurringElement MUST be passed to generateStory if provided.

## Your Final Answer

Return a JSON object with:
- overallScore (from Viral Analyst, as a number 0–1)
- decision: "pass" | "revised" | "flag"
- whyThisWorks: 2-3 sentence paragraph on viral strengths
- whatToImprove: 1-2 sentence paragraph on main weakness
- dimensionScores: { hookStrength, curiosityGap, emotionalArc, setupPayoff, dialogueSubtext, loopability, memorableMoment }
- revisionsApplied: string array of changes made (empty if no revisions)
- finalStoryText: the final story text after any revisions`;

function buildStoryPrompt(input: StoryOrchestratorInput): string {
  return `Generate and quality-check a story for this episode.

**Episode**: "${input.episodeTitle}"
**Logline**: ${input.episodeLogline}
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Duration**: ${input.targetDurationSeconds} seconds
**Content Style**: ${input.contentStyle ?? 'dialogue-heavy'}
**Episode Number**: ${input.episodeNumber}

**Character Context (pass verbatim to Story Director):**
${input.charactersContext || 'No characters defined.'}

**Location Context:**
${input.locationsContext || 'No locations defined.'}

${input.seasonContext ? `**Season Context:** ${input.seasonContext}` : ''}
${input.previousEpisodesContext ? `**Previous Episodes:** ${input.previousEpisodesContext}` : ''}
${
  input.recurringElementContext
    ? `
**Recurring Episode Element (MANDATORY — pass verbatim to generateStory as recurringElement):**
${input.recurringElementContext}
`
    : ''
}

Begin with Story Director. Pass all context verbatim. Evaluate with Viral Analyst. Check continuity. Apply one revision if needed. Stop.

Goal: story scores ≥ 0.65 viral with no continuity errors.`;
}
