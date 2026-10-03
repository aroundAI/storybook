/**
 * Shot Orchestrator
 *
 * Stage 3 of the 3-stage content generation pipeline.
 * Evaluates scenes for Reel/Shorts candidacy, then generates VEO 3.1 shots.
 *
 * Skills:
 *   - Reel Scout         (analyzeScenes)          — identify viral short-form candidates
 *   - Shot Director      (generateShots)          — generate VEO 3.1 optimized shot list
 *   - Shot Quality       (evaluateShotQuality)    — post-generation quality gate
 *
 * maxSteps: 16 — analyzeScenes(1) + generateShots(1–2) + evaluateShotQuality(1) = 4 typical.
 * Large budget to give Shot Director room if it needs to batch large scene sets.
 *
 * After this stage:
 *   - shots written to shots table
 *   - episode status → 'production'
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { reelScoutSkill } from './skills/reel-scout-skill';
import { shotDirectorSkill } from './skills/shot-director-skill';
import { shotQualitySkill } from './skills/shot-quality-skill';

export interface ShotOrchestratorScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action?: string[] | string;
  dialogue: Array<{
    character: string;
    text: string;
    parenthetical?: string;
  }>;
  estimatedDuration?: number;
}

export interface ShotOrchestratorInput {
  episodeId: string;
  episodeTitle: string;
  genre: string;
  targetAudience: string;
  visualStyle: string;
  accountId: string;
  // Screenplay scenes to generate shots for
  scenes: ShotOrchestratorScene[];
  // VEO-formatted character/location context
  charactersVeoContext: string;
  locationsVeoContext: string;
  // Recurring story elements (pre-formatted)
  recurringElementsContext?: string;
  /** How long each shot may run, in seconds (KB-120) */
  shotDuration?: { min: number; max: number };
  /** FILM-1912: past performance as prompt text, for each scene's prompt */
  performanceContext?: string;
}

export interface GeneratedShotResult {
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  duration: number;
  characters: string[];
  sceneNumber: number;
  metadata: {
    location: string;
    timeOfDay: string;
    mood?: string;
    lighting?: string;
    isReelCandidate?: boolean;
    hookType?: string;
  };
  veoPrompt: {
    shotLine: string;
    audio: string;
    style: string;
    avoid: string;
    fullPrompt: string;
  };
  // Continuity fields the shot director emits (shot-director-skill.ts) and
  // the llm-worker persists onto `shots`.
  transitionType?: string;
  frameStrategy?: string;
  primarySubject?: { type: string; name: string };
  firstFrameDescription?: string | null;
  lastFrameDescription?: string | null;
  locationArea?: string | null;
  locationEnvironmentDescription?: string | null;
}

/** What the scene-shot-generation prompt said about a scene as a whole. */
export interface SceneShotResultSummary {
  sceneNumber: number;
  sceneSummary?: string;
  sceneViralScore?: number;
  sceneHookType?: string | null;
  sceneStandaloneSummary?: string | null;
}

export interface ReelSceneAnalysis {
  sceneNumber: number;
  isReelCandidate: boolean;
  viralScore: number;
  hookType?:
    | 'question'
    | 'reveal'
    | 'conflict'
    | 'visual'
    | 'humor'
    | 'cliffhanger'
    | 'character'
    | 'action'
    | 'reaction'
    | 'punchline'
    | null;
  estimatedDurationSeconds?: number;
  keyMoment?: string | null;
  sceneEmotionalArc: string;
  whyThisWorksAsReel?: string | null;
  whyItDoesntWork?: string | null;
  improvementSuggestion?: string | null;
}

export interface ShotOrchestratorResult {
  success: boolean;
  shots: GeneratedShotResult[];
  reelCandidateScenes: number[];
  /** Full per-scene Reel Scout analysis — viralScore, hookType, whyThisWorksAsReel, etc. */
  sceneAnalyses: ReelSceneAnalysis[];
  /** The Reel Scout's note to the orchestrator */
  orchestratorNote?: string;
  /** The Shot Director's scene-level fields, one per scene that succeeded */
  sceneResults?: SceneShotResultSummary[];
  /** Shot quality evaluation score (0-1). >= 0.8 = production-ready */
  shotQualityScore?: number;
  /** Shot quality decision: 'pass' | 'revise' | 'rework' */
  shotQualityDecision?: string;
  orchestratorSteps: number;
  error?: string;
}

interface ShotOrchestratorOutput {
  totalShotsGenerated?: number;
  reelCandidates?: number[];
  completionNote?: string;
}

