/**
 * A run handle for tests: a `RunHandle` over a recording client whose RPCs
 * answer from an in-memory row, so `renewLease`, the status transitions and
 * `snapshot` behave as the database would without one. Test-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { CommitPlan } from '../commit-plan';
import { applyPlanThroughClient } from '../commit-through-client';
import { RunHandle } from '../runs/run-handle';
import type {
  RunBackend,
  RunCtx,
  RunInput,
  RunOrigin,
  RunRow,
} from '../runs/types';
import type { GenerationMode, StageKey, TargetType } from '../types';
import {
  type AsyncResponder,
  type RecordedCall,
  type Responder,
  recordingClient,
} from './index';

export const TEST_IDS = {
  run: '19030000-0000-4000-8000-00000000aaaa',
  account: '11111111-1111-4111-8111-111111111111',
  project: '22222222-2222-4222-8222-222222222222',
  episode: '55555555-5555-4555-8555-555555555555',
  user: '77777777-7777-4777-8777-777777777777',
};

export interface FakeRunOptions {
  id?: string;
  mode?: GenerationMode;
  stage?: StageKey;
  status?: RunRow['status'];
  targetType?: TargetType;
  targetId?: string;
  accountId?: string;
  projectId?: string | null;
  input?: RunInput;
  origin?: RunOrigin;
  leaseExpiresAt?: string | null;
  targetVersion?: number | null;
  parentRunId?: string | null;
  connectionId?: string | null;
  createdBy?: string;
}

export function fakeRunRow(
  options: FakeRunOptions = {},
  now = new Date(),
): RunRow {
  return {
    id: options.id ?? TEST_IDS.run,
    accountId: options.accountId ?? TEST_IDS.account,
    projectId:
      options.projectId === undefined ? TEST_IDS.project : options.projectId,
    targetType: options.targetType ?? 'episode',
    targetId: options.targetId ?? TEST_IDS.episode,
    stage: options.stage ?? 'story_refinement',
    mode: options.mode ?? 'server',
    status: options.status ?? 'briefed',
    leaseExpiresAt:
      options.leaseExpiresAt === undefined
        ? new Date(now.getTime() + 30 * 60 * 1000).toISOString()
        : options.leaseExpiresAt,
    targetVersion: options.targetVersion ?? null,
    promptSlug: null,
    promptVersion: null,
    origin: options.origin ?? { kind: 'web', name: 'test' },
    input: options.input ?? { kind: 'stage', target: {} },
    connectionId: options.connectionId ?? null,
    parentRunId: options.parentRunId ?? null,
    error: null,
    createdBy: options.createdBy ?? TEST_IDS.user,
    createdAt: now.toISOString(),
    finalizedAt: null,
  };
}

/** The row as the database returns it. */
export function toSnakeRow(row: RunRow) {
  return {
    id: row.id,
    account_id: row.accountId,
    project_id: row.projectId,
    target_type: row.targetType,
    target_id: row.targetId,
    stage: row.stage,
    mode: row.mode,
    status: row.status,
    lease_expires_at: row.leaseExpiresAt,
    target_version: row.targetVersion,
    prompt_slug: row.promptSlug,
    prompt_version: row.promptVersion,
    origin: row.origin,
    input: row.input,
    connection_id: row.connectionId,
    parent_run_id: row.parentRunId,
    error: row.error,
    created_by: row.createdBy,
    created_at: row.createdAt,
    finalized_at: row.finalizedAt,
  };
}

export interface RunStoreState {
  /** The rows, by id; transitions and renewals update them in place */
  rows: Map<string, RunRow>;
  /** Every rpc call, in order */
  rpcs: Array<{ fn: string; args: unknown }>;
  /** Snapshots recorded, in order */
  revisions: Array<{ runId: string; snapshot: unknown }>;
  /** Set to make the next openRun collide: the holder returned */
  holder?: RunRow;
  /** Rows the fake `account_ai_settings` table holds, by account */
  settings: Map<string, Record<string, unknown>>;
  /** `episodes.version` by episode id, for TARGET_CHANGED */
  episodeVersions: Map<string, number>;
  /** Every `apply_generation_commit`, in order */
  commits: Array<{ runId: string; plan: CommitPlan; finalize: boolean }>;
  /**
   * The client a commit's plan is replayed through, one PostgREST call per
   * write, so a test records the rows the database function would write.
   * `fakeRunHandle` sets it; a test that builds its own recording sets it.
   */
  client?: SupabaseClient<Database>;
}

