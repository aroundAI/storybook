/**
 * The server writer (FILM-1902): what `run.write(brief)` reaches for a
 * server-mode run. It renders the brief's prompt with the brief's variables
 * through the Lambda executor, which refuses before any model call unless
 * the run is an open server run and writes the usage row with the run id.
 *
 * A stage whose output an orchestrator produces is written by its installed
 * stage writer instead (KB-184), inside the run, so its agent steps and
 * executor calls are checked against the run and logged with its id.
 */
import type {
  Brief,
  GenerateResult,
  RunHandle,
  WriteScope,
} from '@kit/generation';

import { executeLLMForLambda } from '../executors/execute-llm-lambda';
import { withRun } from '../run-context';
import { stageWriteFor } from './stage-writers';

export type ServerWriter = (
  run: RunHandle,
  brief: Brief,
  scope?: WriteScope,
) => Promise<GenerateResult>;

export interface ServerWriterDeps {
  /** The executor; the real one unless a test stubs it */
  execute?: typeof executeLLMForLambda;
  /** The brief's-prompt write; the executor's unless a test stubs it */
  prompt?: ServerWriter;
}

export function createServerWriter(deps: ServerWriterDeps = {}): ServerWriter {
  const prompt =
    deps.prompt ?? promptWriter(deps.execute ?? executeLLMForLambda);

  return async (run, brief, scope) => {
    const stageWrite = stageWriteFor(run, brief, scope);

    if (stageWrite) return withRun(run, () => stageWrite(brief));

    return prompt(run, brief);
  };
}

function promptWriter(execute: typeof executeLLMForLambda): ServerWriter {
  return async (run, brief) => {
    const result = await execute<unknown>({
      run,
      templateSlug: brief.prompt.slug,
      variables: brief.prompt.variables,
      operationName: `${brief.stage}:${brief.part.key}`,
    });

    return {
      output: result.data,
      usage: {
        provider: result.metadata.provider,
        model: result.metadata.model,
        tokens: result.metadata.tokens,
        latencyMs: result.metadata.latency,
      },
    };
  };
}
