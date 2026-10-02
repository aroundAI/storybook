/**
 * What is left of the SQS helper (FILM-1903 part B). `queueLlmJob` and the
 * queue client moved into `@kit/ai-gateway`: the only way onto the LLM jobs
 * queue is `run.dispatch()`, and the message is `{ runId }`. What stays is
 * the rule a job payload obeys about its authorised target (KB-31), which
 * `openRun`'s callers apply to the job they store on the run.
 *
 * A library, not a `'use server'` module (KB-58), and no `server-only`: the
 * LLM worker imports this.
 */
import type { LlmJobTarget } from './llm-job-target';

/**
 * The payload as stored on a run: the target's ids, never different ones. A
 * payload naming another project or episode than the authorised target is a
 * programming error, thrown before anything is written.
 */
export function payloadForTarget(
  target: LlmJobTarget,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of ['projectId', 'episodeId'] as const) {
    const named = payload[key];
    const authorised = target[key];

    if (named !== undefined && named !== authorised) {
      throw new Error(
        `queueLlmJob: payload.${key} is not the authorised target's ${key}`,
      );
    }
  }

  return {
    ...payload,
    accountId: target.accountId,
    ...(target.projectId !== undefined && { projectId: target.projectId }),
    ...(target.episodeId !== undefined && { episodeId: target.episodeId }),
  };
}
