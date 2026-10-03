/**
 * The run a piece of server code is working for, carried through async
 * calls. The worker wraps a handler that is not yet on the generation core
 * in `withRun(run, ...)`, so the executors its orchestrators and skills
 * call find the run without every call site threading it; a call with no
 * run in scope and none passed is refused (LLM_NO_RUN).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { RunHandle } from '@kit/generation';

import { GatewayError } from './errors';

const storage = new AsyncLocalStorage<RunHandle>();

export function withRun<T>(run: RunHandle, fn: () => Promise<T>): Promise<T> {
  return storage.run(run, fn);
}

export function currentRun(): RunHandle | undefined {
  return storage.getStore();
}

export function requireRun(what: string, explicit?: RunHandle): RunHandle {
  const run = explicit ?? currentRun();

  if (!run) {
    throw new GatewayError(
      'LLM_NO_RUN',
      `${what} needs a generation run: open one with openRun and call it from the run (FILM-1902)`,
    );
  }

  return run;
}
