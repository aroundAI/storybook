/**
 * The server writer (FILM-1902): what `run.write(brief)` reaches for a
 * server-mode run. It renders the brief's prompt with the brief's variables
 * through the Lambda executor, which refuses before any model call unless
 * the run is an open server run and writes the usage row with the run id.
 */
import type { Brief, GenerateResult, RunHandle } from '@kit/generation';

import { executeLLMForLambda } from '../executors/execute-llm-lambda';

export type ServerWriter = (
  run: RunHandle,
  brief: Brief,
) => Promise<GenerateResult>;

export interface ServerWriterDeps {
  /** The executor; the real one unless a test stubs it */
  execute?: typeof executeLLMForLambda;
}

export function createServerWriter(deps: ServerWriterDeps = {}): ServerWriter {
  const execute = deps.execute ?? executeLLMForLambda;

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
