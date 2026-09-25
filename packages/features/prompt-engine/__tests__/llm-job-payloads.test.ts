import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LLM_JOB_TYPES,
  LlmJobPayloadSchemas,
  parseLlmJobMessage,
  parseLlmJobPayload,
} from '../src/lib/llm-job-payloads';
import { chainedLlmJobTarget } from '../src/lib/server/llm-job-target';

/**
 * KB-33. The LLM worker cast every SQS payload to its handler's type, so a
 * missing or renamed field reached a prompt or a query as `undefined`. Each
 * job type now has one schema, used by `queueLlmJob` before it sends and by
 * the handler when it receives.
 */

const send = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send })),
  SendMessageCommand: vi.fn((input: unknown) => ({ input })),
}));

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const OTHER_USER = '55555555-5555-4555-8555-555555555555';

const target = chainedLlmJobTarget({
  accountId: ACCOUNT,
  projectId: PROJECT,
  episodeId: EPISODE,
});

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
  process.env.LLM_JOBS_QUEUE_URL = 'https://sqs.test/llm';
});

describe('the schemas', () => {
  it('covers every job type the worker dispatches, and nothing else', () => {
    expect([...LLM_JOB_TYPES].sort()).toEqual(
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

  it('refuses a payload missing a required field, naming it', () => {
    expect(() =>
      parseLlmJobPayload('story-ideation', {
        accountId: ACCOUNT,
        episodeId: EPISODE,
        userId: USER,
      }),
    ).toThrow(/Invalid story-ideation payload: premise: Required/);
  });

  it('refuses an id that is not a uuid, naming it', () => {
    expect(() =>
      parseLlmJobPayload('shot-generation', {
        accountId: ACCOUNT,
        projectId: PROJECT,
        episodeId: 'not-an-id',
        userId: USER,
        version: 1,
      }),
    ).toThrow(/episodeId: Invalid uuid/);
  });

  it('strips keys it does not know, so an older producer still parses', () => {
    const parsed = parseLlmJobPayload('shot-generation', {
      accountId: ACCOUNT,
      projectId: PROJECT,
      episodeId: EPISODE,
      userId: USER,
      version: 2,
      videoProvider: 'veo',
    });

    expect(parsed).not.toHaveProperty('videoProvider');
    expect(parsed.version).toBe(2);
  });

  it('gives a story without a duration or style the defaults the single-episode path uses', () => {
    const parsed = parseLlmJobPayload('story-generation', {
      accountId: ACCOUNT,
      projectId: PROJECT,
      episodeId: EPISODE,
      userId: USER,
      title: 'T',
      logline: 'L',
      version: 1,
    });

    expect(parsed.targetDuration).toBe(300);
    expect(parsed.contentStyle).toBe('dialogue-heavy');
  });
});

describe('the SQS message', () => {
  const payload = {
    accountId: ACCOUNT,
    projectId: PROJECT,
    episodeId: EPISODE,
    version: 1,
  };

  it('parses a message and its payload for its job type', () => {
    const job = parseLlmJobMessage({
      jobType: 'shot-generation',
      userId: USER,
      payload: { ...payload, userId: USER },
    });

    expect(job.jobType).toBe('shot-generation');
    expect(job.userId).toBe(USER);
  });

  it('refuses an unknown job type', () => {
    expect(() =>
      parseLlmJobMessage({
        jobType: 'publish-metadata',
        userId: USER,
        payload,
      }),
    ).toThrow(/Invalid LLM job message: jobType/);
  });

  it("refuses a payload whose userId is not the message's", () => {
    expect(() =>
      parseLlmJobMessage({
        jobType: 'shot-generation',
        userId: USER,
        payload: { ...payload, userId: OTHER_USER },
      }),
    ).toThrow(/userId: is not the message's userId/);
  });
});

describe('queueLlmJob', () => {
  it('refuses a payload its handler would refuse, and sends nothing', async () => {
    const { queueLlmJob } = await import('../src/lib/server/sqs-helper');

    await expect(
      queueLlmJob({
        jobType: 'story-refinement',
        userId: USER,
        target,
        // @ts-expect-error — the missing field is the test
        payload: { episodeId: EPISODE },
      }),
    ).rejects.toThrow(/Invalid story-refinement payload: feedback: Required/);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends the parsed payload, with the job user stamped', async () => {
    const { queueLlmJob } = await import('../src/lib/server/sqs-helper');

    await queueLlmJob({
      jobType: 'story-refinement',
      userId: USER,
      target,
      payload: { feedback: 'Tighter', userId: OTHER_USER },
    });

    expect(send).toHaveBeenCalledTimes(1);

    const body = JSON.parse(send.mock.calls[0]![0].input.MessageBody);

    expect(body.payload).toEqual({
      accountId: ACCOUNT,
      projectId: PROJECT,
      episodeId: EPISODE,
      userId: USER,
      feedback: 'Tighter',
    });
  });
});

it('has a schema object per job type', () => {
  for (const jobType of LLM_JOB_TYPES) {
    expect(LlmJobPayloadSchemas[jobType]).toBeDefined();
  }
});
