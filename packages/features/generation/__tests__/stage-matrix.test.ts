import { writeFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RunHandle,
  type StageKey,
  executeServerRun,
  finalizeRun,
  openRun,
  registeredStageKeys,
  stageRegistry,
} from '../src';
import {
  MATRIX_FIXTURES as FIXTURES,
  FOLLOW_ONS,
  ORIGIN_COLUMN_TABLES,
  REVIEW_STAGES,
  type RecordedWrite,
  STAMPED_TABLES,
  matrixHarness as harness,
  recordingClient,
  matrixRunTarget as runTarget,
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
/** Each follow-on is a child of the run, in its mode; a server child is dispatched, an external one is not. */
function expectChildren(
  key: StageKey,
  children: RunHandle[],
  parentId: string,
  mode: 'server' | 'external',
) {
  expect(
    children.map((child) => [child.stage, child.mode, child.parentRunId]),
    key,
  ).toEqual((FOLLOW_ONS[key] ?? []).map((stage) => [stage, mode, parentId]));
}

/** The stage's own outcome: a review stage's commit is a `skipped` that says why. */
function expectCommitted(key: StageKey, commit: { status: string }) {
  expect(commit.status, key).toBe(
    REVIEW_STAGES.has(key) ? 'skipped' : 'committed',
  );
}

function payloadsOf(writes: RecordedWrite[]) {
  return writes.map((w) => JSON.stringify(w.payload ?? null));
}

/** Every write that stamps generation_origin goes to a table that has the column. */
function expectOriginOnlyWhereColumnsExist(
  key: StageKey,
  writes: RecordedWrite[],
) {
  const misplaced = writes
    .filter((w) =>
      JSON.stringify(w.payload ?? null).includes('generation_origin'),
    )
    .map((w) => w.table)
    .filter((table) => !ORIGIN_COLUMN_TABLES.has(table));

  expect(
    misplaced,
    `${key} stamps a table with no generation_origin column`,
  ).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
        return { output: fixture.output(brief.part) };
      });
      const { ctx } = harness(fixture, 'server', { write, dispatch: vi.fn() });
      const run = await openRun(
        key,
        runTarget(fixture),
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      await executeServerRun(run, ctx);

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      expect(parts.length, key).toBeGreaterThan(0);
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
        output: fixture.output(brief.part),
        usage: { provider: 'stub', model: 'stub-1', tokens: 1 },
      }));
      const { ctx, state, recording } = harness(fixture, 'server', {
        write,
        dispatch: vi.fn(),
      });
      const run = await openRun(
        key,
        runTarget(fixture),
        { kind: 'web', name: 'matrix' },
        ctx,
      );

      const result = await executeServerRun(run, ctx);

      expectCommitted(key, result.commit);
      expect(run.mode).toBe('server');
      expect(state.rows.get(run.id)?.status).toBe('committed');
      expect(write).toHaveBeenCalled();
      expectOriginOnlyWhereColumnsExist(key, recording.writes());
      expectChildren(key, result.children, run.id, 'server');

      const stampable = recording
        .writes()
        .filter((w) => STAMPED_TABLES.has(w.table));
      if (stampable.length > 0) {
        const stamped = payloadsOf(stampable).some(
          (p) => p.includes('"kind":"server"') && p.includes(run.id),
        );
        expect(stamped, `${key} stamps generation_origin`).toBe(true);
      }
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
        runTarget(fixture),
        { kind: 'mcp', name: 'matrix', clientName: 'test-client' },
        ctx,
      );

      expect(run.mode).toBe('external');

      const parts = await stageRegistry.get(key)!.parts(ctx, fixture.target);
      const result = await finalizeRun(
        run,
        ctx,
        parts.map((part) => ({ key: part.key, output: fixture.output(part) })),
      );

      expectCommitted(key, result.commit);
      expect(write).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expectOriginOnlyWhereColumnsExist(key, recording.writes());
      expectChildren(key, result.children, run.id, 'external');
      // Zero llm_usage_analytics rows: no insert into the table was issued
      expect(
        recording.writes().filter((w) => w.table === 'llm_usage_analytics'),
      ).toEqual([]);
      expect(state.rows.get(run.id)?.status).toBe('committed');

      const stampable = recording
        .writes()
        .filter((w) => STAMPED_TABLES.has(w.table));
      if (stampable.length > 0) {
        const stamped = payloadsOf(stampable).some(
          (p) => p.includes('"kind":"external"') && p.includes('test-client'),
        );
        expect(
          stamped,
          `${key} stamps an external origin with the client`,
        ).toBe(true);
      }
    });
  }
});

/**
 * FILM-1901 criterion 4, FILM-1903: a stage's side effects are one plan the
 * run applies in one transaction. The plan is replayed through a second
 * recording here, so the stage's own client shows what was written outside
 * it: only runStage's generation_jobs bookkeeping before the commit.
 */
/**
 * CAPTURE_COMMIT_PLANS=<file> writes every plan the cases below commit, for
 * scripts/generation/commit-plans-pgtap.py to turn into the pgTAP file that
 * applies each through apply_generation_commit (apply-generation-commit-stages).
 */
const capturedPlans: unknown[] = [];

afterAll(() => {
  const file = process.env.CAPTURE_COMMIT_PLANS;
  if (file) writeFileSync(file, `${JSON.stringify(capturedPlans, null, 2)}\n`);
});

describe('every registered stage commits through one plan (FILM-1903)', () => {
  for (const key of registeredStageKeys()) {
    const fixture = FIXTURES[key];
    if (!fixture) continue;

    for (const mode of ['server', 'external'] as const) {
      it(`${key} in ${mode} mode writes only through apply_generation_commit, once, closing the run`, async () => {
        const write = vi.fn(async (_run, brief) => ({
          output: fixture.output(brief.part),
        }));
        const { ctx, state, recording } = harness(fixture, mode, {
          write,
          dispatch: vi.fn(),
        });
        const replay = recordingClient(fixture.respond);
        state.client = replay.client;

        const run = await openRun(
          key,
          runTarget(fixture),
          { kind: mode === 'server' ? 'web' : 'mcp', name: 'matrix' },
          ctx,
        );

        if (mode === 'server') {
          await executeServerRun(run, ctx);
        } else {
          const parts = await stageRegistry
            .get(key)!
            .parts(ctx, fixture.target);
          await finalizeRun(
            run,
            ctx,
            parts.map((part) => ({
              key: part.key,
              output: fixture.output(part),
            })),
          );
        }

        const outside = recording
          .writes()
          .filter(
            (w) =>
              !(
                w.table === 'generation_jobs' &&
                (w.payload as { status?: string }).status === 'processing'
              ),
          );
        expect(outside, `${key} writes outside its plan`).toEqual([]);
        expect(state.commits.length, key).toBeLessThanOrEqual(1);

        if (replay.writes().length > 0) {
          expect(state.commits, key).toEqual([
            expect.objectContaining({ runId: run.id, finalize: true }),
          ]);
        }

        if (process.env.CAPTURE_COMMIT_PLANS) {
          capturedPlans.push({
            stage: key,
            mode,
            lock: fixture.lock,
            plans: state.commits.map((commit) => commit.plan),
          });
        }

        // The snapshot is the database's, inside the same call
        expect(
          state.rpcs.filter((rpc) => rpc.fn === 'record_content_revision'),
        ).toEqual([]);
        expect(state.rows.get(run.id)?.status).toBe('committed');
      });
    }
  }
});