function isOpen(row: RunRow, now = new Date()) {
  return (
    (row.status === 'briefed' || row.status === 'in_progress') &&
    (row.leaseExpiresAt === null || new Date(row.leaseExpiresAt) > now)
  );
}

/**
 * Answers the run layer's RPCs and reads from `state`, and defers anything
 * else to `fallback`.
 */
export function runStoreResponder(
  state: RunStoreState,
  fallback: Responder = () => undefined,
): AsyncResponder {
  let nextId = 1;

  return (call: RecordedCall) => {
    if (call.table.startsWith('rpc:')) {
      const fn = call.table.slice(4);
      const args = (call.chain[0]?.args[0] ?? {}) as Record<string, unknown>;
      state.rpcs.push({ fn, args });

      switch (fn) {
        case 'open_generation_run': {
          if (state.holder) {
            const holder = state.holder;
            return {
              data: {
                ok: false,
                code: 'RUN_IN_PROGRESS',
                holder: {
                  id: holder.id,
                  mode: holder.mode,
                  status: holder.status,
                  created_by: holder.createdBy,
                  created_at: holder.createdAt,
                  lease_expires_at: holder.leaseExpiresAt,
                  origin: holder.origin,
                },
              },
            };
          }

          const row = fakeRunRow({
            id: `19030000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
            accountId: args.p_account_id as string,
            projectId: (args.p_project_id as string | undefined) ?? null,
            targetType: args.p_target_type as TargetType,
            targetId: args.p_target_id as string,
            stage: args.p_stage as StageKey,
            mode: args.p_mode as GenerationMode,
            input: args.p_input as RunInput,
            origin: args.p_origin as RunOrigin,
            targetVersion:
              (args.p_target_version as number | undefined) ?? null,
            parentRunId: (args.p_parent_run_id as string | undefined) ?? null,
            connectionId: (args.p_connection_id as string | undefined) ?? null,
            createdBy:
              (args.p_created_by as string | undefined) ?? TEST_IDS.user,
          });
          state.rows.set(row.id, row);

          return { data: { ok: true, run: toSnakeRow(row) } };
        }
        case 'renew_generation_run_lease': {
          const row = state.rows.get(args.p_run_id as string);
          if (!row) return { data: { ok: false, code: 'RUN_NOT_FOUND' } };
          if (!isOpen(row)) {
            return {
              data: { ok: false, code: 'RUN_NOT_OPEN', run: toSnakeRow(row) },
            };
          }
          row.leaseExpiresAt = new Date(
            Date.now() + 30 * 60 * 1000,
          ).toISOString();
          return { data: { ok: true, run: toSnakeRow(row) } };
        }
        case 'transition_generation_run': {
          const row = state.rows.get(args.p_run_id as string);
          if (!row) return { data: { ok: false, code: 'RUN_NOT_FOUND' } };
          if (row.status !== 'briefed' && row.status !== 'in_progress') {
            return {
              data: { ok: false, code: 'RUN_NOT_OPEN', run: toSnakeRow(row) },
            };
          }
          row.status = args.p_status as RunRow['status'];
          if (row.status === 'in_progress') {
            row.leaseExpiresAt = new Date(
              Date.now() + 30 * 60 * 1000,
            ).toISOString();
          } else {
            row.finalizedAt = new Date().toISOString();
            row.error =
              (args.p_error as Record<string, unknown> | undefined) ??
              row.error;
          }
          return { data: { ok: true, run: toSnakeRow(row) } };
        }
        case 'apply_generation_commit': {
          const row = state.rows.get(args.p_run_id as string);
          if (!row) return { data: { ok: false, code: 'RUN_NOT_FOUND' } };
          if (!isOpen(row)) {
            return {
              data: { ok: false, code: 'RUN_NOT_OPEN', run: toSnakeRow(row) },
            };
          }

          const version =
            row.targetType === 'episode'
              ? state.episodeVersions.get(row.targetId)
              : undefined;

          if (
            row.targetVersion !== null &&
            version !== undefined &&
            version !== row.targetVersion
          ) {
            return {
              data: {
                ok: false,
                code: 'TARGET_CHANGED',
                current_version: version,
                run: toSnakeRow(row),
              },
            };
          }

          const plan = args.p_plan as CommitPlan;
          const finalize = args.p_finalize !== false;
          state.commits.push({ runId: row.id, plan, finalize });

          if (!state.client) {
            throw new Error(
              'fake run store: set state.client to replay a commit plan',
            );
          }

          // A failed write comes back as the database's error, as PostgREST
          // reports a function that raised
          return applyPlanThroughClient(state.client, plan).then(
            (applied) => {
              if (finalize) {
                row.status = 'committed';
                row.finalizedAt = new Date().toISOString();
              }

              return {
                data: {
                  ok: true,
                  run: toSnakeRow(row),
                  results: applied.results,
                  skipped: applied.skipped,
                  revision_id: null,
                },
              };
            },
            (error: unknown) => ({
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          );
        }
        case 'record_content_revision': {
          state.revisions.push({
            runId: args.p_run_id as string,
            snapshot: args.p_snapshot,
          });
          return {
            data: `19030000-0000-4000-8000-0000000000c${state.revisions.length}`,
          };
        }
        default:
          return fallback(call);
      }
    }

    if (call.table === 'generation_runs') {
      const eq = call.chain.find((step) => step.method === 'eq');
      const row = eq ? state.rows.get(eq.args[1] as string) : undefined;
      return { data: row ? toSnakeRow(row) : null };
    }

    if (call.table === 'account_ai_settings') {
      const eq = call.chain.find((step) => step.method === 'eq');
      const row = eq ? state.settings.get(eq.args[1] as string) : undefined;
      return { data: row ?? null };
    }

    if (
      call.table === 'episodes' &&
      call.chain.some(
        (step) => step.method === 'select' && step.args[0] === 'version',
      )
    ) {
      const eq = call.chain.find((step) => step.method === 'eq');
      const version = eq
        ? state.episodeVersions.get(eq.args[1] as string)
        : undefined;
      return { data: version === undefined ? null : { version } };
    }

    return fallback(call);
  };
}

export function runStoreState(rows: RunRow[] = []): RunStoreState {
  return {
    rows: new Map(rows.map((row) => [row.id, row])),
    rpcs: [],
    revisions: [],
    settings: new Map(),
    episodeVersions: new Map(),
    commits: [],
  };
}

export interface FakeRun {
  run: RunHandle;
  state: RunStoreState;
  ctx: RunCtx;
  calls: RecordedCall[];
}

/**
 * A `RunHandle` whose store is in memory. `backend` is what a server run
 * writes and dispatches through; leave it out to assert neither is reached.
 */
export function fakeRunHandle(
  options: FakeRunOptions & {
    backend?: RunBackend;
    ctx?: Partial<RunCtx>;
    fallback?: Responder;
    /**
     * The client a commit's plan is replayed through: a handler test's own
     * recording, so the rows the commit writes land beside the handler's
     * other calls. Defaults to the run's recording.
     */
    commitsThrough?: SupabaseClient<Database>;
  } = {},
): FakeRun {
  const row = fakeRunRow(options);
  const state = runStoreState([row]);
  const recording = recordingClient(runStoreResponder(state, options.fallback));
  state.client = options.commitsThrough ?? recording.client;
  const ctx: RunCtx = {
    client: recording.client,
    accountId: row.accountId,
    userId: row.createdBy,
    backend: options.backend,
    ...options.ctx,
  };

  return { run: new RunHandle(row, ctx), state, ctx, calls: recording.calls };
}
