import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentRun } from '@kit/ai-gateway';
import type { RunHandle } from '@kit/generation';
import { fakeRunHandle } from '@kit/generation/testing';
import type { LlmJobAuthzClient } from '@kit/prompt-engine/llm-job-target';

import { runLlmJob } from '../job-boundary';

/**
 * KB-33, KB-49, FILM-1903. What the LLM worker checks before any handler
 * runs: the message names a run, the run is an open server run, its input
 * parses with the producer's schema, and the run's user can still write the
 * run's project. A replayed message for a committed run is a no-op; an
 * external or closed run is refused without a model call.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const WRITER = '44444444-4444-4444-8444-444444444444';
const REVOKED = '55555555-5555-4555-8555-555555555555';

const dispatch = vi.fn();
const notify = vi.fn();
const runStage = vi.fn();

function supabase(): LlmJobAuthzClient {
  return {
    from(relation: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data:
            relation === 'episodes'
              ? { project_id: PROJECT, deleted_at: null }
              : { account_id: ACCOUNT },
          error: null,
        }),
      };
      return builder;
    },
    rpc: (_fn: string, args: object) =>
      Promise.resolve({
        data: (args as { target_user_id: string }).target_user_id === WRITER,
        error: null,
      }),
  };
}

const payload = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT,
  projectId: PROJECT,
  episodeId: EPISODE,
  userId: WRITER,
  version: 3,
  ...overrides,
});

function jobRun(
  options: Parameters<typeof fakeRunHandle>[0] = {},
  payloadOverrides: Record<string, unknown> = {},
) {
  return fakeRunHandle({
    stage: 'shots',
    targetId: EPISODE,
    accountId: ACCOUNT,
    projectId: PROJECT,
    createdBy: WRITER,
    input: {
      kind: 'job',
      jobType: 'shot-generation',
      payload: payload(payloadOverrides),
    },
    ...options,
  });
}

function deps(runs: RunHandle[]) {
  return {
    supabase: supabase(),
    dispatch,
    notify,
    runStage,
    loadRun: async (id: string) => runs.find((run) => run.id === id) ?? null,
  };
}

const message = (run: RunHandle) => JSON.stringify({ runId: run.id });

beforeEach(() => {
  dispatch.mockReset();
  dispatch.mockResolvedValue({ ok: true });
  notify.mockReset();
  notify.mockResolvedValue(undefined);
  runStage.mockReset();
  runStage.mockResolvedValue({ commit: { status: 'committed' } });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('runLlmJob with a { runId } message', () => {
  it('runs a writer’s job with the parsed payload, under the run, and marks it committed', async () => {
    const { run } = jobRun();
    let runInScope: RunHandle | undefined;
    dispatch.mockImplementation(async () => {
      runInScope = currentRun();
      return { ok: true };
    });

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('done');

    expect(dispatch).toHaveBeenCalledWith(
      'shot-generation',
      expect.objectContaining({ episodeId: EPISODE, version: 3 }),
    );
    expect(runInScope).toBe(run);
    expect(run.status).toBe('committed');
    expect(notify).toHaveBeenCalledWith(
      WRITER,
      expect.objectContaining({
        type: 'llm-result',
        jobType: 'shot-generation',
        runId: run.id,
        episodeId: EPISODE,
        result: { ok: true },
      }),
    );
  });

  it('runs a registered stage through the generation core when the input is a stage target', async () => {
    const { run } = fakeRunHandle({
      stage: 'story_refinement',
      targetId: EPISODE,
      createdBy: WRITER,
      input: { kind: 'stage', target: { episodeId: EPISODE, feedback: 'x' } },
    });

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('done');

    expect(runStage).toHaveBeenCalledWith(run);
    expect(dispatch).not.toHaveBeenCalled();
    expect(run.status).toBe('in_progress'); // executeServerRun moves it itself
  });

  it('refuses an external run without a model call, and tells the user', async () => {
    const { run } = jobRun({ mode: 'external' });

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('refused');

    expect(dispatch).not.toHaveBeenCalled();
    expect(runStage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      WRITER,
      expect.objectContaining({
        type: 'llm-error',
        runId: run.id,
        error: expect.stringContaining('external'),
      }),
    );
  });

  it.each([
    ['cancelled', { status: 'cancelled' as const }],
    ['failed', { status: 'failed' as const }],
    ['expired', { status: 'expired' as const }],
    [
      'past its lease',
      { leaseExpiresAt: new Date(Date.now() - 1).toISOString() },
    ],
  ])('refuses a run that is %s', async (_name, options) => {
    const { run } = jobRun(options);

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('refused');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('treats a replayed message for a committed run as a no-op', async () => {
    const { run } = jobRun({ status: 'committed' });

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe(
      'replayed',
    );

    expect(dispatch).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuses a run that does not exist, without retrying', async () => {
    await expect(
      runLlmJob(
        JSON.stringify({ runId: '19030000-0000-4000-8000-00000000dead' }),
        deps([]),
      ),
    ).resolves.toBe('refused');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not run the job of a user who can no longer write the project, and fails the run', async () => {
    const { run } = jobRun({ createdBy: REVOKED }, { userId: REVOKED });

    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('refused');

    expect(dispatch).not.toHaveBeenCalled();
    expect(run.status).toBe('failed');
    expect(notify).toHaveBeenCalledWith(
      REVOKED,
      expect.objectContaining({
        type: 'llm-error',
        error: 'You no longer have write access to this project',
      }),
    );
  });

  it('refuses a stored payload missing a field before any handler runs, naming it', async () => {
    const { run } = jobRun({}, { version: undefined });

    await expect(runLlmJob(message(run), deps([run]))).rejects.toThrow(
      /Invalid shot-generation payload: version: Required/,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('marks the run failed when the handler throws, then rethrows for the retry to find a closed run', async () => {
    const { run } = jobRun();
    dispatch.mockRejectedValue(new Error('model said no'));

    await expect(runLlmJob(message(run), deps([run]))).rejects.toThrow(
      'model said no',
    );

    expect(run.status).toBe('failed');
    expect(run.error).toMatchObject({ message: 'model said no' });

    // the retry: a failed run is refused, not re-run
    dispatch.mockClear();
    await expect(runLlmJob(message(run), deps([run]))).resolves.toBe('refused');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('runLlmJob with the legacy { jobType, userId, payload } message', () => {
  const legacy = (userId: string, overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      jobType: 'shot-generation',
      userId,
      payload: payload({ userId, ...overrides }),
    });

  it('still runs a writer’s job, logged as legacy, with no run in scope', async () => {
    let runInScope: RunHandle | undefined = fakeRunHandle().run;
    dispatch.mockImplementation(async () => {
      runInScope = currentRun();
      return { ok: true };
    });

    await expect(runLlmJob(legacy(WRITER), deps([]))).resolves.toBe('done');

    expect(runInScope).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('legacy'),
    );
    expect(dispatch).toHaveBeenCalledWith(
      'shot-generation',
      expect.objectContaining({ episodeId: EPISODE, version: 3 }),
    );
  });

  it('does not run the job of a user who can no longer write the project', async () => {
    await expect(runLlmJob(legacy(REVOKED), deps([]))).resolves.toBe('refused');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a payload naming another user than the message's", async () => {
    await expect(
      runLlmJob(legacy(WRITER, { userId: REVOKED }), deps([])),
    ).rejects.toThrow(/userId: is not the message's userId/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('the handlers', () => {
  const dir = join(__dirname, '../handlers');

  it('parse their payload rather than cast it (KB-33)', () => {
    const casts = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => {
        const source = readFileSync(join(dir, file), 'utf8');
        return (
          source.includes('KB-33') ||
          /payload as unknown as/.test(source) ||
          !source.includes('parseLlmJobPayload(')
        );
      });

    expect(casts).toEqual([]);
  });
});
