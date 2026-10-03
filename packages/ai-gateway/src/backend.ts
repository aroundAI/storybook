/**
 * What a server-mode run reaches when it writes or dispatches. Business
 * code opens runs through this package's `openRun`, which is
 * `@kit/generation`'s constructor with this backend attached; the run then
 * decides, by its mode, whether either is ever called.
 */
import {
  RENDER_STAGES,
  type RunBackend,
  type RunCtx,
  type RunHandle,
  type RunOrigin,
  type RunTarget,
  type StageKey,
  openRun as openRunWithBackend,
  resolveRunMode,
} from '@kit/generation';

import { sendRunMessage } from './dispatch';
import {
  modelNotConfigured,
  serverModelConfigured,
} from './model-availability';
import { resolveWriter } from './writers/resolve-writer';

/**
 * Defence in depth for FILM-1911: openRun refuses first, so a server run on
 * a deployment with no model reaches here only if it was opened another
 * way. It is failed, so it holds its target no longer than this call.
 */
async function refuseWithoutModel(run: RunHandle) {
  if (
    run.mode !== 'server' ||
    RENDER_STAGES.has(run.stage) ||
    serverModelConfigured()
  ) {
    return;
  }

  const error = modelNotConfigured(run.id);

  await run.fail(error).catch(() => undefined);

  throw error;
}

export const gatewayBackend: RunBackend = {
  write: async (run, brief) => {
    await refuseWithoutModel(run);

    return resolveWriter(run)(run, brief);
  },
  dispatch: async (run) => {
    await refuseWithoutModel(run);

    return sendRunMessage(run);
  },
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
 *
 * On a deployment with no model (FILM-1911), a run that would be server
 * mode is refused with LLM_NOT_CONFIGURED before it is written, so it never
 * holds its target. The mode is resolved first only then, so a deployment
 * with a model pays no extra read.
 */
export async function openRun(
  stage: StageKey,
  target: RunTarget,
  origin: RunOrigin,
  ctx: RunCtx,
) {
  const gatewayCtx = withGateway(ctx);

  if (
    !serverModelConfigured() &&
    (await resolveRunMode(stage, target.accountId, gatewayCtx)) === 'server' &&
    !RENDER_STAGES.has(stage)
  ) {
    throw modelNotConfigured();
  }

  return openRunWithBackend(stage, target, origin, gatewayCtx);
}
