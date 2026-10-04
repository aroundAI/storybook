import { defineStageWriter } from '@kit/ai-gateway';
import {
  type Brief,
  REEL_SCOUT_PART,
  type ShotsBriefContext,
  type ShotsPartOutput,
  type ShotsTarget,
  renderPerformanceContext,
  scenePartKey,
  shotsStage,
} from '@kit/generation';

import type { ShotOrchestratorResult } from '../shot-orchestrator';

/**
 * The Shot Orchestrator produces every part in one run, on the first brief
 * it is asked for; later briefs are answered from it. Every scene prompt
 * carries the performance block the run was opened with (FILM-1912), and
 * the orchestrator hands each flagged scene the Reel Scout's note (KB-178).
 */
export const shotsStageWriter = defineStageWriter(
  shotsStage,
  (_run, { ctx, target }) => {
    const performanceContext = renderPerformanceContext(ctx.performanceContext);
    let outputs: Map<string, ShotsPartOutput> | undefined;

    return async (brief) => {
      outputs ??= await runOrchestratorForParts(
        brief,
        target,
        performanceContext,
      );

      const output = outputs.get(brief.part.key);

      if (!output) {
        throw new Error(
          `The Shot Orchestrator produced nothing for part ${brief.part.key}`,
        );
      }

      return { output };
    };
  },
);

async function runOrchestratorForParts(
  brief: Brief,
  target: ShotsTarget,
  performanceContext: string,
): Promise<Map<string, ShotsPartOutput>> {
  const context = brief.context as unknown as ShotsBriefContext;
  const { runShotOrchestrator } = await import('../shot-orchestrator');

  console.log(
    `[Shot Generation] Starting Shot Orchestrator — ${context.scenes.length} scenes`,
  );

  const result = await runShotOrchestrator({
    episodeId: target.episodeId,
    episodeTitle: context.episode.title,
    genre: context.genre,
    targetAudience: context.targetAudience,
    visualStyle: context.visualStyle,
    accountId: target.accountId,
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
