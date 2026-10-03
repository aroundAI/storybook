import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Brief,
  type RunBackend,
  RunError,
  runStage,
  storyRefinementStage,
} from '@kit/generation';
import {
  fakeRunHandle,
  recordCommits,
  recordingClient,
  tableResponder,
} from '@kit/generation/testing';

import {
  GatewayError,
  assertServerRunOpen,
  createExternalWriter,
  createServerWriter,
  resolveWriter,
} from '../src';
import { gatewayBackend } from '../src/backend';

/**
 * FILM-1902 unit plan: run.write() on an external run never reaches the
 * server writer; on a server run it does, once per part. The server writer
 * refuses an external, expired or cancelled run with
 * LLM_FORBIDDEN_EXTERNAL_RUN before the executor is called.
 */

const brief = (key: string): Brief => ({
  stage: 'story_refinement',
  part: { key, index: 0, total: 1, label: key },
  prompt: {
    slug: 'story-refinement',
    version: 1,
    variables: { feedback: 'x' },
  },
  instructions: 'write',
  context: {},
  outputSchema: { type: 'object' },
  constraints: {},
  targetVersion: 4,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

describe('the server writer', () => {
  const execute = vi.fn();

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({
      data: { story: { fullText: 'darker' } },
      metadata: { tokens: 42, latency: 10, provider: 'gemini', model: 'g' },
    });
  });

  it('renders the brief through the executor, for the run, and returns output and usage', async () => {
    const { run } = fakeRunHandle();
    const writer = createServerWriter({ execute });

    const result = await writer(run, brief('story'));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      run,
      templateSlug: 'story-refinement',
      variables: { feedback: 'x' },
      operationName: 'story_refinement:story',
    });
    expect(result).toEqual({
      output: { story: { fullText: 'darker' } },
      usage: { provider: 'gemini', model: 'g', tokens: 42, latencyMs: 10 },
    });
  });

  it.each([
    ['external', fakeRunHandle({ mode: 'external' })],
    ['cancelled', fakeRunHandle({ status: 'cancelled' })],
    ['expired', fakeRunHandle({ status: 'expired' })],
    ['failed', fakeRunHandle({ status: 'failed' })],
    [
      'past its lease',
      fakeRunHandle({ leaseExpiresAt: new Date(Date.now() - 1).toISOString() }),
    ],
  ])(
    'the guard refuses a run that is %s with LLM_FORBIDDEN_EXTERNAL_RUN',
    async (_name, { run }) => {
      await expect(assertServerRunOpen(run)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof GatewayError &&
          error.code === 'LLM_FORBIDDEN_EXTERNAL_RUN' &&
          error.runId === run.id,
      );
    },
  );

  it('the guard renews the lease of an open server run', async () => {
    const { run, state } = fakeRunHandle({
      leaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    await expect(assertServerRunOpen(run)).resolves.toBeUndefined();
    expect(state.rpcs.map((rpc) => rpc.fn)).toEqual([
      'renew_generation_run_lease',
    ]);
    expect(new Date(run.leaseExpiresAt!).getTime()).toBeGreaterThan(
      Date.now() + 29 * 60 * 1000,
    );
  });
});

describe('the external writer', () => {
  it('generates nothing: the brief comes back as AWAITING_SUBMISSION', async () => {
    const { run } = fakeRunHandle({ mode: 'external' });
    const writer = createExternalWriter();

    await expect(writer(run, brief('story'))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RunError &&
        error.code === 'AWAITING_SUBMISSION' &&
        error.details.brief?.part.key === 'story',
    );
  });
});

describe('resolveWriter', () => {
  it('picks the writer by the run’s mode, never by an argument', () => {
    const server = resolveWriter(fakeRunHandle({ mode: 'server' }).run);
    const external = resolveWriter(fakeRunHandle({ mode: 'external' }).run);

    expect(server).toBe(createServerWriterSingleton());
    expect(external).not.toBe(server);
  });

  function createServerWriterSingleton() {
    return resolveWriter(fakeRunHandle({ mode: 'server' }).run);
  }
});

describe('run.write() through the gateway backend', () => {
  it('an external run never reaches the server writer', async () => {
    const write = vi.fn();
    const { run } = fakeRunHandle({
      mode: 'external',
      backend: { write, dispatch: vi.fn() },
    });

    await expect(run.write(brief('story'))).rejects.toMatchObject({
      code: 'AWAITING_SUBMISSION',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('a server run reaches the writer exactly once per part, with the run id on the brief', async () => {
    const write = vi.fn<RunBackend['write']>(async () => ({
      output: { story: { fullText: 'darker' } },
    }));
    const { run, state } = fakeRunHandle({
      backend: { write, dispatch: vi.fn() },
    });
    const client = recordingClient(
      tableResponder({
        episodes: {
          id: run.targetId,
          title: 'T',
          status: 'story',
          story_data: { fullStory: 'light', title: 'T' },
          metadata: {},
          version: 4,
          deleted_at: null,
        },
        generation_jobs: null,
      }),
    );

    await runStage(
      storyRefinementStage,
      {
        client: client.client,
        commits: recordCommits(client.client).apply,
        accountId: run.accountId,
        userId: run.createdBy,
        episodeContext: async () => ({
          episodeNumber: 1,
          characters: '',
          locations: '',
          previousEpisodes: '',
          counts: { characters: 0, locations: 0 },
        }),
      },
      { episodeId: run.targetId, feedback: 'darker' },
      { generate: (b) => run.write(b), runId: run.id },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[1]).toMatchObject({
      runId: run.id,
      part: { key: 'story' },
    });
    // every call renews the lease
    expect(
      state.rpcs.filter((r) => r.fn === 'renew_generation_run_lease'),
    ).toHaveLength(1);
  });

  it('the gateway backend is the writer resolved by mode', async () => {
    const { run } = fakeRunHandle({ mode: 'external' });

    await expect(
      gatewayBackend.write(run, brief('story')),
    ).rejects.toMatchObject({
      code: 'AWAITING_SUBMISSION',
    });
  });
});
