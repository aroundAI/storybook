/**
 * A commit plan applied through PostgREST, one statement per write, in the
 * calls the stage handlers made before plans existed. Two uses:
 *
 * - a commit outside a run, which `applyCommit` allows only for a plan of a
 *   single write (atomic by itself);
 * - the tests' recorder: the fake run store applies `apply_generation_commit`
 *   through this, so the parity tests see the same row writes as before.
 *
 * It is not a transaction: a 'skip' step that fails is reported but what it
 * wrote before failing stays. Under a run the database function applies the
 * plan instead (`runs/store.ts` `applyGenerationCommit`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type {
  AppliedCommit,
  CommitFilter,
  CommitPlan,
  CommitRow,
  CommitWrite,
  SkippedStep,
} from './commit-plan';

interface Response {
  data: unknown;
  error: { message: string } | null;
}

interface Chain extends PromiseLike<Response> {
  [method: string]: unknown;
}

function step(chain: Chain, method: string, ...args: unknown[]): Chain {
  return (chain[method] as (...a: unknown[]) => Chain)(...args);
}

function filtered(
  chain: Chain,
  match: CommitFilter[],
  results: Record<string, CommitRow[]>,
): Chain {
  return match.reduce((query, filter) => {
    return step(
      query,
      filter.op,
      filter.column,
      resolveRefs(filter.value, results),
    );
  }, chain);
}

function rowsOf(data: unknown): CommitRow[] {
  if (Array.isArray(data)) return data as CommitRow[];
  return data && typeof data === 'object' ? [data as CommitRow] : [];
}

/** `$ref` and `$union`, as `kit.resolve_generation_commit_refs` resolves them. */
export function resolveRefs(
  value: unknown,
  results: Record<string, CommitRow[]>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, results));
  }

  if (!value || typeof value !== 'object') return value;

  const object = value as Record<string, unknown>;

  if (typeof object.$ref === 'string') {
    const rows = results[object.$ref];

    if (!rows) {
      throw new Error(
        `a commit write refers to ${object.$ref}, which wrote nothing`,
      );
    }

    const values = rows.map((row) => row[object.column as string]);
    return object.one ? values[0] : values;
  }

  if (Array.isArray(object.$union)) {
    const arrays = resolveRefs(object.$union, results) as unknown[][];
    const seen = new Set<string>();

    return arrays.flat().filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      resolveRefs(item, results),
    ]),
  );
}

async function applyWrite(
  client: SupabaseClient<Database>,
  write: CommitWrite,
  results: Record<string, CommitRow[]>,
): Promise<void> {
  if (
    write.onlyIfRows &&
    !write.onlyIfRows.some((key) => (results[key]?.length ?? 0) > 0)
  ) {
    if (write.key) results[write.key] = [];
    return;
  }

  const from = () =>
    (client as unknown as { from(table: string): Chain }).from(write.table);
  let query: Chain;

  switch (write.op) {
    case 'insert':
    case 'upsert': {
      const rows = resolveRefs(write.rows, results) as CommitRow[];

      if (rows.length === 0) {
        if (write.key) results[write.key] = [];
        return;
      }

      const body = write.asObject && rows.length === 1 ? rows[0] : rows;

      query =
        write.op === 'insert'
          ? step(from(), 'insert', body)
          : step(from(), 'upsert', body, {
              onConflict: write.onConflict,
              ...(write.ignoreDuplicates === undefined
                ? {}
                : { ignoreDuplicates: write.ignoreDuplicates }),
            });
      break;
    }
    case 'update': {
      let values = resolveRefs(write.values, results) as CommitRow;

      // A merge reads the column first, as the handlers did, and writes the
      // merged object; the database function merges in place instead
      if (write.merge?.length) {
        const { data, error } = await step(
          filtered(
            step(from(), 'select', write.merge.join(', ')),
            write.match,
            results,
          ),
          'single',
        );

        if (error) {
          throw new Error(`reading ${write.table} to merge: ${error.message}`);
        }

        const current = rowsOf(data)[0] ?? {};
        values = {
          ...values,
          ...Object.fromEntries(
            write.merge.map((column) => [
              column,
              {
                ...((current[column] as Record<string, unknown>) ?? {}),
                ...(values[column] as Record<string, unknown>),
              },
            ]),
          ),
        };
      }

      query = filtered(step(from(), 'update', values), write.match, results);
      break;
    }
    case 'delete':
      query = filtered(step(from(), 'delete'), write.match, results);
      break;
  }

  const wantsRows = Boolean(write.key || write.requireRows);

  if (wantsRows) {
    query = step(query, 'select', write.returning?.join(', ') ?? 'id');
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`the ${write.op} on ${write.table}: ${error.message}`);
  }

  const rows = rowsOf(data);

  if (write.requireRows && rows.length === 0) {
    throw new Error(
      `COMMIT_NO_ROWS: the ${write.op} on ${write.table} matched no row`,
    );
  }

  if (write.key) {
    const columns = write.returning ?? [];
    results[write.key] = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, row[column]])),
    );
  }
}

export async function applyPlanThroughClient(
  client: SupabaseClient<Database>,
  plan: CommitPlan,
): Promise<AppliedCommit> {
  const results: Record<string, CommitRow[]> = {};
  const skipped: SkippedStep[] = [];

  for (const commitStep of plan.ops) {
    const writes = commitStep.op === 'group' ? commitStep.ops : [commitStep];
    const skippable =
      commitStep.op === 'group' || commitStep.onError === 'skip';

    try {
      for (const write of writes) {
        await applyWrite(client, write, results);
      }
    } catch (error) {
      if (!skippable) throw error;

      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[commit] ${commitStep.key ?? commitStep.op} skipped: ${message}`,
      );
      skipped.push({
        key: commitStep.key ?? null,
        table: commitStep.op === 'group' ? null : commitStep.table,
        error: message,
      });
    }
  }

  return { results, skipped, revisionId: null, finalized: false };
}
