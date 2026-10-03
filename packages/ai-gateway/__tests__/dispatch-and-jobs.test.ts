import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunError } from '@kit/generation';
import { TEST_IDS, fakeRunHandle, fakeRunRow } from '@kit/generation/testing';
import {
  chainedLlmJobTarget,
  noTenantLlmJobTarget,
} from '@kit/prompt-engine/llm-job-target';

import { STAGE_OF_JOB, jobRunTarget } from '../src';
import { runMessage, sendRunMessage } from '../src/dispatch';

/**
 * FILM-1903: the queue is private to the gateway and the message is
 * `{ runId }`; `run.dispatch()` refuses a non-server run before anything is
 * sent. `openRunForJob` opens a run for a worker job not yet on the core:
 * the stage is the job's, and the payload is parsed with the job's schema
 * before the run exists (KB-33), with the target's ids stamped (KB-31).
 */

describe('the SQS message', () => {
  const send = vi.fn<(command: SendMessageCommand) => Promise<unknown>>(
    async () => ({}),
  );

  beforeEach(() => {
    send.mockClear();
    vi.stubEnv('LLM_JOBS_QUEUE_URL', 'https://sqs.test/llm');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('carries the run id and nothing else', async () => {
    const { run } = fakeRunHandle({ stage: 'story' });

    await sendRunMessage(run, { send });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as unknown as {
      input: {
        MessageBody: string;
        MessageAttributes: Record<string, unknown>;
      };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({ runId: run.id });
    expect(runMessage(run)).toEqual({ runId: run.id });
    expect(command.input.MessageAttributes).toMatchObject({
      stage: { StringValue: 'story' },
    });
  });

  it('fails without a queue URL, sending nothing', async () => {
    vi.stubEnv('LLM_JOBS_QUEUE_URL', '');
    const { run } = fakeRunHandle();

    await expect(sendRunMessage(run, { send })).rejects.toThrow(
      /LLM_JOBS_QUEUE_URL not configured/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('run.dispatch()', () => {
  it('refuses an external run before the backend is reached', async () => {
    const dispatch = vi.fn();
    const { run } = fakeRunHandle({
      mode: 'external',
      backend: { write: vi.fn(), dispatch },
    });

    await expect(run.dispatch()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RunError && error.code === 'RUN_NOT_SERVER',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses a server run that is no longer open', async () => {
    const dispatch = vi.fn();
    const { run } = fakeRunHandle({
      status: 'cancelled',
      backend: { write: vi.fn(), dispatch },
    });

    await expect(run.dispatch()).rejects.toMatchObject({
      code: 'RUN_NOT_OPEN',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends an open server run through the backend once, renewing the lease', async () => {
    const dispatch = vi.fn(async () => undefined);
    const { run, state } = fakeRunHandle({
      backend: { write: vi.fn(), dispatch },
    });

    await run.dispatch();

    expect(dispatch).toHaveBeenCalledWith(run);
    expect(state.rpcs.map((rpc) => rpc.fn)).toEqual([
      'renew_generation_run_lease',
    ]);
  });

  it('a run opened without a backend cannot dispatch', async () => {
    const { run } = fakeRunHandle();

    await expect(run.dispatch()).rejects.toMatchObject({
      code: 'NO_RUN_BACKEND',
    });
  });
});

describe('jobRunTarget', () => {
  const target = chainedLlmJobTarget({
    accountId: TEST_IDS.account,
    projectId: TEST_IDS.project,
    episodeId: TEST_IDS.episode,
  });

  it('every worker job type maps to a stage', () => {
    expect(Object.keys(STAGE_OF_JOB).sort()).toEqual(
      [
        'analytics-insights',
        'asset-creation',
        'audio-cue-generation',
        'audio-file-generation',
        'batch-translate-metadata',
        'fact-extraction',
        'language-insights',
        'screenplay-conversion',
        'screenplay-refinement',
        'season-analysis',
        'season-outline',
        'shot-generation',
        'story-generation',
        'story-ideation',
        'story-refinement',
        'translate-dialogue',
      ].sort(),
    );
  });

  it('parses the payload with the job’s schema, stamps the target and the user, and locks the episode', () => {
    const result = jobRunTarget({
      jobType: 'story-refinement',
      userId: TEST_IDS.user,
      target,
      payload: { feedback: 'Tighter' },
    });

    expect(result).toEqual({
      type: 'episode',
      id: TEST_IDS.episode,
      accountId: TEST_IDS.account,
      projectId: TEST_IDS.project,
      targetVersion: null,
      input: {
        kind: 'job',
        jobType: 'story-refinement',
        payload: {
          accountId: TEST_IDS.account,
          projectId: TEST_IDS.project,
          episodeId: TEST_IDS.episode,
          userId: TEST_IDS.user,
          feedback: 'Tighter',
        },
      },
    });
  });

  it('refuses a payload its handler would refuse, naming the field', () => {
    expect(() =>
      jobRunTarget({
        jobType: 'story-refinement',
        userId: TEST_IDS.user,
        target,
        // @ts-expect-error - the missing field is the test
        payload: {},
      }),
    ).toThrow(/Invalid story-refinement payload: feedback: Required/);
  });

  it('refuses a payload naming another episode than the authorised target', () => {
    expect(() =>
      jobRunTarget({
        jobType: 'shot-generation',
        userId: TEST_IDS.user,
        target,
        payload: { episodeId: TEST_IDS.run, version: 2 },
      }),
    ).toThrow(/payload.episodeId is not the authorised target's episodeId/);
  });

  it('carries the episode version the payload names, for TARGET_CHANGED', () => {
    const result = jobRunTarget({
      jobType: 'shot-generation',
      userId: TEST_IDS.user,
      target,
      payload: { version: 7 },
    });

    expect(result.targetVersion).toBe(7);
  });

  it('a project job locks the project; a render locks the cue; the caller’s own text locks a fresh id', () => {
    const projectOnly = chainedLlmJobTarget({
      accountId: TEST_IDS.account,
      projectId: TEST_IDS.project,
    });

    expect(
      jobRunTarget({
        jobType: 'season-analysis',
        userId: TEST_IDS.user,
        target: projectOnly,
        payload: { roadmap: 'r' },
      }),
    ).toMatchObject({ type: 'project', id: TEST_IDS.project });

    expect(
      jobRunTarget({
        jobType: 'audio-file-generation',
        userId: TEST_IDS.user,
        target,
        payload: {
          cueId: TEST_IDS.run,
          cueType: 'music',
          prompt: 'p',
          durationSeconds: 5,
          startOffsetSeconds: 0,
        },
      }),
    ).toMatchObject({ type: 'audio_cue', id: TEST_IDS.run });

    const own = jobRunTarget({
      jobType: 'batch-translate-metadata',
      userId: TEST_IDS.user,
      target: noTenantLlmJobTarget(TEST_IDS.user),
      payload: { items: [] },
    });
    expect(own).toMatchObject({
      type: 'publish',
      accountId: TEST_IDS.user,
      projectId: null,
    });
    expect(own.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a row with a stage input is not a job', () => {
    expect(fakeRunRow().input).toEqual({ kind: 'stage', target: {} });
  });
});
