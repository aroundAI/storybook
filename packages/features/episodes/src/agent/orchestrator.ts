/**
 * Content Generation Orchestrator
 *
 * The Orchestrator is the top-level agent that coordinates all specialist agents
 * in a non-linear loop across ALL four content generation stages:
 *
 *   1. Story Director   — generates/revises narrative with character context
 *   2. Viral Analyst    — evaluates story viral quality (7 dimensions)
 *   3. Continuity Guardian — validates against canon
 *   4. Screenplay Director — converts to scene-by-scene screenplay
 *   5. Reel Scout       — evaluates each scene as a Reel candidate
 *   6. Shot Director    — generates VEO 3.1 shots, prioritizes reel scenes
 *
 * The Orchestrator LLM decides:
 * - Whether to revise the story before moving to screenplay
 * - Which scenes to flag for Reel Scout optimization
 * - When quality bars are met at each stage
 *
 * NOT a hardcoded pipeline — the LLM drives the flow based on quality signals.
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import type { EpisodeViralQuality, ViralDimensionScores } from '../lib/types';
import { continuitySkill } from './skills/continuity-skill';
import { reelScoutSkill } from './skills/reel-scout-skill';
import { screenplayDirectorSkill } from './skills/screenplay-director-skill';
import { shotDirectorSkill } from './skills/shot-director-skill';
import { storyDirectorSkill } from './skills/story-director-skill';
import { viralAnalystSkill } from './skills/viral-analyst-skill';

export interface OrchestratorInput {
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
  charactersVeoContext: string;
  locationsVeoContext: string;
  seasonContext?: string;
  previousEpisodesContext?: string;
  visualStyle?: string;
  // Recurring story elements (pre-formatted)
  recurringElementsContext?: string;
}

export interface OrchestratorResult {
  success: boolean;
  viralQuality: EpisodeViralQuality | null;
  storyText?: string;
  screenplay?: {
    title: string;
    scenes: unknown[];
    totalDialogueLines: number;
    estimatedDuration: number;
  };
  shots?: unknown[];
  orchestratorSteps: number;
  error?: string;
}

interface OrchestratorOutput {
  overallScore: number;
  decision: 'pass' | 'revised' | 'flag';
  whyThisWorks: string;
  whatToImprove: string;
  dimensionScores: ViralDimensionScores;
  revisionsApplied: string[];
  reelCandidates: EpisodeViralQuality['reelCandidates'];
  finalStoryText?: string;
  screenplayTitle?: string;
  screenplayScenes?: unknown[];
  screenplayDialogueLines?: number;
  shots?: unknown[];
  totalShots?: number;
}

/**
 * Runs the full content generation Orchestrator for an episode.
 *
 * Covers all 4 stages: Story → Screenplay → Shots, with viral/continuity loops.
 * Non-linear: the Orchestrator LLM decides the flow based on quality signals.
 * Max 12 agent steps to accommodate the full pipeline.
 *
 * @param input Episode details, configuration, and pre-formatted character context
 * @param supabase Supabase client for persisting results
 */
