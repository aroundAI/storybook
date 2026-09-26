/**
 * What the LLM worker checks before a handler runs (KB-33, KB-49).
 *
 * The message and its payload are parsed with the schemas the producer used
 * (`@kit/prompt-engine/llm-job-payloads`), and the job's user must still be
 * able to write to the job's project. Kept apart from `index.ts`, which
 * builds its clients at import time, so it can be tested on its own.
 */
import {
  type LlmJobPayload,
  type LlmJobType,
  parseLlmJobMessage,
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
}

/** The ids every payload carries or may carry, whatever its job type. */
interface JobTarget {
  accountId: string;
  projectId?: string;
  episodeId?: string;
}

/**
 * Runs one SQS message. Resolves `'refused'` for a job its user may no
 * longer run — acknowledged, not retried: a refusal is an answer, and a
 * retry would only ask again. Throws for anything else that fails, so the
 * message is retried and then dead-lettered.
 */
export async function runLlmJob(
  body: string,
  deps: LlmJobBoundaryDeps,
): Promise<'done' | 'refused'> {
  const job = parseLlmJobMessage(JSON.parse(body));
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
