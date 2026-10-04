import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setAgentStepWriter } from '@kit/agent';
import {
  agentStepWriterForCurrentRun,
  gatewayBackend,
  installStageWriters,
} from '@kit/ai-gateway';
import { STAGE_WRITERS } from '@kit/episodes/agent/stage-writers';
import {
  ALL_STAGES,
  type StageKey,
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
 * (`@kit/generation/testing`). Every stage must be in COMMITS; a stage
 * registered without being added there fails the suite, naming itself.
 * The orchestrated stages (screenplay, shots, season_outline,
 * dialogue_translation, story, ideation, audio_cues) write through their
 * stage writers, installed below as the worker installs them (KB-184).
 */

/** The llm_usage_analytics rows the gateway logged, by run id. */
const usageRuns = vi.hoisted(() => [] as unknown[]);

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => ({
    from: () => ({
      insert: async (row: { run_id?: unknown }) => {
        usageRuns.push(row.run_id);
        return { data: null, error: null };
      },
    }),
  }),
}));

/** FILM-1901 parts A to D registered fourteen; fewer means the registry lost one. */
const STAGE_FLOOR = 14;

/** Stages the gateway's writer runs end to end: schema, check(), commit. */
const COMMITS = new Set<StageKey>([
  'asset_description',
  'audio_cues',
  'dialogue_translation',
  'episode_summary',
  'fact_extraction',
  'ideation',
  'publish_metadata',
  'screenplay',
  'screenplay_refinement',
  'season_analysis',
  'season_outline',
  'shots',
  'story',
  'story_refinement',
]);

// What the worker installs at boot (utils/stage-runtime.ts, index.ts): the
// orchestrated stages' writers, and the agent loop's run-checked writer
installStageWriters(STAGE_WRITERS);
setAgentStepWriter(agentStepWriterForCurrentRun);

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
  it(`covers every stage (at least ${STAGE_FLOOR}), each in COMMITS`, () => {
    expect(STAGE_KEYS.length).toBeGreaterThanOrEqual(STAGE_FLOOR);
    expect([...STAGE_KEYS].sort()).toEqual(registeredStageKeys().sort());
    expect(Object.keys(MATRIX_FIXTURES).sort()).toEqual([...STAGE_KEYS].sort());
    expect([...COMMITS].sort(), 'COMMITS is every stage').toEqual(
      [...STAGE_KEYS].sort(),
    );
  });

  it.each(STAGE_KEYS.map((key) => [key] as [StageKey]))(
    '%s: the sandbox output passes the stage’s schema and check(), and its plan commits',
    async (key) => {
      expect(COMMITS.has(key), `${key} is not in COMMITS`).toBe(true);

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
        // Every model call, an orchestrator's agent steps and executor calls
        // included, is logged under the run (FILM-1902)
        expect(
          usageRuns.filter((runId) => runId === run.id).length,
          `${key} logged its model calls under its run`,
        ).toBeGreaterThan(0);
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
