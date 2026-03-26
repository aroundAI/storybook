/**
 * Shot Orchestrator
 *
 * Stage 3 of the 3-stage content generation pipeline.
 * Evaluates scenes for Reel/Shorts candidacy, then generates VEO 3.1 shots.
 *
 * Skills:
 *   - Reel Scout    (analyzeScenes)       — identify viral short-form candidates
 *   - Shot Director (generateShots)       — generate VEO 3.1 optimized shot list
 *
 * maxSteps: 16 — analyzeScenes(1) + generateShots(1–2 for large episode) = 3 worst case.
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

export interface ShotOrchestratorScene {
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
}

export interface ShotOrchestratorResult {
    success: boolean;
    shots: GeneratedShotResult[];
    reelCandidateScenes: number[];
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
 */
export async function runShotOrchestrator(
    input: ShotOrchestratorInput,
): Promise<ShotOrchestratorResult> {
    console.log(
        `[Shot Orchestrator] Starting for episode ${input.episodeId}. ` +
        `${input.scenes.length} scenes to process.`,
    );

    const result: AgentRunResult<ShotOrchestratorOutput> = await runAgent<ShotOrchestratorOutput>(
        {
            name: 'shot-orchestrator',
            systemPrompt: SHOT_SYSTEM_PROMPT,
            tools: [],
            skills: [reelScoutSkill, shotDirectorSkill],
            maxSteps: 16,
            budgetLimits: {
                maxTotalTokens: 400_000,
                maxCostUSD: 4.00,
                maxLatencyMs: 600_000,
            },
        },
        {
            userPrompt: buildShotPrompt(input),
        },
        { accountId: input.accountId },
    );

    if (!result.success || !result.data) {
        console.warn(`[Shot Orchestrator] Failed: ${result.error}`);
        return {
            success: false,
            shots: [],
            reelCandidateScenes: [],
            orchestratorSteps: result.steps.length,
            error: result.error,
        };
    }

    // Extract shots from tool steps (most reliable)
    type GenerateShotsResult = { shots?: GeneratedShotResult[] };
    type AnalyzeScenesResult = { topReelCandidates?: number[] };

    const shotsSteps = result.steps.filter(
        (s) => s.type === 'tool_call' && s.toolName === 'generateShots' && s.toolResult?.success,
    );
    const lastShotsStep = shotsSteps.at(-1);
    const shotsData = lastShotsStep?.toolResult?.data as GenerateShotsResult | undefined;
    const shots = (shotsData?.shots ?? []) as GeneratedShotResult[];

    const reelStep = result.steps.find(
        (s) => s.type === 'tool_call' && s.toolName === 'analyzeScenes' && s.toolResult?.success,
    );
    const reelData = reelStep?.toolResult?.data as AnalyzeScenesResult | undefined;
    const reelCandidateScenes = reelData?.topReelCandidates ?? [];

    // Log any failed generateShots steps so the error is visible in CloudWatch
    const failedShotsSteps = result.steps.filter(
        (s) => s.type === 'tool_call' && s.toolName === 'generateShots' && !s.toolResult?.success,
    );
    for (const step of failedShotsSteps) {
        console.error(
            `[Shot Orchestrator] generateShots tool call failed: ${step.toolResult?.error ?? JSON.stringify(step.toolResult)}`,
        );
    }

    console.log(
        `[Shot Orchestrator] Complete. Steps: ${result.steps.length}, ` +
        `Shots: ${shots.length}, Reel candidates: ${reelCandidateScenes.join(', ') || 'none'}`,
    );

    return {
        success: true,
        shots,
        reelCandidateScenes,
        orchestratorSteps: result.steps.length,
    };
}

const SHOT_SYSTEM_PROMPT = `You are the Shot Pipeline Director.

Your job: produce a complete VEO 3.1 optimized shot list for all screenplay scenes.

## Your Steps

1. Call analyzeScenes (Reel Scout) with all scenes. This identifies which scenes work best as standalone Reels/Shorts and returns topReelCandidates.
2. Call generateShots (Shot Director) with ALL scenes plus the reelCandidateScenes list from step 1.
   - The Shot Director will generate hook-optimized shots for reel candidate scenes.
   - Pass the VEO character and location context verbatim.
3. If analyzeScenes returns an error or fails for any reason, do NOT stop — immediately call generateShots with reelCandidateScenes set to []. Shot generation is the primary goal; reel analysis is optional enrichment that improves quality but is not required.
4. STOP after generateShots completes, unless the Shot Director explicitly requests batching for a very large episode (>12 scenes).

## CRITICAL CONSTRAINTS
- Pass VEO character context verbatim — character visual identities are non-negotiable.
- Do NOT generate story revisions or screenplay — only shots.
- Every scene MUST have at least one shot in the output.
- NEVER skip generateShots — even if analyzeScenes fails.

## Your Final Answer

Return a JSON object with:
- totalShotsGenerated: number of shots produced
- reelCandidates: scene numbers identified by Reel Scout (empty array if Reel Scout failed)
- completionNote: one sentence confirming completion`;

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

**Scenes to Process:**
${JSON.stringify(input.scenes, null, 2)}

Start with analyzeScenes (Reel Scout) to identify viral candidates, then call generateShots for all ${input.scenes.length} scenes.`;
}
