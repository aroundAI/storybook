import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Brief } from '@kit/generation';
import { TEST_IDS, fakeRunHandle } from '@kit/generation/testing';

import {
  LLM_NOT_CONFIGURED_MESSAGE,
  gatewayBackend,
  isGatewayError,
  openRun,
  serverModelConfigured,
} from '../src';

/**
 * FILM-1911 criterion 4 (FR-25): a deployment that holds no key to any model
 * refuses server-mode generation with a message that says why, and before a
 * run exists, so no target is ever held. External runs and vendor renders
 * are unaffected. dispatch and write refuse too, and fail the run, in case
 * one was opened some other way.
 */

const MODEL_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'LLM_FORCE_PROVIDER',
];

function withoutModelKeys() {
  for (const key of MODEL_KEYS) vi.stubEnv(key, undefined);
}

const target = {
  type: 'episode' as const,
  id: TEST_IDS.episode,
  accountId: TEST_IDS.account,
  projectId: TEST_IDS.project,
  input: { kind: 'stage' as const, target: {} },
};

const origin = { kind: 'web' as const, name: 'spec' };

beforeEach(withoutModelKeys);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('whether this deployment can reach a model', () => {
  it('cannot with no key at all', () => {
    expect(serverModelConfigured()).toBe(false);
  });

  it.each([
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ])('can with %s', (key) => {
    vi.stubEnv(key, 'a-key');
    expect(serverModelConfigured()).toBe(true);
  });
});

describe('opening a run with no model configured', () => {
  it('refuses a server run with the message, before any run is written', async () => {
    const { ctx, state } = fakeRunHandle();

    const error = await openRun('story', target, origin, ctx).catch(
      (thrown: unknown) => thrown,
    );

    expect(isGatewayError(error, 'LLM_NOT_CONFIGURED')).toBe(true);
    expect((error as Error).message).toBe(LLM_NOT_CONFIGURED_MESSAGE);
    expect(state.rpcs.map((rpc) => rpc.fn)).not.toContain(
      'open_generation_run',
    );
  });

  it('opens an external run: Claude needs no key of ours', async () => {
    const { ctx, state } = fakeRunHandle();

    const run = await openRun('story', target, origin, {
      ...ctx,
      runMode: () => 'external',
    });

    expect(run.mode).toBe('external');
    expect(state.rpcs.map((rpc) => rpc.fn)).toContain('open_generation_run');
  });

  it('opens a vendor render, which reaches no model', async () => {
    const { ctx, state } = fakeRunHandle();

    const run = await openRun(
      'audio_render',
      { ...target, type: 'audio_cue' },
      origin,
      ctx,
    );

    expect(run.mode).toBe('server');
    expect(state.rpcs.map((rpc) => rpc.fn)).toContain('open_generation_run');
  });

  it('opens a server run once a key is set', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'a-key');
    const { ctx } = fakeRunHandle();

    const run = await openRun('story', target, origin, ctx);

    expect(run.mode).toBe('server');
  });
});

describe('a server run that exists anyway', () => {
  it('is not dispatched, and is failed so it holds nothing', async () => {
    const { run } = fakeRunHandle({ stage: 'story' });

    const error = await gatewayBackend
      .dispatch(run)
      .catch((thrown: unknown) => thrown);

    expect(isGatewayError(error, 'LLM_NOT_CONFIGURED')).toBe(true);
    expect(run.status).toBe('failed');
  });

  it('does not write, and is failed', async () => {
    const { run } = fakeRunHandle({ stage: 'story' });

    const error = await gatewayBackend
      .write(run, {} as Brief)
      .catch((thrown: unknown) => thrown);

    expect(isGatewayError(error, 'LLM_NOT_CONFIGURED')).toBe(true);
    expect(run.status).toBe('failed');
  });
});
