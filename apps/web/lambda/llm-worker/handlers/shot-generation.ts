/**
 * Shot Generation Handler — Stage 3
 *
 * The `shots` stage of `@kit/generation` (FILM-1901): prepare → the Shot
 * Orchestrator (Reel Scout → Shot Director per scene → Shot Quality) →
 * outputSchema and check per part → commit. Commit replaces the episode's
 * shots and its `shot_list`, clears stale cues and tracks, and names the
 * chained `audio_cues` stage, which this handler queues as a job.
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
  runStage,
  scenePartKey,
  shotsStage,
} from '@kit/generation';
import {
  type LlmJobPayload,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { workerCtx } from '../utils/stage-runtime';

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

  const { commit } = await runStage(
    shotsStage,
    workerCtx(supabase, data),
    target,
    { generate: orchestratedShots(data) },
  );

  if (commit.status === 'committed') {
    await queueFollowOn(supabase, data, commit);
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
function orchestratedShots(data: LlmJobPayload<'shot-generation'>): GenerateFn {
  let outputs: Map<string, ShotsPartOutput> | undefined;

  return async (brief) => {
    outputs ??= await runOrchestratorForParts(brief, data);

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
 * The dedicated audio pass follows every shot list. Commit names it; the
 * worker queues it as a job here. FILM-1903 replaces this with a child run
 * opened in the parent's mode.
 */
async function queueFollowOn(
  supabase: SupabaseClient<Database>,
  data: LlmJobPayload<'shot-generation'>,
  commit: CommitResult<ShotsCommitData>,
) {
  const audio = commit.followOn?.find((next) => next.stage === 'audio_cues');

  if (!audio) return;

  console.log('[Shot Generation] Queuing audio refinement job');

  const { chainedLlmJobTarget, queueLlmJob } = await import(
    '@kit/prompt-engine/server'
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
  });

  if (error) {
    console.error('[Shot Generation] Failed to create audio cue job:', error);
  }

  await queueLlmJob({
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
  });
}
