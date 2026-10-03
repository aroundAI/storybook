import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Brief,
  type RunBackend,
  type RunCtx,
  RunError,
  executeServerRun,
  finalizeRun,
  loadRun,
  openChildRun,
  openRun,
  planWrites,
  resolveRunMode,
  storyRefinementStage,
} from '../src';
import {
  type RunStoreState,
  TEST_IDS,
  fakeRunHandle,
  fakeRunRow,
  recordingClient,
  runStoreResponder,
  runStoreState,
  tableResponder,
} from '../src/testing';

/**
 * FILM-1903 part B: openRun is the only constructor and the mode comes from
 * the caller's context; the handle renews its lease on every call, refuses
 * what its mode forbids, re-checks the target before commit and files a
 * revision for what it replaces.
 */

const NOW = new Date('2026-10-03T12:00:00.000Z');

const EPISODE = {
  id: TEST_IDS.episode,
  title: 'The Last Signal',
  status: 'story',
  story_data: { fullStory: 'light', title: 'The Last Signal' },
  metadata: {},
  version: 4,
  deleted_at: null,
  generation_origin: {},
};

function harness(
  options: {
    rows?: ReturnType<typeof fakeRunRow>[];
    backend?: RunBackend;
    settings?: Record<string, unknown>;
    episodeVersion?: number;
    runMode?: RunCtx['runMode'];
    connectionId?: string;
  } = {},
) {
  const state: RunStoreState = runStoreState(options.rows ?? []);

  if (options.settings) state.settings.set(TEST_IDS.account, options.settings);
  state.episodeVersions.set(TEST_IDS.episode, options.episodeVersion ?? 4);

  const recording = recordingClient(
    runStoreResponder(
      state,
      tableResponder({ episodes: EPISODE, generation_jobs: null }),
    ),
  );
  state.client = recording.client;

  const ctx: RunCtx = {
    client: recording.client,
    accountId: TEST_IDS.account,
    userId: TEST_IDS.user,
    backend: options.backend,
    runMode: options.runMode,
    connectionId: options.connectionId,
    episodeContext: async () => ({
      episodeNumber: 1,
      characters: '',
      locations: '',
      previousEpisodes: '',
      counts: { characters: 0, locations: 0 },
    }),
  };

  return { state, ctx, recording };
}

const target = {
  type: 'episode' as const,
  id: TEST_IDS.episode,
  accountId: TEST_IDS.account,
  projectId: TEST_IDS.project,
  input: {
    kind: 'stage' as const,
    target: { episodeId: TEST_IDS.episode, feedback: 'darker' },
  },
  targetVersion: 4,
};