export async function runContentOrchestrator(
  input: OrchestratorInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
): Promise<OrchestratorResult> {
  console.log(
    `[Orchestrator] Starting full pipeline for episode ${input.episodeId}`,
  );

  const result: AgentRunResult<OrchestratorOutput> =
    await runAgent<OrchestratorOutput>(
      {
        name: 'content-orchestrator',
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        tools: [],
        skills: [
          storyDirectorSkill,
          viralAnalystSkill,
          continuitySkill,
          reelScoutSkill,
          screenplayDirectorSkill,
          shotDirectorSkill,
        ],
        maxSteps: 12,
        budgetLimits: {
          maxTotalTokens: 400_000,
          maxCostUSD: 5.0,
          maxLatencyMs: 600_000,
        },
      },
      {
        userPrompt: buildOrchestratorPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      viralQuality: null,
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  const output = result.data;

  // Extract data from steps (more reliable than orchestrator LLM reproducing full content
  // in its final JSON synthesis — the LLM may truncate or omit large fields like storyText).
  type GenerateStoryResult = { storyText?: string };
  type GenerateScreenplayResult = {
    title?: string;
    scenes?: unknown[];
    totalDialogueLines?: number;
  };
  type GenerateShotsResult = { shots?: unknown[] };

  const storyStep = result.steps.find(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateStory' &&
      s.toolResult?.success,
  );
  const storyTextFromSteps = (
    storyStep?.toolResult?.data as GenerateStoryResult | undefined
  )?.storyText;

  // Use the LAST successful generateScreenplay step (handles revision runs)
  const screenplaySteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateScreenplay' &&
      s.toolResult?.success,
  );
  const lastScreenplayStep = screenplaySteps.at(-1);
  const screenplayDataFromSteps = lastScreenplayStep?.toolResult?.data as
    | GenerateScreenplayResult
    | undefined;

  const shotsStep = result.steps.find(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateShots' &&
      s.toolResult?.success,
  );
  const shotsFromSteps = (
    shotsStep?.toolResult?.data as GenerateShotsResult | undefined
  )?.shots;

  console.log(
    `[Orchestrator] Extracted from steps — story: ${storyTextFromSteps ? storyTextFromSteps.split(/\s+/).length + ' words' : 'missing (will fallback to LLM synthesis)'}, ` +
      `screenplay: ${screenplayDataFromSteps?.scenes?.length ?? 0} scenes, shots: ${shotsFromSteps?.length ?? 0}`,
  );

  const viralQuality: EpisodeViralQuality = {
    overallScore: output.overallScore,
    decision: output.decision,
    whyThisWorks: output.whyThisWorks,
    whatToImprove: output.whatToImprove,
    dimensionScores: output.dimensionScores,
    revisionsApplied: output.revisionsApplied,
    orchestratorSteps: result.steps.length,
    reelCandidates: output.reelCandidates,
  };

  // Persist viral_quality to the episode
  try {
    const { error } = await supabase
      .from('episodes')
      .update({ viral_quality: viralQuality })
      .eq('id', input.episodeId);

    if (error) {
      console.warn(
        `[Orchestrator] Failed to persist viral_quality: ${(error as { message: string }).message}`,
      );
    } else {
      console.log(
        `[Orchestrator] viral_quality persisted. Score: ${viralQuality.overallScore}, Decision: ${viralQuality.decision}`,
      );
    }
  } catch (err) {
    console.warn('[Orchestrator] Persist error (non-fatal):', err);
  }

  // Resolve screenplay/shots — prefer steps extraction, fall back to orchestrator LLM synthesis
  const resolvedScreenplayScenes =
    screenplayDataFromSteps?.scenes ?? output.screenplayScenes;
  const resolvedScreenplayTitle =
    screenplayDataFromSteps?.title ?? output.screenplayTitle;
  const resolvedScreenplayDialogueLines =
    screenplayDataFromSteps?.totalDialogueLines ??
    output.screenplayDialogueLines;
  const resolvedShots =
    shotsFromSteps ?? (output.shots as unknown[] | undefined);

  // Persist screenplay_data if generated
  if (resolvedScreenplayScenes && resolvedScreenplayScenes.length > 0) {
    try {
      const screenplayData = {
        title: resolvedScreenplayTitle,
        scenes: resolvedScreenplayScenes,
        totalDialogueLines: resolvedScreenplayDialogueLines ?? 0,
        estimatedDuration: input.targetDurationSeconds,
        generatedAt: new Date().toISOString(),
        generatedBy: { orchestratorSteps: result.steps.length },
      };
      const { error } = await supabase
        .from('episodes')
        .update({ screenplay_data: screenplayData, status: 'storyboard' })
        .eq('id', input.episodeId);

      if (error) {
        console.warn(
          `[Orchestrator] Failed to persist screenplay_data: ${(error as { message: string }).message}`,
        );
      } else {
        console.log(
          `[Orchestrator] screenplay_data persisted. ${resolvedScreenplayScenes.length} scenes.`,
        );
      }
    } catch (err) {
      console.warn('[Orchestrator] Screenplay persist error (non-fatal):', err);
    }
  }

  // Persist shots if generated
  if (resolvedShots && resolvedShots.length > 0) {
    try {
      const shotsToInsert = resolvedShots.map((shot: unknown) => ({
        episode_id: input.episodeId,
        ...(shot as Record<string, unknown>),
      }));

      const { error } = await supabase.from('shots').insert(shotsToInsert);

      if (error) {
        console.warn(
          `[Orchestrator] Failed to persist shots: ${(error as { message: string }).message}`,
        );
      } else {
        console.log(`[Orchestrator] ${shotsToInsert.length} shots persisted.`);
      }
    } catch (err) {
      console.warn('[Orchestrator] Shots persist error (non-fatal):', err);
    }
  }

  return {
    success: true,
    viralQuality,
    storyText: storyTextFromSteps ?? output.finalStoryText,
    screenplay: resolvedScreenplayScenes?.length
      ? {
          title: resolvedScreenplayTitle ?? '',
          scenes: resolvedScreenplayScenes as unknown[],
          totalDialogueLines: resolvedScreenplayDialogueLines ?? 0,
          estimatedDuration: input.targetDurationSeconds,
        }
      : undefined,
    shots: resolvedShots,
    orchestratorSteps: result.steps.length,
  };
}

// =============================================================================
// PROMPTS
// =============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Content Generation Orchestrator — the director of a multi-agent creative production system.

You coordinate six specialist agents across four content generation stages:

**STAGE 1: STORY**
1. **Story Director** (generateStory) — Creates/revises narrative. MUST receive the characters and locations context verbatim. Can be called with targeted revisionInstructions to fix specific weaknesses without regenerating the whole story.
2. **Viral Analyst** (evaluateContent) — Scores content on 7 viral dimensions. Returns whyThisWorks, whatToImprove, and topPriorities.
3. **Continuity Guardian** (buildMemoryContext → checkContinuity) — Validates the story against established canon.

**STAGE 2: SCREENPLAY**
4. **Screenplay Director** (generateScreenplay) — Converts the finalized story into scene-by-scene screenplay format. Pass the full characters context block verbatim.

**STAGE 3: REEL ANALYSIS**
5. **Reel Scout** (analyzeScenes) — Evaluates each scene as a standalone Reel/Shorts candidate. Returns per-scene reasoning and top candidate scene numbers.

**STAGE 4: SHOTS**
6. **Shot Director** (generateShots) — Generates VEO 3.1 optimized shots for all scenes. Pass reelCandidateScenes from Reel Scout to prioritize hook shots.

## Your Decision Logic

**Full pipeline flow:**

1. ALWAYS start with Story Director (generateStory) — pass characters and locations context verbatim
2. THEN run Viral Analyst + Continuity Guardian in parallel (conceptually)
3. IF Viral Analyst score < 0.65 AND you haven't revised yet → call Story Director with revisionInstructions targeting weakest dimensions
4. IF Continuity Guardian finds violations with severity=error → call Story Director with revisionInstructions
5. ONCE story quality is acceptable (score ≥ 0.65 OR 1 revision applied) → call Screenplay Director with the finalized story
6. After screenplay is generated → call Reel Scout with all scenes
7. THEN call Shot Director with scenes + reelCandidateScenes from Reel Scout
8. Synthesize final output using all agent results

## Your Final Answer

When complete, return a JSON object with:
- overallScore (from Viral Analyst)
- decision: "pass" | "revised" | "flag"
- whyThisWorks: 2-3 sentence paragraph explaining viral strengths
- whatToImprove: 1-2 sentence paragraph on the main weakness
- dimensionScores: object with all 7 dimension scores (hookStrength, curiosityGap, emotionalArc, setupPayoff, dialogueSubtext, loopability, memorableMoment)
- revisionsApplied: array of strings describing changes made (empty if no revisions)
- reelCandidates: array from Reel Scout (sceneNumber, whyThisWorksAsReel, hookType, viralScore, estimatedDurationSeconds)
- finalStoryText: the final story text after any revisions
- screenplayTitle: the screenplay title from Screenplay Director
- screenplayScenes: the scenes array from Screenplay Director
- screenplayDialogueLines: total dialogue lines from Screenplay Director
- shots: the shots array from Shot Director
- totalShots: total number of shots generated`;

function buildOrchestratorPrompt(input: OrchestratorInput): string {
  return `Orchestrate FULL content generation for this episode across all 4 stages.

**Episode**: "${input.episodeTitle}"
**Logline**: ${input.episodeLogline}
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Duration**: ${input.targetDurationSeconds} seconds
**Content Style**: ${input.contentStyle ?? 'dialogue-heavy'}
**Episode Number**: ${input.episodeNumber}
**Project ID**: ${input.projectId}

**Character Context (pass verbatim to all agents that accept it):**
${input.charactersContext}

**Location Context:**
${input.locationsContext}

**VEO Character Context (for Shot Director only):**
${input.charactersVeoContext}

**VEO Location Context (for Shot Director only):**
${input.locationsVeoContext}

${input.seasonContext ? `**Season Context:** ${input.seasonContext}` : ''}
${input.previousEpisodesContext ? `**Previous Episodes:** ${input.previousEpisodesContext}` : ''}
${
  input.recurringElementsContext
    ? `
**Recurring Story Elements (pass verbatim to ALL agents that accept it — these are MANDATORY structural anchors):**
${input.recurringElementsContext}`
    : ''
}

Begin with Story Director (pass characters + locations + seasonContext). Then evaluate. Then generate screenplay. Then Reel Scout. Then Shot Director with reel candidate priorities.

Goal: story scores ≥ 0.65 viral, no continuity errors, screenplay + shots for all scenes.`;
}
