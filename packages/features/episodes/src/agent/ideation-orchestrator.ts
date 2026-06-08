/**
 * Ideation Orchestrator
 *
 * Pre-stage of the content generation pipeline.
 * Runs the ideation quality loop: generate ideas → evaluate → regenerate weak → stop.
 *
 * Skills:
 *   - Ideation Director  (generateIdeas)   — generate / regenerate story concepts
 *   - Ideation Evaluator (evaluateIdeas)   — score ideas on 4 quality dimensions
 *
 * maxSteps: 5 — worst-case generate(1)+evaluate(1)+regenerate(1)+re-evaluate(1) = 4
 *
 * After this stage:
 *   - Ideas with quality scores returned to caller
 *   - Caller persists selected ideas to DB
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult, Skill } from '@kit/agent';
import type { ProjectType } from '@kit/film-studio-schemas/project';

import { ideationDirectorSkill } from './skills/ideation-director-skill';
import { ideationEvaluatorSkill } from './skills/ideation-evaluator-skill';

export interface IdeationOrchestratorInput {
  episodeId: string;
  premise: string;
  numberOfIdeas: number;
  genre: string;
  targetAudience: string;
  accountId: string;
  contentType?: ProjectType;
  verifiedFactsContext?: string;
  charactersContext: string;
  locationsContext: string;
  seasonContext?: string;
  previousEpisodesContext?: string;
  visualStyle?: string;
  recurringElementsContext?: string;
}

export interface IdeationOrchestratorResult {
  success: boolean;
  ideas: Array<{
    title: string;
    logline: string;
    hook: string;
    conflict: string;
    themes: string[];
    visualPotential: string;
    qualityScore?: number;
  }>;
  orchestratorSteps: number;
  error?: string;
}

interface IdeationOrchestratorOutput {
  ideas: Array<{
    title: string;
    logline: string;
    hook: string;
    conflict: string;
    themes: string[];
    visualPotential: string;
    qualityScore?: number;
  }>;
  evaluationSummary: string;
}

/**
 * Runs the Ideation stage orchestrator for an episode.
 * Coordinates Ideation Director → Ideation Evaluator → selective regeneration.
 * Stops once all ideas pass quality threshold OR 1 regeneration cycle is complete.
 */
