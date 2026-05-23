/**
 * Season Orchestrator
 *
 * Coordinates the season outline pipeline:
 *   1. Generate episode outlines with Season Outliner
 *   2. Evaluate arc quality with Season Arc Evaluator
 *   3. If verdict is 'revise', call Season Outliner again with weak episode fixes
 *   4. Max 1 revision cycle
 *   5. Return final episodes array with arc scores
 *
 * Skills:
 *   - Season Outliner   (generateSeasonOutline)  — generate/revise episode outlines
 *   - Arc Evaluator     (evaluateSeasonArc)       — score arc progression quality
 *
 * maxSteps: 6 — worst-case outline(1)+evaluate(1)+revision(1)+re-evaluate(1) = 4
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { seasonArcEvaluatorSkill } from './skills/season-arc-evaluator-skill';
import { seasonOutlinerSkill } from './skills/season-outliner-skill';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EpisodeOutlineShape {
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

export interface SeasonOrchestratorInput {
  projectId: string;
  seasonPremise: string;
  episodeCount: number;
  startingNumber: number;
  genre: string;
  style: string;
  accountId: string;
  existingCharacters: string;
  existingLocations: string;
  recurringElements: string;
}

interface SeasonOrchestratorOutput {
  episodes: EpisodeOutlineShape[];
  arcScore: number;
  arcSummary: string;
}

export interface SeasonOrchestratorResult {
  success: boolean;
  episodes: EpisodeOutlineShape[];
  arcScore?: number;
  arcSummary?: string;
  orchestratorSteps: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SEASON_SYSTEM_PROMPT = `You are the Season Pipeline Director — a focused quality loop for season outline generation.

You coordinate two specialist agents to produce a high-quality season outline:

1. **Season Outliner** (generateSeasonOutline) — Creates/revises multi-episode outlines with distinct conflicts and escalating arcs.
2. **Arc Evaluator** (evaluateSeasonArc) — Scores outlines on arc progression, conflict diversity, and character arc coherence.

## Your Decision Logic

1. ALWAYS start with Season Outliner. Pass seasonPremise, episodeCount, startingNumber, genre, style, existingCharacters, existingLocations, and recurringElements.
2. THEN call Arc Evaluator (evaluateSeasonArc) with the generated episodes JSON, genre, and seasonPremise.
3. IF verdict is 'revise' AND there are weak episodes AND you haven't revised yet → call Season Outliner ONCE more with the weak episode feedback in recurringElements for targeted revision. Then re-evaluate with Arc Evaluator.
4. STOP once: verdict is 'pass' OR 1 revision cycle is complete.

## CRITICAL CONSTRAINTS
- Maximum 1 revision cycle — do not loop more than once.
- Each episode MUST have a distinct central conflict — no repetitive patterns.
- Pass all project context verbatim to the outliner.

## Your Final Answer

Return a JSON object with:
- episodes: the final array of episode outlines
- arcScore: the overall arc score from the Arc Evaluator (0-1)
- arcSummary: textual summary of the arc quality`;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the Season Outline orchestrator.
 * Coordinates Season Outliner → Arc Evaluator → optional revision.
 */
export async function runSeasonOrchestrator(
  input: SeasonOrchestratorInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
): Promise<SeasonOrchestratorResult> {
  void supabase; // reserved for future DB persistence

  console.log(
    `[Season Orchestrator] Starting for project ${input.projectId} — ` +
      `${input.episodeCount} episodes from #${input.startingNumber}`,
  );

  const result: AgentRunResult<SeasonOrchestratorOutput> =
    await runAgent<SeasonOrchestratorOutput>(
      {
        name: 'season-orchestrator',
        systemPrompt: SEASON_SYSTEM_PROMPT,
        tools: [],
        skills: [seasonOutlinerSkill, seasonArcEvaluatorSkill],
        maxSteps: 6,
        budgetLimits: {
          maxTotalTokens: 50_000,
          maxCostUSD: 0.8,
          maxLatencyMs: 180_000,
        },
      },
      {
        userPrompt: buildSeasonPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Season Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      episodes: [],
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract episodes from the last successful generateSeasonOutline step
  type OutlineStepResult = {
    episodes?: EpisodeOutlineShape[];
    count?: number;
  };

  const outlineStep = result.steps.findLast(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateSeasonOutline' &&
      s.toolResult?.success,
  );
  const outlineStepData = outlineStep?.toolResult?.data as
    | OutlineStepResult
    | undefined;

  // Prefer step-level episodes (full data) over LLM-synthesized output
  const episodes = outlineStepData?.episodes ?? result.data.episodes ?? [];

  console.log(
    `[Season Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Episodes: ${episodes.length}, Arc score: ${result.data.arcScore ?? 'N/A'}`,
  );

  return {
    success: true,
    episodes,
    arcScore: result.data.arcScore,
    arcSummary: result.data.arcSummary,
    orchestratorSteps: result.steps.length,
  };
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

function buildSeasonPrompt(input: SeasonOrchestratorInput): string {
  return `Generate and quality-check episode outlines for this season.

**Season Premise**: ${input.seasonPremise}
**Episode Count**: ${input.episodeCount}
**Starting Episode Number**: ${input.startingNumber}
**Genre**: ${input.genre}
**Style**: ${input.style}

**Character Context (pass verbatim to Season Outliner):**
${input.existingCharacters || 'No characters defined yet.'}

**Location Context:**
${input.existingLocations || 'No locations defined yet.'}
${
  input.recurringElements
    ? `
**Recurring Elements (pass verbatim to Season Outliner):**
${input.recurringElements}
`
    : ''
}

Begin with Season Outliner. Pass all context verbatim. Evaluate arc quality. Apply one revision if needed. Stop.

Goal: each episode has a distinct conflict, stakes escalate across the season, and character arcs are coherent.`;
}
