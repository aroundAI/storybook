import 'server-only';

import { finalizeRun, getStage, loadRun, openRun } from '@kit/generation';

import type { RunApi } from './run-api';
import type { GenerationToolDeps } from './service';
import { createGenerationTools } from './tools';

/**
 * FILM-1903's run layer, called directly rather than through
 * `@kit/ai-gateway`: an external run neither writes through a model nor
 * dispatches, so it is opened without a backend, and any attempt to do
 * either refuses (NO_RUN_BACKEND, AWAITING_SUBMISSION).
 */
const runLayer: RunApi = {
  open: (stage, target, origin, ctx) => openRun(stage, target, origin, ctx),
  load: (runId, ctx) => loadRun(runId, ctx),
  finalize: async (run, ctx, parts) => {
    const { commit, children } = await finalizeRun(
      run as Parameters<typeof finalizeRun>[0],
      ctx,
      parts,
    );

    return { commit, children };
  },
  stage: getStage,
};

let configured: Partial<GenerationToolDeps> = {};

/**
 * What the app supplies the generation tools: the episode context loader,
 * which is built beside the Lambda worker and cannot be imported by this
 * package. Called once by the MCP route module.
 */
export function configureGenerationTools(deps: Partial<GenerationToolDeps>) {
  configured = { ...configured, ...deps };
}

/** What the route configured: the edit tools (FILM-1909) read the same episode context. */
export function configuredGenerationDeps(): Partial<GenerationToolDeps> {
  return configured;
}

/** The run layer and what the route configured: the Studio job tools (FILM-2007) open runs with it. */
export function generationToolDeps(): GenerationToolDeps {
  return { runs: runLayer, ...configured };
}

export const generationTools = createGenerationTools(generationToolDeps);

export { createGenerationTools } from './tools';
export { GenerationService, type GenerationToolDeps } from './service';
export type { McpRunCtx, RunApi, RunLike } from './run-api';