export async function runIdeationOrchestrator(
  input: IdeationOrchestratorInput,
): Promise<IdeationOrchestratorResult> {
  console.log(
    `[Ideation Orchestrator] Starting for episode ${input.episodeId}`,
  );

  const isFactual =
    input.contentType === 'documentary' || input.contentType === 'educational';

  const skills: Skill[] = [ideationDirectorSkill, ideationEvaluatorSkill];

  let systemPrompt = IDEATION_SYSTEM_PROMPT;
  if (isFactual) {
    systemPrompt += FACTUAL_IDEATION_ADDENDUM;
  }

  const result: AgentRunResult<IdeationOrchestratorOutput> =
    await runAgent<IdeationOrchestratorOutput>(
      {
        name: 'ideation-orchestrator',
        systemPrompt,
        tools: [],
        skills,
        maxSteps: 5,
        budgetLimits: {
          maxTotalTokens: 50_000,
          maxCostUSD: 0.6,
          maxLatencyMs: 120_000,
        },
      },
      {
        userPrompt: buildIdeationPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Ideation Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      ideas: [],
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract ideas from generateIdeas steps.
  // When regeneration occurs, the LAST step only contains replacement ideas
  // for weak indices. We must merge replacements into the original full set.
  type GenerateIdeasResult = {
    ideas?: Array<{
      title: string;
      logline: string;
      hook: string;
      conflict: string;
      themes: string[];
      visualPotential: string;
    }>;
    count?: number;
    wasRegeneration?: boolean;
  };

  const allIdeasSteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateIdeas' &&
      s.toolResult?.success,
  );

  // First step = original full set, last step = possible regeneration
  const firstStepData = allIdeasSteps[0]?.toolResult?.data as
    | GenerateIdeasResult
    | undefined;
  const lastStepData =
    allIdeasSteps.length > 1
      ? (allIdeasSteps[allIdeasSteps.length - 1]?.toolResult?.data as
          | GenerateIdeasResult
          | undefined)
      : undefined;

  let rawIdeas = firstStepData?.ideas ?? result.data.ideas ?? [];

  // If there was a regeneration step, merge replacements into original set
  if (lastStepData?.wasRegeneration && lastStepData.ideas?.length) {
    // Find the evaluateIdeas step that produced weakIndices
    const evalStepForWeak = result.steps.find(
      (s) =>
        s.type === 'tool_call' &&
        s.toolName === 'evaluateIdeas' &&
        s.toolResult?.success,
    );
    const evalData = evalStepForWeak?.toolResult?.data as
      | { weakIndices?: number[] }
      | undefined;
    const weakIndices = evalData?.weakIndices ?? [];

    if (weakIndices.length > 0 && weakIndices.length === lastStepData.ideas.length) {
      // Replace only the weak ideas at their original positions
      const merged = [...rawIdeas];
      weakIndices.forEach((originalIndex, replacementIndex) => {
        if (originalIndex < merged.length && lastStepData.ideas![replacementIndex]) {
          merged[originalIndex] = lastStepData.ideas![replacementIndex]!;
        }
      });
      rawIdeas = merged;
      console.log(
        `[Ideation Orchestrator] Merged ${lastStepData.ideas.length} regenerated ideas at indices [${weakIndices.join(', ')}]`,
      );
    } else {
      // Fallback: if weakIndices don't line up, take the larger set
      if (lastStepData.ideas.length >= rawIdeas.length) {
        rawIdeas = lastStepData.ideas;
      }
    }
  }

  // Extract evaluations to merge quality scores onto ideas
  type EvaluateIdeasResult = {
    evaluations?: Array<{
      ideaIndex: number;
      overallScore: number;
    }>;
    weakIndices?: number[];
  };

  const evaluationStep = result.steps.findLast(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'evaluateIdeas' &&
      s.toolResult?.success,
  );
  const evaluationData = evaluationStep?.toolResult?.data as
    | EvaluateIdeasResult
    | undefined;

  // Merge quality scores from evaluator into ideas
  const ideas = rawIdeas.map((idea, index) => {
    const evaluation = evaluationData?.evaluations?.find(
      (e) => e.ideaIndex === index,
    );
    return {
      ...idea,
      qualityScore: evaluation?.overallScore,
    };
  });

  console.log(
    `[Ideation Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Ideas: ${ideas.length}, ` +
      `Evaluation: ${result.data.evaluationSummary ?? 'N/A'}`,
  );

  return {
    success: true,
    ideas,
    orchestratorSteps: result.steps.length,
  };
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPT
// ---------------------------------------------------------------------------

const IDEATION_SYSTEM_PROMPT = `You are the Ideation Pipeline Director — a focused quality loop for story idea generation.

You coordinate two specialist agents to produce high-quality story ideas:

1. **Ideation Director** (generateIdeas) — Generates diverse story concepts with hooks, conflicts, and visual potential.
2. **Ideation Evaluator** (evaluateIdeas) — Scores each idea on hookStrength, originality, conflictClarity, and visualPotential.

## Your Decision Logic

1. ALWAYS start with Ideation Director. Pass the premise, genre, targetAudience, and ALL context (characters, locations, seasonContext, previousEpisodes, recurringElements, visualStyle) verbatim.
2. THEN run Ideation Evaluator. Pass the generated ideas as a JSON string, along with genre and targetAudience.
3. IF weakIndices is non-empty AND you haven't regenerated yet → call Ideation Director ONCE with weakIndices to replace only the weak ideas.
4. STOP after at most 1 regeneration cycle. Do NOT loop more than once — time budget matters.

## CRITICAL CONSTRAINTS
- Generate EXACTLY the requested number of ideas.
- Each idea must be DISTINCT in tone, conflict type, and visual approach.
- Do NOT call any story generation, screenplay, or shot tools — this is ideation only.
- Maximum 1 regeneration cycle. If weak ideas remain after regeneration, they are accepted as-is.

## Your Final Answer

Return a JSON object with:
- ideas: array of idea objects (title, logline, hook, conflict, themes, visualPotential, qualityScore)
- evaluationSummary: 1-2 sentence summary of idea quality (e.g. "3 strong ideas, 0 weak — all ready for development")`;

// ---------------------------------------------------------------------------
// USER PROMPT BUILDER
// ---------------------------------------------------------------------------

function buildIdeationPrompt(input: IdeationOrchestratorInput): string {
  const isFactual =
    input.contentType === 'documentary' || input.contentType === 'educational';

  return `Generate and evaluate ${input.numberOfIdeas} story ideas for this episode.

**Premise**: ${input.premise}
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
${input.contentType ? `**Content Type**: ${input.contentType}` : ''}

**Character Context (pass verbatim to Ideation Director):**
${input.charactersContext || 'No characters defined.'}

**Location Context:**
${input.locationsContext || 'No locations defined.'}

${input.seasonContext ? `**Season Context:** ${input.seasonContext}` : ''}
${input.previousEpisodesContext ? `**Previous Episodes:** ${input.previousEpisodesContext}` : ''}
${input.visualStyle ? `**Visual Style:** ${input.visualStyle}` : ''}
${
  input.recurringElementsContext
    ? `
**Recurring Episode Elements (MANDATORY — pass verbatim to generateIdeas as recurringElements):**
${input.recurringElementsContext}
`
    : ''
}
${
  isFactual && input.verifiedFactsContext
    ? `
**VERIFIED FACTS (ideas must incorporate these):**
${input.verifiedFactsContext}

IMPORTANT: Each idea must present a narrative ANGLE to deliver these facts.
The protagonist experiences/discovers the facts through immersive action.
Generate diverse approaches: chronological, mystery-reveal, character-driven, etc.
`
    : ''
}

Begin with Ideation Director. Pass all context verbatim. Evaluate with Ideation Evaluator. Regenerate weak ideas if needed (max 1 cycle). Stop.

Goal: ${input.numberOfIdeas} ideas, each scoring >= 0.5, with maximum diversity.`;
}

const FACTUAL_IDEATION_ADDENDUM = `

## Documentary/Educational Mode

For factual content, each idea must:
1. Present a unique NARRATIVE ANGLE to deliver the verified facts
2. Use the protagonist as a vehicle — they EXPERIENCE the facts, not lecture about them
3. Example angles: chronological journey, mystery investigation, cause-and-effect chain, day-in-the-life
4. Every critical fact must appear as a plot event in the story concept
5. The logline must hint at the factual core while promising an engaging story

Judge idea quality by: (a) how naturally facts integrate into narrative, (b) engagement, (c) visual potential`;
