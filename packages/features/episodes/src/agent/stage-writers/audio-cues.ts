import { defineStageWriter } from '@kit/ai-gateway';
import {
  type AudioCuesBriefContext,
  type AudioCuesTarget,
  type GenerateResult,
  audioCuesStage,
  cuePartKey,
} from '@kit/generation';
import type { AudioCueGenerationOutput } from '@kit/prompt-engine/schemas';

import type { AudioCueOrchestratorResult } from '../audio-cue-orchestrator';

/**
 * Above this many shots the orchestrator runs once per scene: its 40K token
 * budget cannot take 70+ shots in one pass.
 */
const BATCH_THRESHOLD = 50;

type Cue = AudioCueGenerationOutput['cues'][number];

/**
 * The Audio Cue Orchestrator (generate → evaluate coverage, gaps and
 * overlaps → revise once), once (or once per scene for a long episode) on
 * the first brief; each scene part is then answered with the cues that
 * start on its shots.
 */
export const audioCuesStageWriter = defineStageWriter(
  audioCuesStage,
  (_run, { target }) => {
    let produced:
      | { outputs: Map<string, Cue[]>; diagnostics: Record<string, unknown> }
      | undefined;
    let first = true;

    return async (brief) => {
      produced ??= await runOrchestratorForParts(
        brief.context as unknown as AudioCuesBriefContext,
        target,
      );

      const result: GenerateResult = {
        output: { cues: produced.outputs.get(brief.part.key) ?? [] },
        diagnostics: first ? produced.diagnostics : undefined,
      };
      first = false;

      return result;
    };
  },
);

async function runOrchestratorForParts(
  context: AudioCuesBriefContext,
  target: AudioCuesTarget,
) {
  const { runAudioCueOrchestrator } = await import('../audio-cue-orchestrator');

  const shots = context.allShots;
  const batchedByScene = shots.length > BATCH_THRESHOLD;
  let cues: Cue[] = [];
  let orchestratorSteps = 0;
  let coveragePercent: number | undefined;

  if (!batchedByScene) {
    console.log(
      `[Audio Generation] Single-pass mode: ${shots.length} shots, ${context.totalDurationSeconds}s`,
    );

    const result = await runAudioCueOrchestrator({
      episodeId: target.episodeId,
      accountId: target.accountId,
      shotsJson: JSON.stringify(shots),
      totalDurationSeconds: context.totalDurationSeconds,
    });

    if (!result.success) {
      throw new Error(
        `Audio Cue Orchestrator failed: ${result.error ?? 'Unknown error'}`,
      );
    }

    cues = result.cues;
    orchestratorSteps = result.orchestratorSteps;
    coveragePercent = result.coveragePercent;
  } else {
    console.log(
      `[Audio Generation] Scene-batch mode: ${shots.length} shots across ${context.groups.length} scenes, ${context.totalDurationSeconds}s total`,
    );

    let weightedCoverage = 0;
    let evaluatedDuration = 0;

    for (const group of context.groups) {
      const sequences = new Set(group.shotSequences);
      const sceneShots = shots.filter((shot) => sequences.has(shot.seq));

      console.log(
        `[Audio Generation] Processing ${group.partKey}: ${sceneShots.length} shots, ${group.durationSeconds}s`,
      );

      const result: AudioCueOrchestratorResult = await runAudioCueOrchestrator({
        episodeId: target.episodeId,
        accountId: target.accountId,
        shotsJson: JSON.stringify(sceneShots),
        totalDurationSeconds: group.durationSeconds,
      });

      orchestratorSteps += result.orchestratorSteps;

      if (!result.success) {
        console.warn(
          `[Audio Generation] ${group.partKey} failed: ${result.error}. Continuing with remaining scenes.`,
        );
        continue;
      }

      if (result.coveragePercent !== undefined) {
        weightedCoverage += result.coveragePercent * group.durationSeconds;
        evaluatedDuration += group.durationSeconds;
      }

      cues.push(...result.cues);
    }

    coveragePercent =
      evaluatedDuration > 0
        ? Math.round(weightedCoverage / evaluatedDuration)
        : 0;

    if (cues.length === 0) {
      throw new Error(
        `Audio Cue Orchestrator produced 0 cues across all ${context.groups.length} scenes`,
      );
    }
  }

  console.log(
    `[Audio Generation] Orchestrator complete. Steps: ${orchestratorSteps}, ` +
      `Cues: ${cues.length}, Coverage: ${coveragePercent ?? 'N/A'}%`,
  );

  return {
    outputs: cuesByPart(cues, context),
    diagnostics: { orchestratorSteps, coveragePercent, batchedByScene },
  };
}

/**
 * Each cue goes to the part of the scene its first shot is in. A cue on a
 * shot the episode does not have is dropped with a warning, as the handler
 * always dropped it (the stage's check would refuse it).
 */
export function cuesByPart(
  cues: Cue[],
  context: Pick<AudioCuesBriefContext, 'groups'>,
): Map<string, Cue[]> {
  const sceneOfShot = new Map<number, number | null>();

  for (const group of context.groups) {
    for (const seq of group.shotSequences) {
      sceneOfShot.set(seq, group.sceneNumber);
    }
  }

  const outputs = new Map<string, Cue[]>();

  for (const cue of cues) {
    if (!sceneOfShot.has(cue.startShotSequence)) {
      console.warn(
        `[Audio Generation] Cue references unknown shot sequence: ${cue.startShotSequence}`,
      );
      continue;
    }

    const key = cuePartKey(sceneOfShot.get(cue.startShotSequence) ?? null);
    outputs.set(key, [...(outputs.get(key) ?? []), cue]);
  }

  return outputs;
}
