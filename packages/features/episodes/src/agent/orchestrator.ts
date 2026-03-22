/**
 * Content Generation Orchestrator
 *
 * The Orchestrator is the top-level agent that coordinates all specialist agents
 * (Story Director, Viral Analyst, Continuity Guardian, Reel Scout) in a non-linear loop.
 *
 * The Orchestrator LLM decides:
 * - Which specialists to call and in what order
 * - Whether to route revision requests back to the Story Director
 * - Which scenes to flag for Reel Scout optimization
 * - When the quality bar has been met and to finalize
 *
 * This is NOT a hardcoded pipeline — the LLM drives the flow based on quality signals.
 */

import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { continuitySkill } from './skills/continuity-skill';
import { reelScoutSkill } from './skills/reel-scout-skill';
import { storyDirectorSkill } from './skills/story-director-skill';
import { viralAnalystSkill } from './skills/viral-analyst-skill';
import type { EpisodeViralQuality, ViralDimensionScores } from '../lib/types';

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
}

export interface OrchestratorResult {
    success: boolean;
    viralQuality: EpisodeViralQuality | null;
    storyText?: string;
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
}

/**
 * Runs the content generation Orchestrator for an episode.
 *
 * The Orchestrator coordinates:
 * 1. Story Director — generates/revises narrative
 * 2. Viral Analyst — evaluates viral quality across 7 dimensions
 * 3. Continuity Guardian — validates narrative against canon
 * 4. Reel Scout — identifies scenes as standalone Reel candidates
 *
 * Non-linear: the Orchestrator LLM decides the flow based on quality signals.
 * Max 8 agent steps to prevent runaway cost.
 *
 * @param input Episode details and configuration
 * @param supabase Supabase client for persisting results
 */
export async function runContentOrchestrator(
    input: OrchestratorInput,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: (table: string) => any },
): Promise<OrchestratorResult> {
    console.log(`[Orchestrator] Starting for episode ${input.episodeId}`);

    const result: AgentRunResult<OrchestratorOutput> = await runAgent<OrchestratorOutput>(
        {
            name: 'content-orchestrator',
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            tools: [],
            skills: [
                storyDirectorSkill,
                viralAnalystSkill,
                continuitySkill,
                reelScoutSkill,
            ],
            maxSteps: 8,
            budgetLimits: {
                maxTotalTokens: 150_000,
                maxCostUSD: 2.00,
                maxLatencyMs: 300_000,
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
            console.warn(`[Orchestrator] Failed to persist viral_quality: ${(error as { message: string }).message}`);
        } else {
            console.log(
                `[Orchestrator] viral_quality persisted. Score: ${viralQuality.overallScore}, Decision: ${viralQuality.decision}`,
            );
        }
    } catch (err) {
        console.warn('[Orchestrator] Persist error (non-fatal):', err);
    }

    return {
        success: true,
        viralQuality,
        storyText: output.finalStoryText,
        orchestratorSteps: result.steps.length,
    };
}

// =============================================================================
// PROMPTS
// =============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Content Generation Orchestrator — the director of a multi-agent creative production system.

You coordinate four specialist agents, each with a distinct role:

1. **Story Director** (generateStory) — Creates/revises narrative. Can be called with targeted revisionInstructions to fix specific weaknesses without regenerating the whole story.

2. **Viral Analyst** (evaluateContent) — Scores content on 7 viral dimensions. Returns whyThisWorks, whatToImprove, and topPriorities. Use this to decide whether to proceed or request revisions.

3. **Continuity Guardian** (buildMemoryContext → checkContinuity) — Validates the story against established canon. Prevents dead characters, state reversals, knowledge violations.

4. **Reel Scout** (analyzeScenes) — Evaluates each scene as a standalone Reel candidate. Returns per-scene textual reasoning and identifies top candidates.

## Your Decision Logic

**Non-linear flow** — you decide which agents to call based on quality signals:

1. ALWAYS start with Story Director (generateStory) to get the initial story
2. THEN run Viral Analyst + Continuity Guardian — these can inform each other
3. IF Viral Analyst score < 0.65 AND you haven't revised yet → call Story Director with revisionInstructions targeting the weakest dimensions
4. IF Continuity Guardian finds violations with severity=error → call Story Director with revisionInstructions to fix them
5. ONCE story quality is acceptable (score ≥ 0.65 OR 1 revision applied) → call Reel Scout with the screenplay scenes
6. Synthesize final output using all agent results

## Your Final Answer

When complete, return a JSON object with:
- overallScore (from Viral Analyst)
- decision: "pass" | "revised" | "flag"
- whyThisWorks: 2-3 sentence paragraph explaining viral strengths
- whatToImprove: 1-2 sentence paragraph on the main weakness
- dimensionScores: object with all 7 dimension scores (hookStrength, curiosityGap, emotionalArc, setupPayoff, dialogueSubtext, loopability, memorableMoment)
- revisionsApplied: array of strings describing changes made (empty if no revisions)
- reelCandidates: array from Reel Scout (sceneNumber, whyThisWorksAsReel, hookType, viralScore, estimatedDurationSeconds)
- finalStoryText: the final story text after any revisions`;

function buildOrchestratorPrompt(input: OrchestratorInput): string {
    return `Orchestrate content generation for this episode:

**Episode**: "${input.episodeTitle}"
**Logline**: ${input.episodeLogline}
**Genre**: ${input.genre}
**Target Audience**: ${input.targetAudience}
**Duration**: ${input.targetDurationSeconds} seconds
**Content Style**: ${input.contentStyle ?? 'dialogue-heavy'}
**Episode Number**: ${input.episodeNumber}
**Project ID**: ${input.projectId}

Begin by having the Story Director generate the story. Then evaluate with Viral Analyst and Continuity Guardian. Apply targeted revisions if needed. Finally, have the Reel Scout analyze scenes for short-form potential.

Your goal: produce a story that scores ≥ 0.65 on the viral quality framework, has no continuity errors, and has clear scene-level Reel candidate reasoning.`;
}