/**
 * Runs the Shot stage orchestrator.
 * 1. Reel Scout evaluates scenes for viral short-form candidacy.
 * 2. Shot Director generates VEO 3.1 shots for all scenes, prioritizing reel candidates.
 *
 * Uses maxTokensPerStep: 32000 to prevent response truncation — the generateShots
 * tool call params include all scenes as JSON (~16k chars) so the LLM response
 * must have sufficient output budget to avoid unbalanced-JSON parse failures.
 */
export async function runShotOrchestrator(
  input: ShotOrchestratorInput,
): Promise<ShotOrchestratorResult> {
  console.log(
    `[Shot Orchestrator] Starting for episode ${input.episodeId}. ` +
      `${input.scenes.length} scenes to process.`,
  );

  const result: AgentRunResult<ShotOrchestratorOutput> =
    await runAgent<ShotOrchestratorOutput>(
      {
        name: 'shot-orchestrator',
        systemPrompt: SHOT_SYSTEM_PROMPT,
        tools: [],
        skills: [reelScoutSkill, shotDirectorSkill, shotQualitySkill],
        maxSteps: 16,
        // 32000 output tokens — required because the generateShots tool_call
        // params include all scene scenes as JSON. At 4000 (default) the
        // response is truncated mid-JSON → parser fails → generateShots never runs.
        maxTokensPerStep: 32000,
        budgetLimits: {
          maxTotalTokens: 400_000,
          maxCostUSD: 4.0,
          maxLatencyMs: 600_000,
        },
      },
      {
        userPrompt: buildShotPrompt(input),
      },
      {
        accountId: input.accountId,
        _scenesContext: input.scenes,
        _shotDuration: input.shotDuration,
        _performanceContext: input.performanceContext ?? '',
      },
    );

  // Log the full agent result for diagnostics
  console.log(
    `[Shot Orchestrator] runAgent result — success: ${result.success}, ` +
      `steps: ${result.steps.length}, error: ${result.error ?? 'none'}, ` +
      `data: ${result.data ? JSON.stringify(result.data).substring(0, 200) : 'null'}`,
  );

  // Log each step type for visibility
  for (const [i, step] of result.steps.entries()) {
    console.log(
      `[Shot Orchestrator] Step ${i + 1}: type=${step.type}, ` +
        `tool=${step.toolName ?? 'n/a'}, ` +
        `toolSuccess=${step.toolResult?.success ?? 'n/a'}, ` +
        `tokens=${step.tokensUsed ?? 0}`,
    );
  }

  if (!result.success || !result.data) {
    console.warn(`[Shot Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      shots: [],
      reelCandidateScenes: [],
      sceneAnalyses: [],
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract shots from tool steps (most reliable)
  type GenerateShotsResult = {
    shots?: GeneratedShotResult[];
    sceneResults?: SceneShotResultSummary[];
  };
  type AnalyzeScenesResult = {
    topReelCandidates?: number[];
    sceneAnalyses?: ReelSceneAnalysis[];
    orchestratorNote?: string;
  };

  const shotsSteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateShots' &&
      s.toolResult?.success,
  );
  const lastShotsStep = shotsSteps.at(-1);
  const shotsData = lastShotsStep?.toolResult?.data as
    | GenerateShotsResult
    | undefined;
  const shots = (shotsData?.shots ?? []) as GeneratedShotResult[];
  const sceneResults = shotsData?.sceneResults ?? [];

  const reelStep = result.steps.find(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'analyzeScenes' &&
      s.toolResult?.success,
  );
  const reelData = reelStep?.toolResult?.data as
    | AnalyzeScenesResult
    | undefined;
  const reelCandidateScenes = reelData?.topReelCandidates ?? [];
  const sceneAnalyses = (reelData?.sceneAnalyses ?? []) as ReelSceneAnalysis[];

  // Log full reel intelligence so every scene's viralScore is visible in CloudWatch
  if (sceneAnalyses.length > 0) {
    console.log(
      `[Shot Orchestrator] Reel Scout sceneAnalyses: ${sceneAnalyses.length} scenes — ` +
        sceneAnalyses
          .map(
            (a) =>
              `scene${a.sceneNumber}(score=${a.viralScore},candidate=${a.isReelCandidate},hook=${a.hookType ?? 'none'})`,
          )
          .join(', '),
    );
  } else {
    console.warn(
      `[Shot Orchestrator] Reel Scout returned no sceneAnalyses — ` +
        `reelStep found: ${!!reelStep}, reelData keys: ${reelData ? Object.keys(reelData).join(', ') : 'null'}`,
    );
  }

  // Log any failed generateShots steps so the error is visible in CloudWatch
  const failedShotsSteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateShots' &&
      !s.toolResult?.success,
  );
  for (const step of failedShotsSteps) {
    console.error(
      `[Shot Orchestrator] generateShots tool call failed: ${step.toolResult?.error ?? JSON.stringify(step.toolResult)}`,
    );
  }

  // Emit a step-by-step trace so every tool call is visible in CloudWatch
  const toolCalls = result.steps.filter((s) => s.type === 'tool_call');
  for (const step of toolCalls) {
    const ok = step.toolResult?.success;
    console.log(
      `[Shot Orchestrator] Tool: ${step.toolName} — ${ok ? 'SUCCESS' : 'FAILED'}` +
        (!ok ? ` — ${step.toolResult?.error ?? 'no error message'}` : ''),
    );
  }

  console.log(
    `[Shot Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `ToolCalls: ${toolCalls.length}, Shots: ${shots.length}, ` +
      `Reel candidates: ${reelCandidateScenes.join(', ') || 'none'}`,
  );

  // Extract shot quality evaluation results
  type EvaluateShotQualityResult = {
    overallScore?: number;
    decision?: string;
  };

  const qualityStep = result.steps.find(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'evaluateShotQuality' &&
      s.toolResult?.success,
  );
  const qualityData = qualityStep?.toolResult?.data as
    | EvaluateShotQualityResult
    | undefined;

  if (qualityData) {
    console.log(
      `[Shot Orchestrator] Shot Quality: score=${qualityData.overallScore}, ` +
        `decision=${qualityData.decision}`,
    );
  } else {
    console.log(
      `[Shot Orchestrator] Shot Quality evaluation was not run or failed`,
    );
  }

  return {
    success: true,
    shots,
    reelCandidateScenes,
    sceneAnalyses,
    orchestratorNote: reelData?.orchestratorNote,
    sceneResults,
    shotQualityScore: qualityData?.overallScore,
    shotQualityDecision: qualityData?.decision,
    orchestratorSteps: result.steps.length,
  };
}

const SHOT_SYSTEM_PROMPT = `You are the Shot Pipeline Director.

Your job: produce a complete, production-quality VEO 3.1 shot list for all screenplay scenes.

## Your Steps

1. Call analyzeScenes (Reel Scout) with all scenes. This identifies which scenes work best as standalone Reels/Shorts and returns topReelCandidates.
2. Call generateShots (Shot Director) with ALL scenes plus the reelCandidateScenes list from step 1.
   - The Shot Director will generate hook-optimized shots for reel candidate scenes.
   - Pass the VEO character and location context verbatim.
3. Call evaluateShotQuality (Shot Quality) with the generated shots JSON to score production-readiness.
   - If decision is 'pass' (>= 0.8): Report success and include the quality score.
   - If decision is 'revise' (0.6-0.79): Note the issues in completionNote but do NOT regenerate — the handler will address individual shots.
   - If decision is 'rework' (< 0.6): Report the systematic issues — the handler may request re-generation.
4. If analyzeScenes returns an error, do NOT stop — skip to step 2 with reelCandidateScenes set to [].
5. If evaluateShotQuality fails, still return the shots — quality scoring is a bonus, not a blocker.
6. STOP after evaluateShotQuality completes (or after generateShots if quality eval fails).

## CRITICAL CONSTRAINTS
- Pass VEO character context verbatim — character visual identities are non-negotiable.
- Pass recurringElements context verbatim to generateShots — these define signature visual patterns.
- Do NOT generate story revisions or screenplay — only shots.
- Every scene MUST have at least one shot in the output.
- NEVER skip generateShots — even if analyzeScenes fails.

## Your Final Answer

Return a JSON object with:
- totalShotsGenerated: number of shots produced
- reelCandidates: scene numbers identified by Reel Scout (empty array if Reel Scout failed)
- shotQualityScore: the overall quality score from evaluateShotQuality (null if not run)
- shotQualityDecision: 'pass', 'revise', or 'rework' (null if not run)
- completionNote: one sentence confirming completion and quality status`;

function buildShotPrompt(input: ShotOrchestratorInput): string {
  return `Generate a complete VEO 3.1 shot list for this episode.

**Episode**: "${input.episodeTitle}"
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Visual Style**: ${input.visualStyle}
**Total Scenes**: ${input.scenes.length}

**VEO Character Context (pass verbatim to generateShots):**
${input.charactersVeoContext || 'No character context.'}

**VEO Location Context (pass verbatim to generateShots):**
${input.locationsVeoContext || 'No location context.'}
${
  input.recurringElementsContext
    ? `
**Recurring Story Elements (pass verbatim to generateShots as recurringElements):**
${input.recurringElementsContext}`
    : ''
}

**Scenes to Process:**
${JSON.stringify(input.scenes, null, 2)}

Start with analyzeScenes (Reel Scout) to identify viral candidates, then call generateShots for all ${input.scenes.length} scenes.`;
}
