/**
 * Shot Generation Handler — Stage 3
 *
 * The `shots` stage of `@kit/generation` (FILM-1901): prepare → the Shot
 * Orchestrator (Reel Scout → Shot Director per scene → Shot Quality) →
 * outputSchema and check per part → commit. Commit replaces the episode's
 * shots and its `shot_list`, clears stale cues and tracks, and names the
 * chained `audio_cues` stage, which this handler opens as a child run of
 * the run it is executing (FILM-1903).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ShotOrchestratorResult } from '@kit/episodes/agent/shot-orchestrator';
import {
  type Brief,
  type CommitResult,
  type GenerateFn,
  REEL_SCOUT_PART,
  type ShotsBriefContext,
  type ShotsCommitData,
  type ShotsPartOutput,
  type ShotsTarget,
  renderPerformanceContext,
  runStage,
  scenePartKey,
  shotsStage,
} from '@kit/generation';
import {
  type LlmJobPayload,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface ShotGenerationResult {
  success: boolean;
  data: {
    totalShots: number;
    shotsCreated: number;
    metadata: ShotsCommitData['metadata'];
  };
}

export async function processShotGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<ShotGenerationResult> {
  const data = parseLlmJobPayload('shot-generation', payload);

  console.log(`[Shot Generation] Processing for episode ${data.episodeId}`);

  const target: ShotsTarget = {
    episodeId: data.episodeId,
    projectId: data.projectId,
    accountId: data.accountId,
    userId: data.userId,
    shotDuration: { min: data.shotDurationMin, max: data.shotDurationMax },
  };

  const ctx = workerCtx(supabase, data);

  const { commit } = await runStage(shotsStage, ctx, target, {
    ...stageRunDeps(),
    // FILM-1912: the block the run was opened with, for every scene prompt
    generate: orchestratedShots(
      data,
      renderPerformanceContext(ctx.performanceContext),
    ),
  });

  if (commit.status === 'committed') {
    await openFollowOn(supabase, data, commit);
  }

  return {
    success: true,
    data: {
      totalShots: commit.data.totalShots,
      shotsCreated: commit.data.shotsCreated,
      metadata: commit.data.metadata,
    },
  };
}

/**
 * The server writer: the orchestrator produces every part in one run, on
 * the first brief it is asked for; later briefs are answered from it.
 */
function orchestratedShots(
  data: LlmJobPayload<'shot-generation'>,
  performanceContext: string,
): GenerateFn {
  let outputs: Map<string, ShotsPartOutput> | undefined;

  return async (brief) => {
    outputs ??= await runOrchestratorForParts(brief, data, performanceContext);

    const output = outputs.get(brief.part.key);

    if (!output) {
      throw new Error(
        `The Shot Orchestrator produced nothing for part ${brief.part.key}`,
      );
    }

    return { output };
  };
}

async function runOrchestratorForParts(
  brief: Brief,
  data: LlmJobPayload<'shot-generation'>,
  performanceContext: string,
): Promise<Map<string, ShotsPartOutput>> {
  const context = brief.context as unknown as ShotsBriefContext;
  const { runShotOrchestrator } = await import(
    '@kit/episodes/agent/shot-orchestrator'
  );

  console.log(
    `[Shot Generation] Starting Shot Orchestrator — ${context.scenes.length} scenes`,
  );

  const result = await runShotOrchestrator({
    episodeId: data.episodeId,
    episodeTitle: context.episode.title,
    genre: context.genre,
    targetAudience: context.targetAudience,
    visualStyle: context.visualStyle,
    accountId: data.accountId,
    scenes: context.scenes,
    charactersVeoContext: context.charactersVeo || 'No characters defined.',
    locationsVeoContext: context.locationsVeo || 'No locations defined.',
    recurringElementsContext: context.recurringElements,
    shotDuration: context.shotDuration,
    performanceContext,
  });

  console.log(
    `[Shot Generation] Orchestrator completed — success: ${result.success}, ` +
      `shots: ${result.shots.length}, reel candidates: ${result.reelCandidateScenes.join(', ') || 'none'}, ` +
      `steps: ${result.orchestratorSteps}`,
  );

  if (!result.success) {
    throw new Error(
      `Shot Orchestrator failed: ${result.error ?? 'Unknown error'}`,
    );
  }

  if (result.shots.length === 0) {
    throw new Error(
      'Shot Director returned 0 shots. All scene-shot-generation LLM calls failed. ' +
        'Check CloudWatch for [Shot Director] error logs and verify scene-shot-generation prompt config.',
    );
  }

  return partOutputsFrom(
    result,
    context.scenes.map((scene) => scene.number),
  );
}

