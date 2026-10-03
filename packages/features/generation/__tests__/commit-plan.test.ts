import { describe, expect, it, vi } from 'vitest';

import {
  type CommitPlan,
  type Ctx,
  applyCommit,
  applyPlanThroughClient,
  eq,
  ref,
} from '../src';
import {
  fakeRunHandle,
  recordingClient,
  tableResponder,
} from '../src/testing';

const EPISODE = '55555555-5555-4555-8555-555555555555';

function ctxWith(client: Ctx['client'], extra: Partial<Ctx> = {}): Ctx {
  return { client, accountId: 'a', userId: 'u', ...extra };
}

const twoWrites: CommitPlan = {
  ops: [
    {
      op: 'update',
      table: 'episodes',
      values: { status: 'story' },
      match: [eq('id', EPISODE)],
    },
    {
      op: 'delete',
      table: 'shots',
      match: [eq('episode_id', EPISODE)],
    },
  ],
};

describe('applyCommit (FILM-1903)', () => {
  it('hands the plan to the run’s applier when the context has one', async () => {
    const recording = recordingClient();
    const commits = vi.fn(async () => ({
      results: {},
      skipped: [],
      revisionId: 'r',
      finalized: true,
    }));

    await applyCommit(ctxWith(recording.client, { commits }), twoWrites);

    expect(commits).toHaveBeenCalledWith(twoWrites);
    expect(recording.writes()).toEqual([]);
  });

  it('refuses a plan of more than one write without a run: it could not be one transaction', async () => {
    const recording = recordingClient();

    await expect(
      applyCommit(ctxWith(recording.client), twoWrites),
    ).rejects.toThrow(/runs under a generation run/);
    expect(recording.writes()).toEqual([]);
  });

  it('applies a single write through the client without a run', async () => {
    const recording = recordingClient();

    await applyCommit(ctxWith(recording.client), { ops: [twoWrites.ops[0]!] });

    expect(recording.writes().map((w) => `${w.table}:${w.op}`)).toEqual([
      'episodes:update',
    ]);
  });
});