const origin = { kind: 'web' as const, name: 'test.open' };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('openRun: the mode comes from the context, never an argument', () => {
  it('a web caller with no settings row gets a server run', async () => {
    const { ctx, state } = harness();

    const run = await openRun('story_refinement', target, origin, ctx);

    expect(run.mode).toBe('server');
    expect(run.status).toBe('briefed');
    expect(run.input).toEqual(target.input);
    expect(state.rpcs[0]).toMatchObject({
      fn: 'open_generation_run',
      args: {
        p_stage: 'story_refinement',
        p_mode: 'server',
        p_target_type: 'episode',
        p_target_id: TEST_IDS.episode,
        p_target_version: 4,
        p_origin: origin,
      },
    });
  });

  it('the team default decides a web run', async () => {
    const { ctx } = harness({
      settings: {
        server_generation_enabled: true,
        external_generation_enabled: true,
        default_mode: 'external',
      },
    });

    expect(await resolveRunMode('story', TEST_IDS.account, ctx)).toBe(
      'external',
    );
  });

  it('an MCP request is external, through the runMode seam or a connection id', async () => {
    const seam = harness({ runMode: () => 'external' });
    const connection = harness({ connectionId: TEST_IDS.run });

    expect(await resolveRunMode('story', TEST_IDS.account, seam.ctx)).toBe(
      'external',
    );
    expect(
      await resolveRunMode('story', TEST_IDS.account, connection.ctx),
    ).toBe('external');

    const run = await openRun('story', target, origin, connection.ctx);
    expect(run.mode).toBe('external');
    expect(connection.state.rpcs[0]?.args).toMatchObject({
      p_connection_id: TEST_IDS.run,
    });
  });

  it('a team that turned external off refuses an MCP run, and one that turned server off falls back', async () => {
    const noExternal = harness({
      runMode: () => 'external',
      settings: {
        server_generation_enabled: true,
        external_generation_enabled: false,
        default_mode: 'server',
      },
    });

    await expect(
      resolveRunMode('story', TEST_IDS.account, noExternal.ctx),
    ).rejects.toMatchObject({ code: 'EXTERNAL_GENERATION_DISABLED' });

    const noServer = harness({
      settings: {
        server_generation_enabled: false,
        external_generation_enabled: true,
        default_mode: 'server',
      },
    });

    expect(await resolveRunMode('story', TEST_IDS.account, noServer.ctx)).toBe(
      'external',
    );

    const nothing = harness({
      settings: {
        server_generation_enabled: false,
        external_generation_enabled: false,
        default_mode: 'server',
      },
    });

    await expect(
      resolveRunMode('story', TEST_IDS.account, nothing.ctx),
    ).rejects.toMatchObject({ code: 'SERVER_GENERATION_DISABLED' });
  });

  it('a render stage is always server work', async () => {
    const { ctx } = harness({ runMode: () => 'external' });

    expect(await resolveRunMode('audio_render', TEST_IDS.account, ctx)).toBe(
      'server',
    );
  });

  it('a second open run on the target and stage is RUN_IN_PROGRESS, naming the holder', async () => {
    const holder = fakeRunRow({ mode: 'external', status: 'in_progress' });
    const { ctx, state } = harness({ rows: [holder] });
    state.holder = holder;

    await expect(
      openRun('story_refinement', target, origin, ctx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RunError &&
        error.code === 'RUN_IN_PROGRESS' &&
        error.details.holder?.id === holder.id &&
        error.details.holder?.mode === 'external' &&
        error.details.holder?.createdBy === TEST_IDS.user,
    );

    // after the holder is cancelled the lock is free
    state.holder = undefined;
    const run = await openRun('story_refinement', target, origin, ctx);
    expect(run.id).not.toBe(holder.id);
  });

  it('a child run takes its parent’s mode, user and id', async () => {
    const { ctx, state } = harness();
    const parent = fakeRunHandle({ mode: 'external', stage: 'shots' }).run;

    const child = await openChildRun(
      parent,
      'audio_cues',
      { ...target, input: { kind: 'stage', target: {} } },
      { kind: 'worker', name: 'shots -> audio_cues' },
      ctx,
    );

    expect(child.mode).toBe('external');
    expect(child.parentRunId).toBe(parent.id);
    expect(child.createdBy).toBe(parent.createdBy);
    expect(state.rpcs[0]?.args).toMatchObject({
      p_mode: 'external',
      p_parent_run_id: parent.id,
      p_created_by: parent.createdBy,
    });
  });

  it('loadRun reads an existing run by id, or null', async () => {
    const row = fakeRunRow();
    const { ctx } = harness({ rows: [row] });

    expect((await loadRun(row.id, ctx))?.id).toBe(row.id);
    expect(
      await loadRun('19030000-0000-4000-8000-00000000ffff', ctx),
    ).toBeNull();
  });
});

describe('the handle', () => {
  it('renewLease refreshes the row and reports a closed run', async () => {
    const { run, state } = fakeRunHandle();

    const renewed = await run.renewLease();
    expect(renewed.leaseExpiresAt).toBe(
      new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
    );

    state.rows.get(run.id)!.status = 'cancelled';
    await run.renewLease();
    expect(run.status).toBe('cancelled');
    expect(run.isOpen()).toBe(false);
  });

  it('start, complete, fail and cancel move the status, and a terminal run never moves again', async () => {
    const { run } = fakeRunHandle();

    await run.start();
    expect(run.status).toBe('in_progress');

    await run.fail(new Error('boom'));
    expect(run.status).toBe('failed');
    expect(run.error).toEqual({ code: 'Error', message: 'boom' });

    await expect(run.complete()).rejects.toMatchObject({
      code: 'RUN_NOT_OPEN',
    });

    const other = fakeRunHandle().run;
    await other.cancel('user closed the page');
    expect(other.status).toBe('cancelled');
    expect(other.error).toEqual({
      code: 'CANCELLED',
      reason: 'user closed the page',
    });
  });

  it('write and dispatch need a backend, and refuse a closed run', async () => {
    const { run } = fakeRunHandle({ status: 'committed' });
    const brief = {} as Brief;

    await expect(run.write(brief)).rejects.toMatchObject({
      code: 'NO_RUN_BACKEND',
    });

    const closed = fakeRunHandle({
      status: 'committed',
      backend: { write: vi.fn(), dispatch: vi.fn() },
    }).run;
    await expect(closed.write(brief)).rejects.toMatchObject({
      code: 'RUN_NOT_OPEN',
    });
  });

  it('assertTargetUnchanged refuses a moved episode with TARGET_CHANGED', async () => {
    const { run, state } = fakeRunHandle({ targetVersion: 4 });

    state.episodeVersions.set(run.targetId, 4);
    await expect(run.assertTargetUnchanged()).resolves.toBeUndefined();

    state.episodeVersions.set(run.targetId, 5);
    await expect(run.assertTargetUnchanged()).rejects.toMatchObject({
      code: 'TARGET_CHANGED',
    });

    // a target without a version always passes
    const asset = fakeRunHandle({
      targetType: 'asset',
      targetVersion: null,
    }).run;
    await expect(asset.assertTargetUnchanged()).resolves.toBeUndefined();
  });

  it('snapshot files the revision under the run in the restore contract’s shape', async () => {
    const { run, state } = fakeRunHandle();

    await run.snapshot({
      table: 'episodes',
      rowId: run.targetId,
      column: 'story_data',
      before: { fullStory: 'light' },
      stage: 'story_refinement',
      runId: run.id,
    });
    await run.snapshot({
      table: 'shots',
      rowId: run.targetId,
      column: '*',
      before: [{ id: 's1' }],
      stage: 'shots',
    });

    expect(state.revisions).toEqual([
      {
        runId: run.id,
        snapshot: { episode: { story_data: { fullStory: 'light' } } },
      },
      { runId: run.id, snapshot: { shots: [{ id: 's1' }] } },
    ]);
  });

  it('toGenerationRun stamps the origin a commit writes', () => {
    const { run } = fakeRunHandle({
      mode: 'external',
      origin: {
        kind: 'mcp',
        name: 'start_generation',
        clientName: 'Claude Desktop',
        model: 'claude',
      },
    });

    expect(run.toGenerationRun(undefined, NOW)).toEqual({
      id: run.id,
      mode: 'external',
      origin: {
        kind: 'external',
        runId: run.id,
        model: 'claude',
        promptSlug: undefined,
        promptVersion: undefined,
        clientName: 'Claude Desktop',
        at: NOW.toISOString(),
      },
      usage: undefined,
    });
  });
});

describe('executeServerRun', () => {
  const output = { story: { fullText: 'This time, nobody answers.' } };

  it('prepares, writes through the run, checks, snapshots, commits with the origin and marks the run committed', async () => {
    const write = vi.fn(async () => ({
      output,
      usage: { provider: 'gemini', model: 'g', tokens: 42 },
    }));
    const { ctx, state, recording } = harness({
      backend: { write, dispatch: vi.fn() },
    });
    const run = await openRun('story_refinement', target, origin, ctx);

    const result = await executeServerRun(run, ctx);

    expect(write).toHaveBeenCalledTimes(1);
    expect(result.commit.status).toBe('committed');
    expect(run.status).toBe('committed');

    // The commit is one apply_generation_commit that also closes the run;
    // the database snapshots story_data from its plan (pgTAP A2), so no
    // separate revision call and no separate move to committed
    expect(state.commits).toEqual([
      expect.objectContaining({ runId: run.id, finalize: true }),
    ]);
    expect(
      planWrites(state.commits[0]!.plan).map((w) => `${w.table}:${w.op}`),
    ).toEqual(['episodes:update', 'generation_jobs:update']);
    expect(state.revisions).toEqual([]);
    expect(
      state.rpcs.filter(
        (rpc) =>
          rpc.fn === 'transition_generation_run' &&
          (rpc.args as { p_status: string }).p_status === 'committed',
      ),
    ).toEqual([]);

    const episodeUpdate = recording
      .writes()
      .find((w) => w.table === 'episodes' && w.op === 'update');
    expect(episodeUpdate?.payload).toMatchObject({
      generation_origin: {
        story_refinement: {
          kind: 'server',
          runId: run.id,
          model: 'g',
          at: NOW.toISOString(),
        },
      },
    });
  });

  it('refuses to commit when the target moved since the brief, and marks the run failed', async () => {
    const write = vi.fn(async () => ({ output }));
    const { ctx, state, recording } = harness({
      backend: { write, dispatch: vi.fn() },
      episodeVersion: 5,
    });
    const run = await openRun('story_refinement', target, origin, ctx);

    await expect(executeServerRun(run, ctx)).rejects.toMatchObject({
      code: 'TARGET_CHANGED',
    });

    expect(run.status).toBe('failed');
    expect(state.commits).toEqual([]);
    expect(
      recording
        .writes()
        .filter((w) => w.table === 'episodes' && w.op === 'update'),
    ).toEqual([]);
  });

  it('never runs an external run, and never reaches the writer', async () => {
    const write = vi.fn();
    const { ctx } = harness({
      backend: { write, dispatch: vi.fn() },
      runMode: () => 'external',
    });
    const run = await openRun('story_refinement', target, origin, ctx);

    await expect(executeServerRun(run, ctx)).rejects.toMatchObject({
      code: 'RUN_NOT_SERVER',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('opens the commit’s follow-ons as children in the parent’s mode; a server child is dispatched', async () => {
    const dispatch = vi.fn(async () => undefined);
    const write = vi.fn(async () => ({ output }));
    const { ctx, state } = harness({ backend: { write, dispatch } });
    const run = await openRun('story_refinement', target, origin, ctx);

    const original = storyRefinementStage.commit;
    const spy = vi
      .spyOn(storyRefinementStage, 'commit')
      .mockImplementation(async (...args) => ({
        ...(await original(...args)),
        followOns: [
          {
            stage: 'audio_cues',
            target: {
              type: 'episode',
              id: TEST_IDS.episode,
              projectId: TEST_IDS.project,
              input: { kind: 'stage', target: { episodeId: TEST_IDS.episode } },
            },
          },
        ],
      }));

    try {
      const result = await executeServerRun(run, ctx);

      expect(result.children).toHaveLength(1);
      expect(result.children[0]).toMatchObject({
        stage: 'audio_cues',
        mode: 'server',
        parentRunId: run.id,
      });
      expect(dispatch).toHaveBeenCalledWith(result.children[0]);
      expect(
        state.rpcs
          .filter((r) => r.fn === 'open_generation_run')
          .map((r) => r.args),
      ).toMatchObject([
        { p_stage: 'story_refinement' },
        { p_stage: 'audio_cues', p_parent_run_id: run.id, p_mode: 'server' },
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('finalizeRun (the external path FILM-1908 calls)', () => {
  it('commits the submitted parts with the same checks, and never dispatches an external child', async () => {
    const write = vi.fn();
    const dispatch = vi.fn();
    const { ctx, recording } = harness({
      backend: { write, dispatch },
      runMode: () => 'external',
    });
    const run = await openRun('story_refinement', target, origin, ctx);

    const result = await finalizeRun(run, ctx, [
      { key: 'story', output: { story: { fullText: 'nobody answers' } } },
    ]);

    expect(result.commit.status).toBe('committed');
    expect(run.status).toBe('committed');
    expect(write).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      recording.writes().find((w) => w.table === 'episodes')?.payload,
    ).toMatchObject({
      generation_origin: {
        story_refinement: { kind: 'external', runId: run.id },
      },
    });
  });

  it('rejects a missing or malformed part before anything is written', async () => {
    const { ctx, recording } = harness({ runMode: () => 'external' });
    const run = await openRun('story_refinement', target, origin, ctx);

    await expect(finalizeRun(run, ctx, [])).rejects.toMatchObject({
      name: 'StageOutputRejected',
    });
    expect(run.status).toBe('failed');

    // the failed run freed the lock: a new one takes a malformed part
    const again = await openRun('story_refinement', target, origin, ctx);
    await expect(
      finalizeRun(again, ctx, [{ key: 'story', output: { story: {} } }]),
    ).rejects.toMatchObject({ name: 'StageOutputRejected' });

    expect(recording.writes().filter((w) => w.table === 'episodes')).toEqual(
      [],
    );
  });
});
