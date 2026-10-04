/**
 * Stage writers (KB-184): the server-mode write of a stage whose output an
 * orchestrator produces, not the brief's one prompt. They live beside the
 * orchestrators (`@kit/episodes/agent/stage-writers`), which this package
 * cannot import, and are installed here once by whatever runs server mode
 * (the worker, the sandbox leg). The server writer then reaches them
 * through `run.write(brief)`, so a job's run and a stage-input run take the
 * same path, under the same run checks and usage logging.
 */
import type { z } from 'zod';

import type {
  Brief,
  Ctx,
  GenerateResult,
  RunHandle,
  StageKey,
  WriteScope,
} from '@kit/generation';
import { ALL_STAGES } from '@kit/generation';

import { GatewayError } from '../errors';

export type StageWrite = (brief: Brief) => Promise<GenerateResult>;

export interface StageWriter {
  stage: StageKey;
  /**
   * Called once per run, on its first brief: an orchestrator writes every
   * part in one pass, and the write it returns answers the later briefs.
   */
  open(run: RunHandle, scope: WriteScope): StageWrite;
}

export function defineStageWriter<TTarget>(
  stage: {
    key: StageKey;
    targetSchema: z.ZodType<TTarget, z.ZodTypeDef, unknown>;
  },
  open: (run: RunHandle, scope: { ctx: Ctx; target: TTarget }) => StageWrite,
): StageWriter {
  return {
    stage: stage.key,
    open: (run, scope) =>
      open(run, { ctx: scope.ctx, target: scope.target as TTarget }),
  };
}

const installed = new Map<StageKey, StageWriter>();
const openWrites = new WeakMap<RunHandle, StageWrite>();

export function installStageWriters(writers: readonly StageWriter[]) {
  for (const writer of writers) {
    installed.set(writer.stage, writer);
  }
}

export function installedStageWriters(): StageKey[] {
  return [...installed.keys()];
}

function isOrchestrated(stage: StageKey) {
  return ALL_STAGES.some((s) => s.key === stage && s.orchestrated);
}

/**
 * The write for this run's stage when it has a stage writer, else null (the
 * brief's prompt is the write). An orchestrated stage with no writer
 * installed, or written without the scope runStage passes, is refused: the
 * prompt alone cannot produce its shape.
 */
export function stageWriteFor(
  run: RunHandle,
  brief: Brief,
  scope: WriteScope | undefined,
): StageWrite | null {
  const opened = openWrites.get(run);

  if (opened) return opened;

  const writer = installed.get(brief.stage);

  if (!writer) {
    if (!isOrchestrated(brief.stage)) return null;

    throw new GatewayError(
      'STAGE_WRITER_MISSING',
      `${brief.stage} is written by its orchestrator, and no stage writer is installed for it: call installStageWriters(STAGE_WRITERS) from @kit/episodes/agent/stage-writers`,
      run.id,
    );
  }

  if (!scope) {
    throw new GatewayError(
      'STAGE_WRITER_MISSING',
      `${brief.stage} is written by its orchestrator, which needs the stage's target: write it through runStage or executeServerRun`,
      run.id,
    );
  }

  const write = writer.open(run, scope);
  openWrites.set(run, write);

  return write;
}
