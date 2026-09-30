import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCAL_MODEL } from '../src/factory';
import { forcedLocalConfig, resetForcedLocalWarning } from '../src/force-local';

const sandbox = {
  NODE_ENV: 'test',
  VENDOR_SANDBOX: '1',
  LLM_FORCE_PROVIDER: 'local',
};

describe('LLM_FORCE_PROVIDER=local (FILM-1805)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    resetForcedLocalWarning();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off when the variable is not set', () => {
    expect(
      forcedLocalConfig({ ...sandbox, LLM_FORCE_PROVIDER: '' }),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes to local with LLM_MODEL and LOCAL_API_URL under the sandbox gate', () => {
    expect(
      forcedLocalConfig({
        ...sandbox,
        LLM_MODEL: 'qwen2.5',
        LOCAL_API_URL: 'http://127.0.0.1:11500/v1',
      }),
    ).toEqual({
      provider: 'local',
      model: 'qwen2.5',
      apiKey: 'not-needed',
      baseUrl: 'http://127.0.0.1:11500/v1',
    });
  });

  it('falls back to the Ollama default model and leaves the base URL to the client', () => {
    expect(forcedLocalConfig(sandbox)).toMatchObject({
      model: DEFAULT_LOCAL_MODEL,
      baseUrl: undefined,
    });
  });

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['no sandbox flag', { VENDOR_SANDBOX: '' }],
    ['a Lambda', { AWS_LAMBDA_FUNCTION_NAME: 'llm-worker' }],
  ])('is ignored, and named in a warning, in %s', (_, override) => {
    const env = { ...sandbox, ...override };

    expect(forcedLocalConfig(env)).toBeNull();
    expect(forcedLocalConfig(env)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('LLM_FORCE_PROVIDER'),
    );
  });
});
