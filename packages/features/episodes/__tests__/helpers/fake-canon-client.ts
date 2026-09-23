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

      // `range(from, to)` slices the rows, as PostgREST pages them, so a
      // paged read (`fetchAllRows`) ends on an empty page.
      let window: [from: number, to: number] | undefined;

      const result = () => {
        const rows = tables[table]?.rows ?? [];
        return {
          data: tables[table]?.error
            ? null
            : window
              ? rows.slice(window[0], window[1] + 1)
              : rows,
          error: tables[table]?.error ?? null,
        };
      };

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
        range: (from: number, to: number) => {
          recorded.calls.push(['range', from, to]);
          window = [from, to];
          return query;
        },
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
