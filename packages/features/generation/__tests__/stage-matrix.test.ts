import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RunBackend,
  type RunCtx,
  type StageKey,
  executeServerRun,
  finalizeRun,
  openRun,
  registeredStageKeys,
  stageRegistry,
} from '../src';
import {
  TEST_IDS,
  recordingClient,
  runStoreResponder,
  runStoreState,
  tableResponder,
} from '../src/testing';

/**
 * FILM-1902 criteria 9 and 10. Every registered stage runs in both modes
 * against fixtures: in server mode through a stubbed writer, which is the
 * only model door and is reached exactly once per part; in external mode
 * with a submitted fixture, where the writer is never reached and no usage
 * row can exist because no model was called. The matrix is generic over
 * `stageRegistry`: a stage registered without a fixture here fails the
 * suite, naming itself, so a stage that only works in one mode cannot ship.
 */

const NOW = new Date('2026-10-03T12:00:00.000Z');

interface StageFixture {
  /** The StageDefinition target */
  target: unknown;
  /** The run's lock */
  lock: {
    type: 'episode' | 'asset' | 'project';
    id: string;
    projectId: string | null;
  };
  /** The model's (or agent's) output per part key */
  outputs: Record<string, unknown>;
  /** The rows the stage reads */
  tables: Record<string, unknown>;
}

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

const FIXTURES: Partial<Record<StageKey, StageFixture>> = {
  story_refinement: {
    target: { episodeId: TEST_IDS.episode, feedback: 'darker' },
    lock: {
      type: 'episode',
      id: TEST_IDS.episode,
      projectId: TEST_IDS.project,
    },
    outputs: { story: { story: { fullText: 'This time, nobody answers.' } } },
    tables: { episodes: EPISODE, generation_jobs: null },
  },
  asset_description: {
    target: {
      projectId: TEST_IDS.project,
      asset: { name: 'Maya Chen', type: 'character', role: 'lead' },
      storyContext: 'Maya floats in the silence.',
    },
    lock: { type: 'asset', id: TEST_IDS.run, projectId: TEST_IDS.project },
    outputs: { description: { description: 'A tall engineer.' } },
    tables: { assets: { id: 'asset-1', name: 'Maya Chen', type: 'character' } },
  },
};

function harness(
  fixture: StageFixture,
  mode: 'server' | 'external',
  backend: RunBackend,
) {
  const state = runStoreState();
  const recording = recordingClient(
    runStoreResponder(state, tableResponder(fixture.tables)),
  );
  const ctx: RunCtx = {
    client: recording.client,
    accountId: TEST_IDS.account,
    userId: TEST_IDS.user,
    backend,
    runMode: mode === 'external' ? () => 'external' : undefined,
    episodeContext: async () => ({
      episodeNumber: 1,
      characters: '',
      locations: '',
      previousEpisodes: '',
      counts: { characters: 0, locations: 0 },
    }),
  };

  return { state, recording, ctx };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('the registry and the writer agree (FILM-1902 criterion 9)', () => {
  it('every registered stage has a fixture, and nothing else does', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(registeredStageKeys().sort());
  });

  it('every registered stage reaches run.write() once per part in server mode, and no other code path does', async () => {
    const reached = new Set<string>();

    for (const key of registeredStageKeys()) {
      const fixture = FIXTURES[key]!;
      const write = vi.fn(async (_run, brief) => {
        reached.add(brief.stage);
        return { output: fixture.outputs[brief.part.key] };
      });
      const { ctx } = harness(fixture, 'server', { write, dispatch: vi.fn() });
      const run = await openRun(
        key,
        {
          ...fixture.lock,
          accountId: TEST_IDS.account,
          input: { kind: 'stage', target: fixture.target },
        },
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      await executeServerRun(run, ctx);

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      expect(write, key).toHaveBeenCalledTimes(parts.length);
    }

    expect([...reached].sort()).toEqual(registeredStageKeys().sort());
  });
});

describe('every registered stage runs in both modes (FILM-1902 criterion 10)', () => {
  for (const key of registeredStageKeys()) {
    const fixture = FIXTURES[key];

    it(`${key} has a fixture`, () => {
      expect(fixture, `add a fixture for ${key} to FIXTURES`).toBeDefined();
    });

    if (!fixture) continue;

    it(`${key} in server mode: the stubbed writer is the model, the commit stamps a server origin`, async () => {
      const write = vi.fn(async (_run, brief) => ({
        output: fixture.outputs[brief.part.key],
        usage: { provider: 'stub', model: 'stub-1', tokens: 1 },
      }));
      const { ctx, state, recording } = harness(fixture, 'server', {
        write,
        dispatch: vi.fn(),
      });
      const run = await openRun(
        key,
        {
          ...fixture.lock,
          accountId: TEST_IDS.account,
          input: { kind: 'stage', target: fixture.target },
        },
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      const result = await executeServerRun(run, ctx);

      expect(result.commit.status).toBe('committed');
      expect(run.mode).toBe('server');
      expect(state.rows.get(run.id)?.status).toBe('committed');
      expect(write).toHaveBeenCalled();

      const stamped = recording
        .writes()
        .map((w) => JSON.stringify(w.payload))
        .some((p) => p.includes('"kind":"server"') && p.includes(run.id));
      expect(stamped, `${key} stamps generation_origin`).toBe(true);
    });

    it(`${key} in external mode: the submitted fixture is committed, the writer is never reached, no usage row can exist`, async () => {
      const write = vi.fn();
      const dispatch = vi.fn();
      const { ctx, state, recording } = harness(fixture, 'external', {
        write,
        dispatch,
      });
      const run = await openRun(
        key,
        {
          ...fixture.lock,
          accountId: TEST_IDS.account,
          input: { kind: 'stage', target: fixture.target },
        },
        { kind: 'mcp', name: 'matrix', clientName: 'test-client' },
        ctx,
      );

      expect(run.mode).toBe('external');

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      const result = await finalizeRun(
        run,
        ctx,
        parts.map((part) => ({
          key: part.key,
          output: fixture.outputs[part.key],
        })),
      );

      expect(result.commit.status).toBe('committed');
      expect(write).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      // Zero llm_usage_analytics rows: no insert into the table was issued
      expect(
        recording.writes().filter((w) => w.table === 'llm_usage_analytics'),
      ).toEqual([]);
      expect(state.rows.get(run.id)?.status).toBe('committed');

      const stamped = recording
        .writes()
        .map((w) => JSON.stringify(w.payload))
        .some(
          (p) => p.includes('"kind":"external"') && p.includes('test-client'),
        );
      expect(stamped, `${key} stamps an external origin with the client`).toBe(
        true,
      );
    });
  }
});
