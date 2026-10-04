import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_IDS, fakeRunHandle } from '@kit/generation/testing';
import { ActionRefusal } from '@kit/next/action-result';

import { isGatewayError, openRun, runRefusalMessage } from '../src';
import { refuseRunError } from '../src/refuse-run-error';

/**
 * Owner decision 2026-10-03: a team's daily spend cap applies to LLM spend
 * through the web app, server mode, only. It is checked when a server run
 * is opened, before the run row exists, against today's (UTC) priced usage
 * of the team's server runs. An external run (Claude over MCP) makes no
 * model call and is never capped; an ElevenLabs render is never capped.
 */

const mocks = vi.hoisted(() => ({
  createLambdaAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: mocks.createLambdaAdminClient,
}));

const NOW = new Date('2026-10-03T15:30:00.000Z');

const target = {
  type: 'episode' as const,
  id: TEST_IDS.episode,
  accountId: TEST_IDS.account,
  projectId: TEST_IDS.project,
  input: { kind: 'stage' as const, target: {} },
};

const origin = { kind: 'web' as const, name: 'spec' };

function spentToday(
  spentUsd: number | null,
  pricedCalls: number,
  unpricedCalls = 0,
) {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        spent_usd: spentUsd,
        priced_calls: pricedCalls,
        unpriced_calls: unpricedCalls,
      },
    ],
    error: null,
  });
}

function teamWithCap(cap: number | null) {
  const fake = fakeRunHandle();
  fake.state.settings.set(TEST_IDS.account, {
    server_generation_enabled: true,
    external_generation_enabled: true,
    default_mode: 'server',
    daily_llm_spend_cap_usd: cap,
  });
  return fake;
}

function opened(state: { rpcs: Array<{ fn: string }> }) {
  return state.rpcs.some((rpc) => rpc.fn === 'open_generation_run');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  mocks.rpc.mockReset();
  mocks.createLambdaAdminClient.mockReturnValue({ rpc: mocks.rpc });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('opening a server run against the daily spend cap', () => {
  it('opens with no cap, and reads no spend', async () => {
    const { ctx, state } = teamWithCap(null);

    const run = await openRun('story', target, origin, ctx);

    expect(run.mode).toBe('server');
    expect(opened(state)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens under the cap, having summed today from UTC midnight', async () => {
    spentToday(4.99, 12);
    const { ctx, state } = teamWithCap(5);

    await openRun('story', target, origin, ctx);

    expect(opened(state)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('llm_spend_since', {
      p_account_id: TEST_IDS.account,
      p_since: '2026-10-03T00:00:00.000Z',
    });
  });

  it('refuses at the cap, before any run row, naming the cap and the reset', async () => {
    spentToday(5, 12);
    const { ctx, state } = teamWithCap(5);

    const error = await openRun('story', target, origin, ctx).catch(
      (thrown: unknown) => thrown,
    );

    expect(isGatewayError(error, 'DAILY_SPEND_CAP_REACHED')).toBe(true);
    expect(opened(state)).toBe(false);
    expect((error as Error).message).toBe(
      'This team has reached its daily Gemini spend cap of $5.00: $5.00 spent today (UTC). The cap resets at 00:00 UTC (2026-10-04). Ask Claude to write it through the MCP connector, or raise the cap in Team settings under AI.',
    );
  });

  it('refuses over the cap, and says how many calls have no known cost', async () => {
    spentToday(7.25, 30, 3);
    const { ctx, state } = teamWithCap(5);

    const error = await openRun('story', target, origin, ctx).catch(
      (thrown: unknown) => thrown,
    );

    expect(isGatewayError(error, 'DAILY_SPEND_CAP_REACHED')).toBe(true);
    expect(opened(state)).toBe(false);
    expect((error as Error).message).toContain(
      '$7.25 spent today (UTC), not counting 3 calls whose cost is unknown',
    );
  });

  it('never refuses on calls of unknown cost alone', async () => {
    spentToday(null, 0, 40);
    const { ctx, state } = teamWithCap(0.5);

    await openRun('story', target, origin, ctx);

    expect(opened(state)).toBe(true);
  });

  it('opens an external run with spend over the cap, and reads no spend', async () => {
    spentToday(50, 100);
    const { ctx, state } = teamWithCap(5);

    const run = await openRun('story', target, origin, {
      ...ctx,
      runMode: () => 'external',
    });

    expect(run.mode).toBe('external');
    expect(opened(state)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens an MCP connection run with spend over the cap', async () => {
    spentToday(50, 100);
    const { ctx, state } = teamWithCap(5);

    const run = await openRun('story', target, origin, {
      ...ctx,
      connectionId: '19110000-0000-4000-8000-000000000001',
    });

    expect(run.mode).toBe('external');
    expect(opened(state)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens an ElevenLabs render with spend over the cap', async () => {
    spentToday(50, 100);
    const { ctx, state } = teamWithCap(5);

    const run = await openRun(
      'audio_render',
      { ...target, type: 'audio_cue' },
      origin,
      ctx,
    );

    expect(run.mode).toBe('server');
    expect(opened(state)).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens when today’s spend cannot be read: unmeasured is not over', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, state } = teamWithCap(5);

    await openRun('story', target, origin, ctx);

    expect(opened(state)).toBe(true);
    expect(errors.mock.calls.flat().join(' ')).toContain(
      'daily spend cap not checked',
    );
    errors.mockRestore();
  });
});

describe('what a Generate action shows', () => {
  it('words the cap refusal for the page', async () => {
    spentToday(6, 10);
    const { ctx } = teamWithCap(5);

    const error = await openRun('story', target, origin, ctx).catch(
      (thrown: unknown) => thrown,
    );

    expect(runRefusalMessage(error)).toBe((error as Error).message);
    expect(runRefusalMessage(error)).toContain('daily Gemini spend cap');
  });

  it('becomes a refusal value on every Generate action that words run refusals (KB-182)', async () => {
    spentToday(6, 10);
    const { ctx } = teamWithCap(5);

    const refused = await openRun('story', target, origin, ctx)
      .catch(refuseRunError)
      .catch((thrown: unknown) => thrown);

    expect(refused).toBeInstanceOf(ActionRefusal);
    expect((refused as Error).message).toContain(
      'daily Gemini spend cap of $5.00',
    );
  });
});