describe('applyPlanThroughClient: the run-less applier and the tests’ recorder', () => {
  it('resolves a $ref and a $union from an earlier keyed write, and sends a one-row body as the row', async () => {
    const recording = recordingClient(
      tableResponder({ assets: { id: 'asset' }, episodes: { metadata: {} } }),
    );

    const applied = await applyPlanThroughClient(recording.client, {
      ops: [
        {
          key: 'chars',
          op: 'upsert',
          table: 'assets',
          rows: [{ name: 'Ada' }, { name: 'Bo' }],
          onConflict: 'project_id,type,name',
          ignoreDuplicates: true,
          returning: ['id'],
        },
        {
          op: 'insert',
          table: 'state_deltas',
          asObject: true,
          rows: [{ entity_id: ref('chars', 'id', { one: true }) }],
        },
        {
          op: 'update',
          table: 'episodes',
          values: {
            metadata: { character_ids: { $union: [['x', 'asset-0'], ref('chars', 'id')] } },
          },
          merge: ['metadata'],
          match: [eq('id', EPISODE)],
        },
      ],
    });

    expect(applied.results.chars).toEqual([{ id: 'asset-0' }, { id: 'asset-1' }]);

    const writes = recording.writes();
    expect(writes[0]?.options).toEqual({
      onConflict: 'project_id,type,name',
      ignoreDuplicates: true,
    });
    expect(writes[1]?.payload).toEqual({ entity_id: 'asset-0' });
    expect(writes[2]?.payload).toEqual({
      metadata: { character_ids: ['x', 'asset-0', 'asset-1'] },
    });
  });

  it('a merge reads the column first and writes it back merged, as the handlers did', async () => {
    const recording = recordingClient(
      tableResponder({ episodes: { metadata: { keep: true } } }),
    );

    await applyPlanThroughClient(recording.client, {
      ops: [
        {
          op: 'update',
          table: 'episodes',
          values: { metadata: { themes: ['loss'] } },
          merge: ['metadata'],
          match: [eq('id', EPISODE)],
        },
      ],
    });

    expect(recording.writes()[0]?.payload).toEqual({
      metadata: { keep: true, themes: ['loss'] },
    });
  });

  it('leaves out a write whose onlyIfRows wrote nothing', async () => {
    const recording = recordingClient(() => ({ data: [] }));

    await applyPlanThroughClient(recording.client, {
      ops: [
        {
          key: 'chars',
          op: 'upsert',
          table: 'assets',
          rows: [{ name: 'Ada' }],
          onConflict: 'project_id,type,name',
          ignoreDuplicates: true,
          returning: ['id'],
        },
        {
          op: 'update',
          table: 'episodes',
          values: { metadata: {} },
          match: [eq('id', EPISODE)],
          onlyIfRows: ['chars'],
        },
      ],
    });

    expect(recording.writes().map((w) => w.table)).toEqual(['assets']);
  });

  it('reports a skippable step that fails and goes on; a required one fails the commit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recording = recordingClient((call) =>
      call.table === 'immutable_events'
        ? { error: { message: 'down' } }
        : { data: [] },
    );

    const applied = await applyPlanThroughClient(recording.client, {
      ops: [
        {
          key: 'canon',
          op: 'group',
          onError: 'skip',
          ops: [
            {
              op: 'delete',
              table: 'immutable_events',
              match: [eq('established_in', EPISODE)],
            },
          ],
        },
        {
          op: 'delete',
          table: 'shots',
          match: [eq('episode_id', EPISODE)],
        },
      ],
    });

    expect(applied.skipped).toEqual([
      expect.objectContaining({ key: 'canon', error: expect.stringMatching(/down/) }),
    ]);
    expect(recording.writes().map((w) => w.table)).toEqual([
      'immutable_events',
      'shots',
    ]);

    await expect(
      applyPlanThroughClient(recording.client, {
        ops: [
          {
            op: 'update',
            table: 'episodes',
            values: { status: 'story' },
            match: [eq('id', EPISODE)],
            requireRows: true,
          },
        ],
      }),
    ).rejects.toThrow(/COMMIT_NO_ROWS/);
  });
});

describe('RunHandle.applyCommit: apply_generation_commit’s answers', () => {
  it('commits and closes the run in the one call, and the handle sees it', async () => {
    const { run, state } = fakeRunHandle();

    const applied = await run.applyCommit(twoWrites, { finalize: true });

    expect(applied.finalized).toBe(true);
    expect(run.status).toBe('committed');
    expect(state.commits).toEqual([
      { runId: run.id, plan: twoWrites, finalize: true },
    ]);

    // complete() after it is a no-op, not a RUN_NOT_OPEN
    await expect(run.complete()).resolves.toBeUndefined();
  });

  it('leaves the run open with finalize: false', async () => {
    const { run } = fakeRunHandle();

    await run.applyCommit(twoWrites, { finalize: false });

    expect(run.status).toBe('briefed');
  });

  it('TARGET_CHANGED and RUN_NOT_OPEN come back as RunErrors, before anything is written', async () => {
    const moved = fakeRunHandle({ targetVersion: 4 });
    moved.state.episodeVersions.set(moved.run.targetId, 5);

    await expect(
      moved.run.applyCommit(twoWrites, { finalize: true }),
    ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
    expect(moved.state.commits).toEqual([]);

    const closed = fakeRunHandle({ status: 'committed' });

    await expect(
      closed.run.applyCommit(twoWrites, { finalize: true }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_OPEN' });
  });

  it('a write the database refuses is COMMIT_FAILED: the transaction rolled back', async () => {
    const { run } = fakeRunHandle({
      fallback: () => ({ error: { message: 'violates check constraint' } }),
    });

    await expect(
      run.applyCommit(twoWrites, { finalize: true }),
    ).rejects.toMatchObject({
      code: 'COMMIT_FAILED',
      message: expect.stringMatching(/rolled back: .*violates check constraint/),
    });
  });
});
