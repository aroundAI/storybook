/**
 * A Supabase stand-in that records every query and answers from a script.
 * The parity tests (FILM-1901) run a fixture model output through the old
 * handler and the new commit and compare the writes each one made; the
 * stage tests use it to assert a commit's rows without a database.
 *
 * Test-only: `@kit/generation/testing` is not imported by product code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { AppliedCommit, CommitPlan } from '../commit-plan';
import { applyPlanThroughClient } from '../commit-through-client';

export interface RecordedStep {
  method: string;
  args: unknown[];
}

export interface RecordedCall {
  table: string;
  chain: RecordedStep[];
}

export interface ScriptedResponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

export type Responder = (call: RecordedCall) => ScriptedResponse | undefined;

/** A responder that may answer later: the fake run store applying a plan. */
export type AsyncResponder = (
  call: RecordedCall,
) => ScriptedResponse | undefined | Promise<ScriptedResponse | undefined>;

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

export interface RecordedWrite {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  payload: unknown;
  options?: unknown;
  /** The filters applied to the write, in order (`eq`, `in`, `is`, ...) */
  filters: RecordedStep[];
}

export interface RecordingClient {
  client: SupabaseClient<Database>;
  calls: RecordedCall[];
  /** Every insert, update, upsert and delete, in the order it was issued */
  writes(): RecordedWrite[];
}

const FILTER_METHODS = new Set([
  'eq',
  'neq',
  'in',
  'is',
  'not',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'match',
  'contains',
  'or',
  'filter',
]);

function stepOf(call: RecordedCall, method: string) {
  return call.chain.find((step) => step.method === method);
}

export function writesOf(calls: RecordedCall[]): RecordedWrite[] {
  return calls.flatMap((call) => {
    const write = call.chain.find((step) => WRITE_METHODS.has(step.method));

    if (!write) return [];

    return [
      {
        table: call.table,
        op: write.method as RecordedWrite['op'],
        payload: write.args[0],
        options: write.args[1],
        filters: call.chain.filter((step) => FILTER_METHODS.has(step.method)),
      },
    ];
  });
}

/**
 * One entry per row: an upsert of three rows and three upserts of one row
 * write the same rows, and compare equal here.
 */
export function flattenRows(writes: RecordedWrite[]): RecordedWrite[] {
  return writes.flatMap((write) =>
    Array.isArray(write.payload)
      ? write.payload.map((row) => ({ ...write, payload: row }))
      : [write],
  );
}

export function recordingClient(
  respond: Responder | AsyncResponder = () => undefined,
) {
  const calls: RecordedCall[] = [];

  function chainFor(call: RecordedCall): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            return (
              resolve: (value: unknown) => void,
              reject: (reason: unknown) => void,
            ) => {
              try {
                const answer = respond(call);
                const settle = (response: ScriptedResponse | undefined) =>
                  resolve({
                    data: response?.data ?? null,
                    error: response?.error ?? null,
                    count: response?.count ?? null,
                  });

                if (answer instanceof Promise) {
                  answer.then(settle, reject);
                } else {
                  settle(answer);
                }
              } catch (error) {
                reject(error);
              }
            };
          }

          if (typeof property !== 'string') return undefined;

          return (...args: unknown[]) => {
            call.chain.push({ method: property, args });
            return proxy;
          };
        },
      },
    );

    return proxy;
  }

  const client = {
    from(table: string) {
      const call: RecordedCall = { table, chain: [] };
      calls.push(call);
      return chainFor(call);
    },
    rpc(fn: string, args?: unknown) {
      const call: RecordedCall = {
        table: `rpc:${fn}`,
        chain: [{ method: 'rpc', args: [args] }],
      };
      calls.push(call);
      return chainFor(call);
    },
  } as unknown as SupabaseClient<Database>;

  const recording: RecordingClient = {
    client,
    calls,
    writes: () => writesOf(calls),
  };

  return recording;
}

/**
 * Answers a `select` on `table` with `row` (or `rows`), and everything else
 * with an empty success. Reads of the same table after a write still see
 * the original row: the parity tests compare what was written, not what a
 * later read would return.
 */
export function tableResponder(fixtures: Record<string, unknown>): Responder {
  return (call) => {
    const fixture = fixtures[call.table];

    if (fixture === undefined) return undefined;

    if (stepOf(call, 'select') && !writesOf([call]).length) {
      return { data: fixture };
    }

    if (stepOf(call, 'select')) {
      // A write with `.select()`: echo the written row(s) with the fixture's id
      const write = writesOf([call])[0];
      const payload = write?.payload;
      const id =
        fixture && typeof fixture === 'object' && 'id' in fixture
          ? (fixture as { id: unknown }).id
          : undefined;

      if (Array.isArray(payload)) {
        return {
          data: payload.map((row, index) => ({
            id: `${String(id ?? 'row')}-${index}`,
            ...(row as object),
          })),
        };
      }

      return {
        data: stepOf(call, 'single')
          ? { ...(fixture as object), ...(payload as object) }
          : [{ ...(fixture as object), ...(payload as object) }],
      };
    }

    return { data: null };
  };
}

/**
 * A `Ctx.commits` for a test without a run: every plan is kept and replayed
 * through `client`, one PostgREST call per write, so a test asserts both
 * the plan and the rows it writes. Under a run the database function
 * applies it instead (its behaviour is apply-generation-commit.test.sql's).
 */
export function recordCommits(client: SupabaseClient<Database>) {
  const plans: CommitPlan[] = [];

  return {
    plans,
    apply: async (plan: CommitPlan): Promise<AppliedCommit> => {
      plans.push(plan);
      return applyPlanThroughClient(client, plan);
    },
  };
}

export {
  TEST_IDS,
  fakeRunHandle,
  fakeRunRow,
  runStoreResponder,
  runStoreState,
  toSnakeRow,
  type FakeRun,
  type FakeRunOptions,
  type RunStoreState,
} from './runs';
