import type { CanonReadClient } from '../../src/lib/canon/memory-context-builder';

/**
 * A stand-in for the Supabase client the memory context builder reads with.
 *
 * It returns the rows given per table and records every filter call, so a
 * test can assert what was asked for. It cannot reject a column the way
 * PostgREST does — that is what `scripts/verify-memory-context.ts` is for.
 */
export interface FakeTable {
  rows?: unknown[];
  error?: { message: string };
}

export interface RecordedQuery {
  table: string;
  calls: Array<[method: string, ...args: unknown[]]>;
}

export function createFakeCanonClient(tables: Record<string, FakeTable> = {}) {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      const recorded: RecordedQuery = { table, calls: [] };
      queries.push(recorded);

      const result = () => ({
        data: tables[table]?.error ? null : (tables[table]?.rows ?? []),
        error: tables[table]?.error ?? null,
      });

      const single = () => {
        const { data, error } = result();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      };

      const query: Record<string, unknown> = {
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
        maybeSingle: single,
        single,
      };

      for (const method of [
        'select',
        'eq',
        'in',
        'order',
        'limit',
        'gte',
        'lt',
      ]) {
        query[method] = (...args: unknown[]) => {
          recorded.calls.push([method, ...args]);
          return query;
        };
      }

      return query;
    },
  };

  return {
    client: client as unknown as CanonReadClient,
    queries,
    /** Every filter applied to `table`, across all queries of it */
    callsOn(table: string, method?: string) {
      return queries
        .filter((q) => q.table === table)
        .flatMap((q) => q.calls)
        .filter(([m]) => method === undefined || m === method);
    },
  };
}
