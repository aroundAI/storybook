/**
 * What the LLM worker checks before a handler runs (KB-33, KB-49, FILM-1903).
 *
 * The message is `{ runId }`: the worker loads the run and refuses, without a
 * model call, anything that is not an open server-mode run. A replayed
 * message for a committed run is a no-op. The run's input says what to do:
 * a registered stage runs through the generation core; a job not yet on the
 * core runs through its handler, with the run in scope so the gateway's
 * executors find it. The job's user must still be able to write the job's
 * project.
 *
 * The old `{ jobType, userId, payload }` message is accepted for one release
 * (a message in flight when the worker is deployed), logged as legacy, and
 * runs with no run: the executors refuse it (LLM_NO_RUN), so it fails
 * loudly rather than reaching a model outside a run.
 *
 * Kept apart from `index.ts`, which builds its clients at import time, so it
 * can be tested on its own.
 */
import { withRun } from '@kit/ai-gateway';
import type { RunHandle } from '@kit/generation';
import {
  type LlmJobPayload,
  type LlmJobType,
  parseLlmJobMessage,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import {
  type LlmJobAuthzClient,
  QueuedJobRefused,
  assertQueuedJobAccess,
} from '@kit/prompt-engine/llm-job-target';

export interface LlmJobBoundaryDeps {
  supabase: LlmJobAuthzClient;
  dispatch: (
    jobType: LlmJobType,
    payload: LlmJobPayload<LlmJobType>,
  ) => Promise<unknown>;
  notify: (userId: string, message: Record<string, unknown>) => Promise<void>;
  /** The run named by a `{ runId }` message, or null when there is none */
  loadRun: (runId: string) => Promise<RunHandle | null>;
  /** Runs a registered stage under its run (executeServerRun) */
  runStage: (run: RunHandle) => Promise<unknown>;
}

/** The ids every payload carries or may carry, whatever its job type. */
interface JobTarget {
  accountId: string;
  projectId?: string;
  episodeId?: string;
}

function isRunMessage(body: unknown): body is { runId: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { runId?: unknown }).runId === 'string'
  );
}

/**
 * Runs one SQS message. Resolves `'refused'` for a job its user may no
 * longer run, or a run that is not an open server run: acknowledged, not
 * retried, because a refusal is an answer and a retry would only ask again.
 * Resolves `'replayed'` for a committed run. Throws for anything else that
 * fails, so the message is retried and then dead-lettered; a failure marks
 * the run failed first, so the retry finds a closed run and stops.
 */
export async function runLlmJob(
  body: string,
  deps: LlmJobBoundaryDeps,
): Promise<'done' | 'refused' | 'replayed'> {
  const parsed: unknown = JSON.parse(body);

  if (isRunMessage(parsed)) {
    return runFromMessage(parsed.runId, deps);
  }

  console.warn(
    '[LLM Worker] legacy message without a run id: accepted for one release, runs with no run',
  );

  return runLegacyJob(parsed, deps);
}

async function runFromMessage(
  runId: string,
  deps: LlmJobBoundaryDeps,
): Promise<'done' | 'refused' | 'replayed'> {
  const run = await deps.loadRun(runId);

  if (!run) {
    console.warn(`[LLM Worker] refused: run ${runId} does not exist`);
    return 'refused';
  }

  if (run.status === 'committed') {
    console.log(`[LLM Worker] run ${runId} is committed already: no-op replay`);
    return 'replayed';
  }

  if (run.mode !== 'server' || !run.isOpen()) {
    const why = `run ${runId} is ${run.mode} and ${run.status}${run.isOpen() ? '' : ' (not open)'}: the worker runs open server runs only`;
    console.warn(`[LLM Worker] refused: ${why}`);

    await deps.notify(run.createdBy, {
      type: 'llm-error',
      jobType: run.stage,
      runId,
      episodeId: run.targetType === 'episode' ? run.targetId : undefined,
      error: why,
      timestamp: new Date().toISOString(),
    });

    return 'refused';
  }

  const input = run.input;
  const jobType = input.kind === 'job' ? input.jobType : null;
  const payload =
    input.kind === 'job'
      ? parseLlmJobPayload(input.jobType, input.payload)
      : null;
  const target: JobTarget = payload ?? {
    accountId: run.accountId,
    projectId: run.projectId ?? undefined,
    episodeId: run.targetType === 'episode' ? run.targetId : undefined,
  };
  const label = jobType ?? run.stage;

  try {
    await assertQueuedJobAccess(deps.supabase, {
      userId: run.createdBy,
      accountId: target.accountId,
      projectId: target.projectId,
      episodeId: target.episodeId,
    });
  } catch (error) {
    if (!(error instanceof QueuedJobRefused)) throw error;

    console.warn(
      `[LLM Worker] refused ${label} for user ${run.createdBy.substring(0, 8)}: ${error.message}`,
    );

    await run.fail(error).catch(() => undefined);
    await deps.notify(run.createdBy, {
      type: 'llm-error',
      jobType: label,
      runId,
      episodeId: target.episodeId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    return 'refused';
  }

  await run.start();

  let result: unknown;

  try {
    if (jobType && payload) {
      result = await withRun(run, () => deps.dispatch(jobType, payload));
      await run.complete();
    } else {
      // executeServerRun moves the run to committed or failed itself
      result = await withRun(run, () => deps.runStage(run));
    }
  } catch (error) {
    if (jobType) await run.fail(error).catch(() => undefined);
    throw error;
  }

  await deps.notify(run.createdBy, {
    type: 'llm-result',
    jobType: label,
    runId,
    episodeId: target.episodeId,
    result,
    timestamp: new Date().toISOString(),
  });

  return 'done';
}

async function runLegacyJob(
  body: unknown,
  deps: LlmJobBoundaryDeps,
): Promise<'done' | 'refused'> {
  const job = parseLlmJobMessage(body);
  const target: JobTarget = job.payload;

  try {
    await assertQueuedJobAccess(deps.supabase, {
      userId: job.userId,
      accountId: target.accountId,
      projectId: target.projectId,
      episodeId: target.episodeId,
    });
  } catch (error) {
    if (!(error instanceof QueuedJobRefused)) throw error;

    console.warn(
      `[LLM Worker] refused ${job.jobType} for user ${job.userId.substring(0, 8)}: ${error.message}`,
    );

    await deps.notify(job.userId, {
      type: 'llm-error',
      jobType: job.jobType,
      episodeId: target.episodeId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    return 'refused';
  }

  const result = await deps.dispatch(job.jobType, job.payload);

  await deps.notify(job.userId, {
    type: 'llm-result',
    jobType: job.jobType,
    episodeId: target.episodeId,
    result,
    timestamp: new Date().toISOString(),
  });

  return 'done';
}

/** The user a message's failure is reported to, from either message shape. */
export function messageUserId(
  body: string,
  loaded?: { createdBy: string } | null,
): string | null {
  if (loaded) return loaded.createdBy;

  try {
    const { userId } = JSON.parse(body) as { userId?: unknown };

    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
}
