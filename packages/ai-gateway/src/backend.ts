/**
 * What a server-mode run reaches when it writes or dispatches. Business
 * code opens runs through this package's `openRun`, which is
 * `@kit/generation`'s constructor with this backend attached; the run then
 * decides, by its mode, whether either is ever called.
 */
import {
  type RunBackend,
  type RunCtx,
  type RunOrigin,
  type RunTarget,
  type StageKey,
  openRun as openRunWithBackend,
} from '@kit/generation';

import { sendRunMessage } from './dispatch';
import { resolveWriter } from './writers/resolve-writer';

export const gatewayBackend: RunBackend = {
  write: (run, brief) => resolveWriter(run)(run, brief),
  dispatch: (run) => sendRunMessage(run),
};

/** `Ctx` for a run that writes and dispatches through the gateway. */
export function withGateway<T extends RunCtx>(ctx: T): T & RunCtx {
  return { ...ctx, backend: gatewayBackend };
}

/**
 * The only constructor of a run, bound to the gateway. Web server actions
 * and the worker call this one; the MCP tools (FILM-1908) call
 * `@kit/generation`'s directly, with their request context, since an
 * external run neither writes through a model nor dispatches.
 */
export function openRun(
  stage: StageKey,
  target: RunTarget,
  origin: RunOrigin,
  ctx: RunCtx,
) {
  return openRunWithBackend(stage, target, origin, withGateway(ctx));
}
