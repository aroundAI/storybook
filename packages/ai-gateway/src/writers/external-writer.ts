/**
 * The external writer: nothing is generated here. An external run's part is
 * written by the agent and submitted over MCP, so asking it for output is
 * answered with the brief, as AWAITING_SUBMISSION. `run.write` refuses an
 * external run before it ever consults a writer; this is the writer a
 * caller that resolves one for an external run gets.
 */
import { type Brief, RunError, type RunHandle } from '@kit/generation';

export type ExternalWriter = (run: RunHandle, brief: Brief) => Promise<never>;

export function createExternalWriter(): ExternalWriter {
  return async (run, brief) => {
    throw new RunError(
      'AWAITING_SUBMISSION',
      `Run ${run.id} is external: part ${brief.part.key} is written by the agent and submitted, not generated here`,
      { brief, runId: run.id },
    );
  };
}
