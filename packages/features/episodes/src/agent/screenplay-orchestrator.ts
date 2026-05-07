/**
 * Screenplay Orchestrator
 *
 * Stage 2 of the 3-stage content generation pipeline.
 * Converts a finalized story into structured screenplay format.
 *
 * Skills:
 *   - Screenplay Director (generateScreenplay) — scene-by-scene screenplay
 *
 * maxSteps: 4 — generate(1) + maybe scene-count revision(1) = 2 worst case.
 *
 * After this stage:
 *   - screenplay_data written to DB (with metadata.characters + metadata.locations)
 *   - dialogue_lines inserted
 *   - episode status → 'storyboard'
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { screenplayDirectorSkill } from './skills/screenplay-director-skill';

export interface ScreenplayOrchestratorInput {
  episodeId: string;
  episodeTitle: string;
  episodeNumber: number;
  genre: string;
  targetAudience: string;
  targetDurationSeconds: number;
  contentStyle?: 'dialogue-heavy' | 'balanced' | 'action-heavy';
  accountId: string;
  // Story content to convert
  storyText: string;
  // Pre-formatted context blocks
  charactersContext: string;
  characterNames: string;
  locationNames: string;
  // Scaling parameters
  sceneCountMin: number;
  sceneCountMax: number;
  dialogueLinesPerSceneMin: number;
  dialogueLinesPerSceneMax: number;
}

export interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action: string[];
  dialogue: Array<{
    character: string;
    text: string;
    parenthetical?: string;
  }>;
  estimatedDuration?: number;
  transitions?: string;
}

export interface ScreenplayOrchestratorResult {
  success: boolean;
  scenes: ScreenplayScene[];
  title: string;
  totalDialogueLines: number;
  estimatedDuration: number;
  orchestratorSteps: number;
  error?: string;
}

interface ScreenplayOrchestratorOutput {
  screenplayTitle?: string;
  sceneCount?: number;
  qualityNote?: string;
}

/**
 * Runs the Screenplay stage orchestrator.
 * Instructs the Screenplay Director to convert the story into scenes.
 * Optionally revises if scene count is out of expected range.
 */
export async function runScreenplayOrchestrator(
  input: ScreenplayOrchestratorInput,
): Promise<ScreenplayOrchestratorResult> {
  console.log(
    `[Screenplay Orchestrator] Starting for episode ${input.episodeId}`,
  );

  const result: AgentRunResult<ScreenplayOrchestratorOutput> =
    await runAgent<ScreenplayOrchestratorOutput>(
      {
        name: 'screenplay-orchestrator',
        systemPrompt: SCREENPLAY_SYSTEM_PROMPT,
        tools: [],
        skills: [screenplayDirectorSkill],
        maxSteps: 4,
        budgetLimits: {
          maxTotalTokens: 150_000,
          maxCostUSD: 1.5,
          maxLatencyMs: 180_000,
        },
      },
      {
        userPrompt: buildScreenplayPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Screenplay Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      scenes: [],
      title: input.episodeTitle,
      totalDialogueLines: 0,
      estimatedDuration: input.targetDurationSeconds,
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract screenplay from tool steps (most reliable source — LLM final synthesis may truncate)
  type GenerateScreenplayResult = {
    title?: string;
    scenes?: ScreenplayScene[];
    totalDialogueLines?: number;
    estimatedDuration?: number;
  };

  const screenplaySteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateScreenplay' &&
      s.toolResult?.success,
  );
  const lastScreenplayStep = screenplaySteps.at(-1);
  const screenplayData = lastScreenplayStep?.toolResult?.data as
    | GenerateScreenplayResult
    | undefined;

  const scenes = (screenplayData?.scenes ?? []) as ScreenplayScene[];
  const title = screenplayData?.title ?? input.episodeTitle;
  const totalDialogueLines = screenplayData?.totalDialogueLines ?? 0;
  const estimatedDuration =
    screenplayData?.estimatedDuration ?? input.targetDurationSeconds;

  console.log(
    `[Screenplay Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Scenes: ${scenes.length}, Dialogue lines: ${totalDialogueLines}`,
  );

  return {
    success: true,
    scenes,
    title,
    totalDialogueLines,
    estimatedDuration,
    orchestratorSteps: result.steps.length,
  };
}

const SCREENPLAY_SYSTEM_PROMPT = `You are the Screenplay Pipeline Director.

Your sole responsibility: convert a finalized story into a structured screenplay.

## Your Steps

1. Call generateScreenplay with the story text and all context provided.
2. Check that the returned scene count is within the expected range (sceneCountMin–sceneCountMax).
3. If the scene count is significantly outside the range (by more than 2), call generateScreenplay ONCE more with adjusted sceneCountMin/sceneCountMax to correct it.
4. Stop after at most 2 generateScreenplay calls.

## CRITICAL CONSTRAINTS
- Pass the characters context block EXACTLY as received — do not summarize.
- Do NOT generate shots, reel analysis, or story revisions — those are other pipeline stages.
- The screenplay must use character names that EXACTLY match the provided character list.

## Your Final Answer

Return a JSON object with:
- screenplayTitle: the screenplay title
- sceneCount: number of scenes generated
- qualityNote: one sentence noting any adjustments made`;

function buildScreenplayPrompt(input: ScreenplayOrchestratorInput): string {
  const minutesDuration = Math.round(input.targetDurationSeconds / 60);
  return `Convert this story into a structured screenplay.

**Episode**: "${input.episodeTitle}" (#${input.episodeNumber})
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Duration**: ${minutesDuration} minutes (${input.targetDurationSeconds}s)
**Content Style**: ${input.contentStyle ?? 'dialogue-heavy'}

**Expected Scene Range**: ${input.sceneCountMin}–${input.sceneCountMax} scenes
**Dialogue Lines Per Scene**: ${input.dialogueLinesPerSceneMin}–${input.dialogueLinesPerSceneMax}

**Story to Convert:**
${input.storyText}

**Character Context (pass verbatim to generateScreenplay):**
${input.charactersContext || 'No characters defined.'}

**Character Names**: ${input.characterNames}
**Location Names**: ${input.locationNames}

Call generateScreenplay now. Verify scene count is ${input.sceneCountMin}–${input.sceneCountMax}. Revise once if significantly out of range.`;
}
