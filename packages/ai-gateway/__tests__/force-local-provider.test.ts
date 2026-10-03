import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunHandle } from '@kit/generation/testing';
import { createLLMClient } from '@kit/llm';

import { executeLLMForLambda } from '../src';
import { PROMPT_REGISTRY } from '../src/prompts/lambda-registry';

// FILM-1805 Half B: the Lambda executor follows the LLM_FORCE_PROVIDER=local
// switch, under the same gate, as the prompt-engine one. Both live in the
// gateway now (FILM-1902) and build their client in one place.

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  createLLMClient: vi.fn(() => ({
    createChatCompletion: async () => ({
      message: { role: 'assistant', content: '{"ok":true}' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
  })),
}));

// The executor logs every call (FILM-1902); this test is about the provider,
// so there is no service-role client to write through
vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => null,
}));

const slug = 'season-generation';
const variables = Object.fromEntries(
  Object.keys(PROMPT_REGISTRY[slug]!.variables).map((name) => [name, 'x']),
);

const clientConfig = async () => {
  const { run } = fakeRunHandle();

  await executeLLMForLambda({ run, templateSlug: slug, variables });

  return vi.mocked(createLLMClient).mock.calls[0]![0];
};

describe('executeLLMForLambda with LLM_FORCE_PROVIDER=local', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LLM_FORCE_PROVIDER', 'local');
    vi.stubEnv('LLM_MODEL', 'llama3.1');
    vi.stubEnv('LOCAL_API_URL', 'http://127.0.0.1:11434/v1');
    vi.stubEnv('GEMINI_API_KEY', 'not-a-real-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('runs on the local model, with the base URL, under the sandbox gate', async () => {
    vi.stubEnv('VENDOR_SANDBOX', '1');

    expect(await clientConfig()).toMatchObject({
      provider: 'local',
      model: 'llama3.1',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
  });

  it('stays on the prompt file’s provider outside the gate', async () => {
    vi.stubEnv('VENDOR_SANDBOX', '');

    expect(await clientConfig()).toMatchObject({
      provider: PROMPT_REGISTRY[slug]!.llm.provider,
    });
  });

  it('is never honoured in a Lambda', async () => {
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'llm-worker');

    expect(await clientConfig()).not.toMatchObject({ provider: 'local' });
  });
});
