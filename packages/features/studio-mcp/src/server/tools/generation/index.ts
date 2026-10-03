import 'server-only';

import { getStage } from '@kit/generation';

import { McpToolError } from '../../../errors';
import type { RunApi } from './run-api';
import type { GenerationToolDeps } from './service';
import { createGenerationTools } from './tools';

function runLayerMissing(): never {
  throw new McpToolError(
    'INTERNAL',
    'Generation runs are not available on this server yet.',
  );
}

/** Replaced by FILM-1903's run layer once it is on main (#567). */
const pendingRunApi: RunApi = {
  open: async () => runLayerMissing(),
  load: async () => runLayerMissing(),
  finalize: async () => runLayerMissing(),
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

export const generationTools = createGenerationTools(() => ({
  runs: pendingRunApi,
  ...configured,
}));

export { createGenerationTools } from './tools';
export type { GenerationToolDeps } from './service';
export type { McpRunCtx, RunApi, RunLike } from './run-api';
