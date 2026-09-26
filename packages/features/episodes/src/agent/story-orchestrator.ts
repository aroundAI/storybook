/**
 * Story Orchestrator
 *
 * Stage 1 of the 3-stage content generation pipeline.
 * Runs the story quality loop: generate → evaluate → revise → validate canon.
 *
 * Skills (always):
 *   - Story Director    (generateStory)    — write / revise narrative
 *   - Viral Analyst     (evaluateContent)  — score against 7 viral dimensions
 *   - Continuity Guardian (buildMemoryContext → checkContinuity) — validate canon
 *
 * Skills (content-type conditional):
 *   - Researcher        (identifyResearchNeeds) — documentary/educational only
 *   - Fact Checker       (factCheckContent)      — documentary/educational only
 *   - Act Context        (extractActContext)     — movie only
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
import type { AgentRunResult, Skill } from '@kit/agent';
import type { ProjectType } from '@kit/film-studio-schemas/project';

import type { EpisodeViralQuality, ViralDimensionScores } from '../lib/types';
import {
  type ContinuitySkillDeps,
  createContinuitySkill,
} from './skills/continuity-skill';
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
  /** Project content type — drives which skills are available */
  contentType?: ProjectType;
  /** For movie type: which act number is being generated (1, 2, or 3) */
  actNumber?: number;
  /** For documentary/educational: pre-formatted verified facts */
  verifiedFacts?: string;
  // Pre-formatted context blocks from context-builder
  charactersContext: string;
  locationsContext: string;
  seasonContext?: string;
  previousEpisodesContext?: string;
  visualStyle?: string;
  // Recurring elements from project settings (e.g. episode ending pattern)
  recurringElementsContext?: string;
  // Narrative threads to progress/resolve in this episode
  threadCandidatesContext?: string;
  // Ideation refinement fields from Select & Refine
  ideationThemes?: string[];
  ideationHook?: string;
  visualDirection?: string;
}

export interface StoryOrchestratorResult {
  success: boolean;
  viralQuality: EpisodeViralQuality | null;
  storyText?: string;
  // Full story metadata for DB write
  storyTitle?: string;
  actBreakdown?: { act1: string; act2: string; act3: string };
  storyCharacters?: Array<{ name: string; role: string; arc: string }>;
  newCharacters?: Array<{
    name: string;
    role: string;
    arc?: string;
    description: string;
    physicalDescription: string;
    clothingStyle?: string;
    mannerisms?: string;
  }>;
  newLocations?: Array<{
    name: string;
    setting?: string;
    description: string;
    visualDescription?: string;
  }>;
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
  console.log(
    `[Story Orchestrator] Starting for episode ${input.episodeId}` +
      (input.contentType ? ` (type: ${input.contentType})` : ''),
  );

  const skills = await buildSkillsForContentType(input.contentType, {
    client: supabase,
    projectId: input.projectId,
  });
  const systemPrompt = buildSystemPrompt(input.contentType);

