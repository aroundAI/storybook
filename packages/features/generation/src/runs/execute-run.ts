/**
 * Driving a registered stage under a run (FILM-1903). The worker calls
 * `executeServerRun` for a server run it loaded by id; the MCP finalize tool
 * (FILM-1908) calls `finalizeRun` with the parts the agent submitted. Both
 * end in the same commit, the same follow-on child runs and the same status
 * move, so neither path has rules of its own.
 */
import { StageOutputRejected, checkWithSchema } from '../checks';
import { getStage } from '../registry';
import { type RunStageResult, runStage } from '../run-stage';
import type {
  AnyStageDefinition,
  CommitResult,
  Ctx,
  GenerationUsage,
} from '../types';
import { RunError } from './errors';
import { openChildRun } from './open-run';
import type { RunHandle } from './run-handle';
import type { RunCtx } from './types';

/**
 * The `Ctx` a stage runs with under a run: the caller's, plus the revision
 * seam (every commit snapshots what it replaces into content_revisions)
 * and the origin columns, which exist since FILM-1903 part A.
 */
export function stageCtx(run: RunHandle, ctx: RunCtx): Ctx {
  return {
    ...ctx,
    revisions: { snapshot: async (input) => void (await run.snapshot(input)) },
    originColumnsAvailable: true,
  };
}

function stageTarget(run: RunHandle, stage: AnyStageDefinition): unknown {
  const input = run.input;

  if (input.kind !== 'stage') {
    throw new RunError(
      'RUN_STORE_ERROR',
      `Run ${run.id} carries a ${input.kind} input; a registered stage needs a stage target`,
      { runId: run.id },
    );
  }

  return stage.targetSchema.parse(input.target);
}

/**
 * The children a commit asks for, in the parent's mode: a server child is
 * queued for the worker, an external one waits for the agent.
 */
export async function openFollowOns(
  run: RunHandle,
  commit: CommitResult,
  ctx: RunCtx,
): Promise<RunHandle[]> {
  const children: RunHandle[] = [];

  for (const followOn of commit.followOns ?? []) {
    const child = await openChildRun(
      run,
      followOn.stage,
      followOn.target,
      { kind: run.origin.kind, name: `${run.stage} -> ${followOn.stage}` },
      ctx,
    );

    if (child.mode === 'server') {
      await child.dispatch();
    }

    children.push(child);
  }

  return children;
}

export interface ExecuteRunResult<TData = unknown>
  extends RunStageResult<TData> {
  children: RunHandle[];
}

/**
 * Prepare, write through the run, check and commit a server run's stage,
 * then mark it committed. A failure marks the run failed and rethrows; the
 * worker's retry then finds a closed run and does nothing.
 */
export async function executeServerRun<TData = unknown>(
  run: RunHandle,
  ctx: RunCtx,
): Promise<ExecuteRunResult<TData>> {
  if (run.mode !== 'server') {
    throw new RunError(
      'RUN_NOT_SERVER',
      `Run ${run.id} is ${run.mode}; the worker executes server runs only`,
      { runId: run.id },
    );
  }

  const stage = getStage(run.stage);
  const target = stageTarget(run, stage);
  const stageContext = stageCtx(run, ctx);

  try {
    const result = (await runStage(stage, stageContext, target, {
      generate: (brief) => run.write(brief),
      runId: run.id,
      beforeCommit: () => run.assertTargetUnchanged(),
      run: (usage) => run.toGenerationRun(usage),
    })) as RunStageResult<TData>;

    const children = await openFollowOns(run, result.commit, ctx);

    await run.complete();

    return { ...result, children };
  } catch (error) {
    await run.fail(error).catch(() => undefined);
    throw error;
  }
}

/**
 * Commit the parts an external agent submitted (FILM-1908 calls this from
 * finalize_generation): every part is checked again against the stage's
 * schema and `check`, the target version is re-read, and the commit, the
 * follow-ons and the status move are the server path's.
 */
export async function finalizeRun<TData = unknown>(
  run: RunHandle,
  ctx: RunCtx,
  parts: Array<{ key: string; output: unknown }>,
  usage?: GenerationUsage,
): Promise<ExecuteRunResult<TData>> {
  const stage = getStage(run.stage);
  const target = stageTarget(run, stage);
  const stageContext = stageCtx(run, ctx);

  await run.renewLease();

  if (!run.isOpen()) {
    throw new RunError(
      'RUN_NOT_OPEN',
      `Run ${run.id} is ${run.status}; it cannot be finalized`,
      { runId: run.id },
    );
  }

  try {
    const expected = await stage.parts(stageContext, target);
    const outputs: unknown[] = [];

    for (const part of expected) {
      const submitted = parts.find((p) => p.key === part.key);

      if (!submitted) {
        throw new StageOutputRejected(stage.key, part.key, [
          { path: '', code: 'missing', message: 'Part not submitted' },
        ]);
      }

      const checked = checkWithSchema(stage.outputSchema, submitted.output);

      if (!checked.ok) {
        throw new StageOutputRejected(stage.key, part.key, checked.errors);
      }

      const errors = await stage.check(
        stageContext,
        target,
        checked.value,
        part,
      );

      if (errors.length > 0) {
        throw new StageOutputRejected(stage.key, part.key, errors);
      }

      outputs.push(checked.value);
    }

    await run.assertTargetUnchanged();

    const generationRun = run.toGenerationRun(usage);
    const commit = (await stage.commit(
      stageContext,
      generationRun,
      target,
      outputs,
    )) as CommitResult<TData>;

    const children = await openFollowOns(run, commit, ctx);

    await run.complete();

    return { commit, usage, run: generationRun, children };
  } catch (error) {
    await run.fail(error).catch(() => undefined);
    throw error;
  }
}
