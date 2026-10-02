/**
 * The one place a model client is built (FILM-1902). The provider and model
 * come from the prompt file, or from LLM_FORCE_PROVIDER=local; the key from
 * the environment. Nothing outside this package imports `@kit/llm`.
 */
import {
  type LLMClient,
  type LLMProvider,
  createLLMClient,
  forcedLocalConfig,
} from '@kit/llm';

export function getApiKeyForProvider(provider: LLMProvider | string): string {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY ?? '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ?? '';
    case 'gemini':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY ?? '';
    case 'local':
      return 'not-needed';
    default:
      return '';
  }
}

export interface ResolvedModel {
  provider: string;
  model: string;
  client: LLMClient;
}

/**
 * The client for `requested`, unless LLM_FORCE_PROVIDER points every call
 * at a local model. `requireKey` makes a missing key an error up front (the
 * worker's behaviour); the web executor lets the provider report it.
 */
export function resolveModelClient(
  requested: { provider: string; model: string },
  options: { requireKey?: boolean } = {},
): ResolvedModel {
  const forcedLocal = forcedLocalConfig();
  const provider = forcedLocal?.provider ?? requested.provider;
  const model = forcedLocal?.model ?? requested.model;
  const apiKey = forcedLocal?.apiKey ?? getApiKeyForProvider(provider);

  if (options.requireKey && !apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  const client = createLLMClient(
    forcedLocal ?? {
      provider: provider as LLMProvider,
      model,
      apiKey,
      baseUrl: provider === 'local' ? process.env.LOCAL_API_URL : undefined,
      vertexai: provider === 'gemini' && process.env.GEMINI_VERTEXAI === 'true',
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    },
  );

  return { provider, model, client };
}
