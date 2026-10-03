import type {
  AnyStageDefinition,
  CommitResult,
  EpisodeContextSnapshot,
  StageKey,
} from '@kit/generation';

import type {
  McpRunCtx,
  OpenRunTarget,
  RunApi,
  RunLike,
} from '../../src/server/tools/generation/run-api';
import type { RecordedCall } from './fake-supabase';

/**
 * FILM-1903's run layer, in memory: a RunHandle-shaped run and the
 * open/load/finalize the generation tools call, with the one-open-run rule
 * and RunError's shape, so the tools are tested without a database.
 */
export class FakeRunError extends Error {
  override readonly name = 'RunError';

  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class FakeRun implements RunLike {
  status = 'briefed';
  leaseExpiresAt: string | null = new Date(
    Date.now() + 30 * 60 * 1000,
  ).toISOString();
  error: Record<string, unknown> | null = null;
  parentRunId: string | null = null;
  renewals = 0;

  constructor(
    readonly id: string,
    readonly stage: StageKey,
    readonly mode: 'server' | 'external',
    readonly target: OpenRunTarget,
    readonly origin: RunLike['origin'],
    readonly connectionId: string | null,
    readonly createdBy: string,
  ) {}

  get accountId() {
    return this.target.accountId;
  }
  get projectId() {
    return this.target.projectId;
  }
  get targetType() {
    return this.target.type;
  }
  get targetId() {
    return this.target.id;
  }
  get targetVersion() {
    return this.target.targetVersion;
  }
  get input() {
    return this.target.input;
  }

  isOpen(now = new Date()) {
    return (
      (this.status === 'briefed' || this.status === 'in_progress') &&
      (this.leaseExpiresAt === null ||
        new Date(this.leaseExpiresAt).getTime() > now.getTime())
    );
  }

  async renewLease() {
    this.renewals += 1;
    return this;
  }

  async cancel() {
    if (!this.isOpen()) {
      throw new FakeRunError(
        'RUN_NOT_OPEN',
        `Run ${this.id} is ${this.status}`,
      );
    }
    this.status = 'cancelled';
  }
}

export interface FakeRunApi extends RunApi {
  runs: Map<string, FakeRun>;
  opened: Array<{ stage: StageKey; ctx: McpRunCtx }>;
  finalized: Array<{
    runId: string;
    parts: Array<{ key: string; output: unknown }>;
  }>;
  commits: CommitResult[];
  /** Makes the next finalize throw, as TARGET_CHANGED would */
  failNextFinalize?: Error;
}

let counter = 0;

export function fakeRunId() {
  counter += 1;
  return `aaaaaaaa-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function createFakeRunApi(
  stages: Partial<Record<StageKey, AnyStageDefinition>>,
): FakeRunApi {
  const api: FakeRunApi = {
    runs: new Map(),
    opened: [],
    finalized: [],
    commits: [],

    stage(key) {
      const stage = stages[key];
      if (!stage) throw new Error(`Stage ${key} is not registered`);
      return stage;
    },

    async open(stage, target, origin, ctx) {
      for (const run of api.runs.values()) {
        if (
          run.isOpen() &&
          run.stage === stage &&
          run.targetType === target.type &&
          run.targetId === target.id
        ) {
          throw new FakeRunError('RUN_IN_PROGRESS', 'already open', {
            holder: {
              id: run.id,
              mode: run.mode,
              status: run.status,
              createdBy: run.createdBy,
              createdAt: '2026-10-03T12:00:00.000Z',
              leaseExpiresAt: run.leaseExpiresAt,
              origin: run.origin,
            },
          });
        }
      }

      // openRun's rule: a connection id or the MCP seam makes it external
      const mode = ctx.connectionId ? 'external' : (ctx.runMode() ?? 'server');
      const run = new FakeRun(
        fakeRunId(),
        stage,
        mode,
        target,
        { ...origin },
        ctx.connectionId,
        ctx.userId,
      );

      api.runs.set(run.id, run);
      api.opened.push({ stage, ctx });

      return run;
    },

    async load(runId) {
      return api.runs.get(runId) ?? null;
    },

    async finalize(run, ctx, parts) {
      const fake = run as FakeRun;

      if (api.failNextFinalize) {
        const error = api.failNextFinalize;
        api.failNextFinalize = undefined;
        fake.status = 'failed';
        throw error;
      }

      api.finalized.push({ runId: run.id, parts });

      const stage = api.stage(run.stage);
      const commit = await stage.commit(
        ctx,
        {
          id: run.id,
          mode: run.mode,
          origin: {
            kind: run.mode,
            runId: run.id,
            model: run.origin.model,
            clientName: run.origin.clientName,
            at: new Date().toISOString(),
          },
        },
        stage.targetSchema.parse(run.input.target),
        parts.map((part) => part.output),
      );

      api.commits.push(commit);
      fake.status = 'committed';

      return { commit, children: [] };
    },
  };

  return api;
}

interface StoredRow {
  run_id: string;
  part_key: string;
  output: unknown;
  validation: Record<string, unknown>;
  submitted_at: string;
}

/**
 * `generation_run_parts` and `submit_generation_run_part`, in memory, with
 * the function's rules: an accepted part replaces the output and keeps the
 * failures; a rejection is appended and never replaces an accepted output.
 */
export function partsResponders(runs: FakeRunApi) {
  const rows: StoredRow[] = [];

  const filterValue = (call: RecordedCall, method: string, column: string) =>
    call.filters.find((f) => f.method === method && f.args[0] === column)
      ?.args[1];

  return {
    rows,
    responders: {
      generation_run_parts: (call: RecordedCall) => {
        const runId = filterValue(call, 'eq', 'run_id') as string | undefined;
        const runIds = filterValue(call, 'in', 'run_id') as
          | string[]
          | undefined;
        const partKey = filterValue(call, 'eq', 'part_key') as
          | string
          | undefined;

        return {
          data: rows.filter(
            (row) =>
              (runId === undefined || row.run_id === runId) &&
              (runIds === undefined || runIds.includes(row.run_id)) &&
              (partKey === undefined || row.part_key === partKey),
          ),
        };
      },
      'rpc:submit_generation_run_part': (call: RecordedCall) => {
        const args = call.payload as {
          p_run_id: string;
          p_part_key: string;
          p_output: unknown;
          p_validation: Record<string, unknown>;
          p_accepted: boolean;
          p_model?: string;
        };
        const run = runs.runs.get(args.p_run_id);

        if (!run) return { data: { ok: false, code: 'RUN_NOT_FOUND' } };
        if (!run.isOpen()) {
          return {
            data: {
              ok: false,
              code: 'RUN_NOT_OPEN',
              run: { status: run.status },
            },
          };
        }

        const existing = rows.find(
          (row) =>
            row.run_id === args.p_run_id && row.part_key === args.p_part_key,
        );
        const failures = (existing?.validation.failures as unknown[]) ?? [];
        const now = new Date().toISOString();

        if (args.p_accepted) {
          const validation = {
            ...args.p_validation,
            status: 'accepted',
            failures,
          };

          if (existing) {
            existing.output = args.p_output;
            existing.validation = validation;
            existing.submitted_at = now;
          } else {
            rows.push({
              run_id: args.p_run_id,
              part_key: args.p_part_key,
              output: args.p_output,
              validation,
              submitted_at: now,
            });
          }
        } else {
          const failure = {
            at: now,
            hash: args.p_validation.hash,
            errors: args.p_validation.errors,
          };

          if (existing) {
            existing.validation = {
              ...existing.validation,
              failures: [...failures, failure].slice(-20),
            };
          } else {
            rows.push({
              run_id: args.p_run_id,
              part_key: args.p_part_key,
              output: args.p_output,
              validation: { status: 'rejected', failures: [failure] },
              submitted_at: now,
            });
          }
        }

        run.status = 'in_progress';

        if (args.p_model) {
          (run.origin as Record<string, unknown>).model = args.p_model;
        }

        return { data: { ok: true } };
      },
    },
  };
}

export const EPISODE_CONTEXT: EpisodeContextSnapshot = {
  episodeNumber: 2,
  seasonNumber: 1,
  characters: '- Maya Chen: commander',
  locations: '- Observation deck',
  previousEpisodes: '',
  counts: { characters: 1, locations: 1 },
};
