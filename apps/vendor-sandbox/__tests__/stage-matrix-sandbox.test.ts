import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodIssueCode } from 'zod';

import { gatewayBackend } from '@kit/ai-gateway';
import {
  ALL_STAGES,
  type StageKey,
  StageOutputRejected,
  executeServerRun,
  openRun,
  registeredStageKeys,
} from '@kit/generation';
import {
  FOLLOW_ONS,
  MATRIX_FIXTURES,
  REVIEW_STAGES,
  matrixHarness,
  matrixRunTarget,
} from '@kit/generation/testing';

import { type Sandbox, guardEgress, startSandbox } from './helpers';

/**
 * FILM-1902 criterion 10, the server leg against the FILM-1803 AI sandbox.
 * Every registered stage runs through `executeServerRun` with the gateway's
 * own writer: the stage's real prompt, rendered with the variables its
 * prepare() put on the brief, goes over HTTP to the sandbox through the
 * real Gemini client, comes back through the Lambda executor's parsing, and
 * must then pass the stage's output schema and its own check() before its
 * commit plan is applied to the recording client. Nothing between the
 * brief and the sandbox is stubbed; only the usage row's Supabase insert
 * and the follow-on dispatch (an SQS send) are.
 *
 * The stages are `ALL_STAGES` and their fixtures the matrix's
 * (`@kit/generation/testing`). Every stage is either in COMMITS or in
 * SHAPE_GAP; a stage registered in neither fails the suite, naming itself.
 */

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => ({
    from: () => ({ insert: async () => ({ data: null, error: null }) }),
  }),
}));

/** FILM-1901 parts A to D registered fourteen; fewer means the registry lost one. */
const STAGE_FLOOR = 14;

/** Stages the gateway's writer runs end to end: schema, check(), commit. */
const COMMITS = new Set<StageKey>([
  'asset_description',
  'audio_cues',
  'episode_summary',
  'fact_extraction',
  'ideation',
  'publish_metadata',
  'screenplay_refinement',
  'season_analysis',
  'story',
  'story_refinement',
]);

/**
 * Stages the gateway's server writer cannot run, whatever the model says:
 * the brief's prompt does not return the stage's output shape, because in
 * the worker their server mode is the handler's orchestrator, which adapts
 * its result to the stage (KB-184). Each must fail at the output schema,
 * before check(); when one passes, or fails any other way, this test fails.
 * Fixed: move it to COMMITS and mark the KB fixed.
 */
const SHAPE_GAP: Partial<Record<StageKey, string>> = {
  dialogue_translation: 'the prompt returns numbered lines, not translations',
  screenplay: 'the prompt wraps the scenes in `screenplay`',
  season_outline: 'the executor unwraps `episodes` to an array',
  shots: 'reel-scout and scene-shot replies carry no `kind`',
};

const SCHEMA_CODES: string[] = Object.values(ZodIssueCode);

let sandbox: Sandbox;
let refused: string[];

beforeAll(async () => {
  sandbox = await startSandbox();
  refused = guardEgress();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await sandbox.close();
});

function geminiCalls() {
  return sandbox.state.ledger.list({ vendor: 'gemini' }).length;
}

const STAGE_KEYS = ALL_STAGES.map((stage) => stage.key);

describe('every registered stage, in server mode, against the AI sandbox', () => {
  it(`covers every stage (at least ${STAGE_FLOOR}), each in COMMITS or SHAPE_GAP`, () => {
    expect(STAGE_KEYS.length).toBeGreaterThanOrEqual(STAGE_FLOOR);
    expect([...STAGE_KEYS].sort()).toEqual(registeredStageKeys().sort());
    expect(Object.keys(MATRIX_FIXTURES).sort()).toEqual([...STAGE_KEYS].sort());
    expect(
      [...COMMITS, ...Object.keys(SHAPE_GAP)].sort(),
      'COMMITS and SHAPE_GAP together are every stage, once',
    ).toEqual([...STAGE_KEYS].sort());
  });

  it.each(STAGE_KEYS.map((key) => [key] as [StageKey]))(
    '%s: the sandbox output passes the stage’s schema and check(), and its plan commits (or is a pinned shape gap)',
    async (key) => {
      const gap = SHAPE_GAP[key];
      expect(
        COMMITS.has(key) || gap !== undefined,
        `${key} is in neither COMMITS nor SHAPE_GAP`,
      ).toBe(true);

      const stage = ALL_STAGES.find((s) => s.key === key)!;
      const check = vi.spyOn(stage, 'check');
      const fixture = MATRIX_FIXTURES[key]!;
      const { ctx, state } = matrixHarness(fixture, 'server', {
        write: gatewayBackend.write,
        dispatch: vi.fn(),
      });
      const run = await openRun(
        key,
        matrixRunTarget(fixture),
        { kind: 'web', name: 'matrix-sandbox' },
        ctx,
      );
      const before = geminiCalls();

      try {
        if (gap) {
          const failure = await executeServerRun(run, ctx).then(
            () => null,
            (error: unknown) => error,
          );
          expect(
            failure,
            `${key} is in SHAPE_GAP (${gap}) but did not fail as recorded - if KB-184 is fixed, move it to COMMITS`,
          ).toBeInstanceOf(StageOutputRejected);
          const rejected = failure as StageOutputRejected;
          expect(rejected.stage, key).toBe(key);
          // The output schema refused it: Zod's codes only, check() never ran
          expect(rejected.errors.length, key).toBeGreaterThan(0);
          for (const error of rejected.errors) {
            expect(SCHEMA_CODES, `${key}: ${error.code}`).toContain(error.code);
          }
          expect(check, `${key} reached check()`).not.toHaveBeenCalled();
          expect(
            geminiCalls() - before,
            `${key} reached the sandbox`,
          ).toBeGreaterThan(0);
          expect(state.rows.get(run.id)?.status, key).toBe('failed');
          expect(state.commits, key).toEqual([]);
          return;
        }

        const result = await executeServerRun(run, ctx);

        expect(check, `${key} ran its check()`).toHaveBeenCalled();
        expect(result.commit.status, key).toBe(
          REVIEW_STAGES.has(key) ? 'skipped' : 'committed',
        );
        expect(state.rows.get(run.id)?.status, key).toBe('committed');
        expect(
          geminiCalls() - before,
          `${key} reached the sandbox`,
        ).toBeGreaterThan(0);
        expect(result.usage?.provider, key).toBeDefined();
        expect(
          result.children.map((child) => child.stage),
          key,
        ).toEqual(FOLLOW_ONS[key] ?? []);

        // A stage that writes does so in one plan, applied once, closing the run
        expect(state.commits.length, key).toBeLessThanOrEqual(1);
        for (const commit of state.commits) {
          expect(commit, key).toMatchObject({ runId: run.id, finalize: true });
          expect(commit.plan.ops.length, key).toBeGreaterThan(0);
        }
        expect(refused).toEqual([]);
      } finally {
        check.mockRestore();
      }
    },
  );
});
