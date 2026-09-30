import { vendorSandboxEnabled } from '@kit/shared/vendors';

import { DEFAULT_LOCAL_MODEL } from './factory';

const FORCE_PROVIDER_VARIABLE = 'LLM_FORCE_PROVIDER';

/**
 * `LLM_FORCE_PROVIDER=local` sends every prompt and agent to the local model,
 * whatever provider its file pins (FILM-1805). It follows the sandbox gate of
 * every other override: outside it the variable is ignored, and named once
 * per process so a deploy that carries it says so.
 */
let warnedIgnored = false;

export function forcedLocalConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env[FORCE_PROVIDER_VARIABLE] !== 'local') return null;

  if (!vendorSandboxEnabled(env)) {
    if (!warnedIgnored) {
      warnedIgnored = true;
      console.warn(
        `${FORCE_PROVIDER_VARIABLE} is set and ignored: it only applies with NODE_ENV=development or test, VENDOR_SANDBOX=1, and a process that is not an AWS Lambda`,
      );
    }

    return null;
  }

  return {
    provider: 'local' as const,
    model: env.LLM_MODEL || DEFAULT_LOCAL_MODEL,
    apiKey: 'not-needed',
    baseUrl: env.LOCAL_API_URL || undefined,
  };
}

export function resetForcedLocalWarning() {
  warnedIgnored = false;
}