/** The orchestrator's one result, as the stage's parts. */
export function partOutputsFrom(
  result: ShotOrchestratorResult,
  sceneNumbers: number[],
): Map<string, ShotsPartOutput> {
  const outputs = new Map<string, ShotsPartOutput>();

  outputs.set(REEL_SCOUT_PART, {
    kind: 'reel_scout',
    sceneAnalyses: result.sceneAnalyses,
    topReelCandidates: result.reelCandidateScenes,
    orchestratorNote: result.orchestratorNote ?? '',
  } as ShotsPartOutput);

  for (const sceneNumber of sceneNumbers) {
    const scene = result.sceneResults?.find(
      (s) => s.sceneNumber === sceneNumber,
    );

    outputs.set(scenePartKey(sceneNumber), {
      kind: 'scene',
      sceneNumber,
      shots: result.shots.filter((shot) => shot.sceneNumber === sceneNumber),
      sceneSummary: scene?.sceneSummary,
      sceneViralScore: scene?.sceneViralScore,
      sceneHookType: scene?.sceneHookType,
      sceneStandaloneSummary: scene?.sceneStandaloneSummary,
    } as unknown as ShotsPartOutput);
  }

  return outputs;
}

/**
 * The dedicated audio pass follows every shot list. Commit names it; this
 * opens it as a child run of the run in scope (FILM-1903): the parent's
 * mode, user and account, with `parent_run_id` set. The worker runs server
 * runs only, so the child is a server run whose input is the audio-cue job,
 * which runs the Audio Cue Orchestrator; an external shots run's child is
 * opened by `finalizeRun` from the same follow-on and waits for the agent.
 */
async function openFollowOn(
  supabase: SupabaseClient<Database>,
  data: LlmJobPayload<'shot-generation'>,
  commit: CommitResult<ShotsCommitData>,
) {
  const audio = commit.followOns?.find((next) => next.stage === 'audio_cues');

  if (!audio) return;

  console.log('[Shot Generation] Opening the audio refinement run');

  const { jobRunTarget, requireRun } = await import('@kit/ai-gateway');
  const { openChildRun } = await import('@kit/generation');
  const { chainedLlmJobTarget } = await import('@kit/prompt-engine/server');
  const parent = requireRun('chaining audio cues');

  const audioRun = await openChildRun(
    parent,
    'audio_cues',
    jobRunTarget({
      jobType: 'audio-cue-generation',
      userId: data.userId,
      // The same episode this job's producer authorised (KB-31)
      target: chainedLlmJobTarget({
        accountId: data.accountId,
        projectId: data.projectId,
        episodeId: data.episodeId,
      }),
      payload: {
        episodeId: data.episodeId,
        projectId: data.projectId,
        accountId: data.accountId,
      },
    }),
    { kind: 'worker', name: 'shot-generation -> audio-cue-generation' },
    parent.ctx,
  );

  const { error } = await supabase.from('generation_jobs').insert({
    reference_type: 'episode',
    reference_id: data.episodeId,
    job_type: 'audio_cue_generation',
    status: 'queued',
    account_id: data.accountId,
    project_id: data.projectId,
    idempotency_key: `audio-cues-${data.episodeId}-${Date.now()}`,
    input_data: { episodeId: data.episodeId },
    run_id: audioRun.id,
  });

  if (error) {
    console.error('[Shot Generation] Failed to create audio cue job:', error);
  }

  if (audioRun.mode === 'server') {
    await audioRun.dispatch();
  }
}