  const result: AgentRunResult<StoryOrchestratorOutput> =
    await runAgent<StoryOrchestratorOutput>(
      {
        name: 'story-orchestrator',
        systemPrompt,
        tools: [],
        skills,
        maxSteps: input.contentType === 'documentary' ? 12 : 8,
        budgetLimits: {
          maxTotalTokens: 200_000,
          maxCostUSD: 2.0,
          maxLatencyMs: 480_000,
        },
      },
      {
        userPrompt: buildStoryPrompt(input),
      },
      {
        accountId: input.accountId,
        // The director's template reads the facts itself (KB-126)
        _verifiedFacts: input.verifiedFacts,
      },
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
    newCharacters?: Array<{
      name: string;
      role: string;
      arc?: string;
      description: string;
      physicalDescription: string;
      clothingStyle?: string;
      mannerisms?: string;
    }>;
    newLocations?: Array<{
      name: string;
      setting?: string;
      description: string;
      visualDescription?: string;
    }>;
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
    newCharacters: storyStepData?.newCharacters,
    newLocations: storyStepData?.newLocations,
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

// ---------------------------------------------------------------------------
// CONTENT-TYPE SKILL ROUTING
// ---------------------------------------------------------------------------

/**
 * Dynamically selects skills based on content type.
 * Documentary/educational get researcher + fact-checker for factual accuracy.
 * Movie gets act-context for cross-act continuity.
 * All types get the base triple: Story Director + Viral Analyst + Continuity.
 */
async function buildSkillsForContentType(
  contentType: ProjectType | undefined,
  continuity: ContinuitySkillDeps,
): Promise<Skill[]> {
  const baseSkills: Skill[] = [
    storyDirectorSkill,
    viralAnalystSkill,
    createContinuitySkill(continuity),
  ];

  if (!contentType) return baseSkills;

  switch (contentType) {
    case 'documentary':
    case 'educational': {
      const { researcherSkill } = await import('./skills/researcher-skill');
      const { factCheckerSkill } = await import('./skills/fact-checker-skill');
      return [...baseSkills, researcherSkill, factCheckerSkill];
    }

    case 'movie': {
      const { actContextSkill } = await import('./skills/act-context-skill');
      return [...baseSkills, actContextSkill];
    }

    default:
      return baseSkills;
  }
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPTS
// ---------------------------------------------------------------------------

/**
 * Builds a content-type-aware system prompt.
 * Base prompt covers the standard generate→evaluate→revise loop.
 * Appends content-type-specific instructions when needed.
 */
function buildSystemPrompt(contentType?: ProjectType): string {
  let prompt = STORY_SYSTEM_PROMPT;

  if (contentType === 'documentary' || contentType === 'educational') {
    prompt += DOCUMENTARY_SYSTEM_ADDENDUM;
  } else if (contentType === 'movie') {
    prompt += MOVIE_SYSTEM_ADDENDUM;
  }

  return prompt;
}

const STORY_SYSTEM_PROMPT = `You are the Story Pipeline Director — a focused quality loop for story generation.

You coordinate three specialist agents to produce a high-quality story:

1. **Story Director** (generateStory) — Creates/revises narrative with character context.
2. **Viral Analyst** (evaluateContent) — Scores story on 7 viral dimensions. Returns overallScore and revision priorities.
3. **Continuity Guardian** (buildMemoryContext → checkContinuity) — Validates story against established canon.

## Your Decision Logic

1. ALWAYS start with Story Director. Pass characters, locations, seasonContext, previousEpisodes, recurringElements, AND ideation refinement fields (ideationThemes, ideationHook, visualDirection) verbatim.
2. THEN run Viral Analyst (evaluateContent) to score the story.
3. THEN run Continuity Guardian (buildMemoryContext then checkContinuity).
4. IF Viral Analyst score < 0.65 AND you haven't revised yet → call Story Director ONCE with revisionInstructions targeting the weakest dimensions. Then re-score with Viral Analyst.
5. IF Continuity Guardian finds violations with severity=error → call Story Director with targeted revisionInstructions.
6. STOP once: score ≥ 0.65 OR 1 revision cycle is complete (don't loop more than once — time budget matters).

## CRITICAL CONSTRAINTS
- Do NOT call generateScreenplay, analyzeScenes, or generateShots — those run in separate pipeline stages.
- Do NOT try to do everything perfectly — one revision loop is the maximum.
- The recurringElements MUST be passed to generateStory if provided.

## Your Final Answer

Return a JSON object with:
- overallScore (from Viral Analyst, as a number 0–1)
- decision: "pass" | "revised" | "flag"
- whyThisWorks: 2-3 sentence paragraph on viral strengths
- whatToImprove: 1-2 sentence paragraph on main weakness
- dimensionScores: { hookStrength, curiosityGap, emotionalArc, setupPayoff, dialogueSubtext, loopability, memorableMoment }
- revisionsApplied: string array of changes made (empty if no revisions)
- finalStoryText: the final story text after any revisions`;

const DOCUMENTARY_SYSTEM_ADDENDUM = `

## Documentary/Educational Mode — Additional Steps

You also have access to:
- **Researcher** (identifyResearchNeeds) — identifies factual claims in the topic that need verification.
- **Fact Checker** (factCheckContent) — validates generated content against verified facts.

Modified workflow for documentary/educational content:
1. FIRST call identifyResearchNeeds with the topic and premise to understand what facts are needed.
2. THEN call Story Director, passing the research findings as context.
3. THEN call Viral Analyst to score engagement.
4. THEN call factCheckContent with the generated story and verified facts to validate accuracy.
5. IF fact check verdict is 'fail': revise the story to fix critical factual issues.
6. THEN run Continuity Guardian.

CRITICAL: Never fabricate statistics, dates, or figures. If verified facts are unavailable, the story must acknowledge uncertainty rather than invent data.`;

const MOVIE_SYSTEM_ADDENDUM = `

## Movie Mode — Multi-Act Continuity

You also have access to:
- **Act Context** (extractActContext) — extracts precise state at act boundaries for cross-act continuity.

Modified workflow for movies:
1. Generate story with Story Director (same as standard flow).
2. Score with Viral Analyst.
3. Check Continuity.
4. AFTER the story passes quality checks, call extractActContext to capture the end-of-act state.
   - This produces a continuity bridge (character states, open threads, tone vectors) that will be injected into the next act's context.
5. Include the act context extraction results in your final answer.

CRITICAL: Movie acts must maintain strict continuity. Character deaths, injuries, emotional states, and knowledge must carry forward exactly.`;

function buildStoryPrompt(input: StoryOrchestratorInput): string {
  const contentTypeLabel = input.contentType
    ? `**Content Type**: ${input.contentType}`
    : '';
  const actLabel = input.actNumber
    ? `**Act Number**: ${input.actNumber} of 3`
    : '';

  return `Generate and quality-check a story for this episode.

**Episode**: "${input.episodeTitle}"
**Logline**: ${input.episodeLogline}
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Duration**: ${input.targetDurationSeconds} seconds
**Content Style**: ${input.contentStyle ?? 'dialogue-heavy'}
**Episode Number**: ${input.episodeNumber}
${contentTypeLabel}
${actLabel}

${
  input.ideationThemes?.length
    ? `**Thematic Direction**: ${input.ideationThemes.join(', ')}
These themes should be woven into the story naturally.`
    : ''
}
${
  input.ideationHook
    ? `**Narrative Hook**: ${input.ideationHook}
This hook should drive the story's unique angle.`
    : ''
}
${
  input.visualDirection
    ? `**Visual Direction**: ${input.visualDirection}
Prioritize scenes and imagery aligned with this direction.`
    : ''
}

**Character Context (pass verbatim to Story Director):**
${input.charactersContext || 'No characters defined.'}

**Location Context:**
${input.locationsContext || 'No locations defined.'}

${input.seasonContext ? `**Season Context:** ${input.seasonContext}` : ''}
${input.previousEpisodesContext ? `**Previous Episodes:** ${input.previousEpisodesContext}` : ''}
${
  input.verifiedFacts
    ? `
**Verified Facts (pass to Researcher and Fact Checker):**
${input.verifiedFacts}
`
    : ''
}
${
  input.threadCandidatesContext
    ? `
**NARRATIVE THREAD DIRECTIVES (pass verbatim to Story Director):**
The following threads MUST be addressed in this episode:
${input.threadCandidatesContext}

For PROGRESS threads: advance the storyline with new developments, but do NOT resolve.
For RESOLVE threads: bring this arc to a satisfying conclusion in this episode.
`
    : ''
}
${
  input.recurringElementsContext
    ? `
**Recurring Episode Elements (MANDATORY — pass verbatim to generateStory as recurringElements):**
${input.recurringElementsContext}
`
    : ''
}

Begin with Story Director. Pass all context verbatim. Evaluate with Viral Analyst. Check continuity. Apply one revision if needed. Stop.

Goal: story scores ≥ 0.65 viral with no continuity errors.`;
}
