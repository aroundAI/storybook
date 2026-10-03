/**
 * Whether this deployment can reach any model (FILM-1911, FR-25). A
 * deployment with no model key still serves external mode in full, since
 * Claude writes through the MCP connector with keys of its own; server mode
 * is refused up front with a message that says why, instead of failing at
 * the model call after a run already holds the target.
 */
import { forcedLocalConfig } from '@kit/llm';

import { GatewayError } from './errors';
import { getApiKeyForProvider } from './executors/model-client';

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'deepseek'] as const;

export const LLM_NOT_CONFIGURED_MESSAGE =
  'This deployment has no AI model configured, so server generation is off. Use Claude through the MCP connector instead.';

export function serverModelConfigured(): boolean {
  return (
    forcedLocalConfig() !== null ||
    PROVIDERS.some((provider) => getApiKeyForProvider(provider) !== '')
  );
}

export function modelNotConfigured(runId?: string) {
  return new GatewayError(
    'LLM_NOT_CONFIGURED',
    LLM_NOT_CONFIGURED_MESSAGE,
    runId,
  );
}
