/**
 * The server-mode runner: prepare → generate → outputSchema → check →
 * commit, once per part, with the generation_jobs bookkeeping a tracked
 * stage owes. A worker handler is this call plus the job's payload
 * parsing; the MCP tools (FILM-1908) call the same stage methods with the
 * agent's submission in place of `generate`.
 */
import { StageOutputRejected, checkWithSchema } from './checks';
import { markJobCompleted, markJobFailed, markJobProcessing } from './jobs';
import { serverRun } from './run';
import type {
  Brief,
  CommitResult,
  Ctx,
  GenerateFn,
  GenerationRun,
  GenerationUsage,
  StageDefinition,
} from './types';

export interface RunStageResult<TData> {
  commit: CommitResult<TData>;
  usage?: GenerationUsage;
  run: GenerationRun;
}

export interface RunStageDeps {
  generate: GenerateFn;
  runId?: string;
  /**
   * Runs after every part is checked and before commit: the run handle's
   * TARGET_CHANGED check (FILM-1903). A throw here commits nothing.
   */
  beforeCommit?: () => Promise<void>;
  /** The run commit stamps; defaults to a server run built from the brief */
  run?: (usage: GenerationUsage | undefined, brief?: Brief) => GenerationRun;
}

export async function runStage<TTarget, TOut, TData>(
  stage: StageDefinition<TTarget, TOut, TData>,
  ctx: Ctx,
  target: TTarget,
  deps: RunStageDeps,
): Promise<RunStageResult<TData>> {
  const tracking = stage.jobTracking;
  const reference = tracking?.reference(target);

  if (tracking && reference) {
    await markJobProcessing(ctx.client, reference.id, tracking.jobType);
  }

  try {
    const parts = await stage.parts(ctx, target);
    const outputs: TOut[] = [];
    let usage: GenerationUsage | undefined;
    let lastBrief: Brief | undefined;
    let diagnostics: Record<string, unknown> | undefined;

    for (const part of parts) {
      const brief = await stage.prepare(ctx, target, part, outputs);
      brief.runId = deps.runId;
      lastBrief = brief;

      const generated = await deps.generate(brief);

      if (generated.usage) {
        usage = usage
          ? {
              ...generated.usage,
              tokens: usage.tokens + generated.usage.tokens,
              latencyMs:
                (usage.latencyMs ?? 0) + (generated.usage.latencyMs ?? 0),
            }
          : generated.usage;
      }

      if (generated.diagnostics) {
        diagnostics = { ...diagnostics, ...generated.diagnostics };
      }

      const checked = checkWithSchema(stage.outputSchema, generated.output);

      if (!checked.ok) {
        throw new StageOutputRejected(stage.key, part.key, checked.errors);
      }

      const errors = await stage.check(ctx, target, checked.value, part);

      if (errors.length > 0) {
        throw new StageOutputRejected(stage.key, part.key, errors);
      }

      outputs.push(checked.value);
    }

    await deps.beforeCommit?.();

    const run = deps.run
      ? { ...deps.run(usage, lastBrief), diagnostics }
      : serverRun({ brief: lastBrief, usage, runId: deps.runId, diagnostics });

    const commit = await stage.commit(ctx, run, target, outputs);

    return { commit, usage, run };
  } catch (error) {
    if (tracking && reference) {
      await markJobFailed(
        ctx.client,
        reference.id,
        tracking.jobType,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    throw error;
  }
}

export { markJobCompleted };
