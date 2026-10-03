import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * A recording stand-in for the principal's Supabase client. Every query
 * builder chain is recorded as one call (table, operation, payload,
 * filters), and answered from `responses`, so a test can assert what a
 * tool wrote and where, and never needs a database.
 */
export interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';
  payload: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
  columns?: string;
  head?: boolean;
  count?: string;
}

type Responder = (call: RecordedCall) => {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
};

export interface FakeClient {
  client: SupabaseClient<Database>;
  calls: RecordedCall[];
  /** Tables (and `rpc:<name>`) the client was asked about, in order. */
  tables(): string[];
}

type ResponseValue =
  | Responder
  | unknown[]
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null;

export function createFakeClient(
  responses: Record<string, ResponseValue> = {},
): FakeClient {
  const calls: RecordedCall[] = [];

  const answer = (call: RecordedCall) => {
    const key = call.op === 'rpc' ? `rpc:${call.table}` : call.table;
    const responder = responses[key];

    if (typeof responder === 'function') {
      const result = (responder as Responder)(call);

      return {
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      };
    }

    if (Array.isArray(responder)) {
      return { data: responder, error: null, count: responder.length };
    }

    if (responder !== undefined) {
      return { data: responder, error: null, count: null };
    }

    return { data: call.op === 'select' ? [] : null, error: null, count: 0 };
  };

  const builder = (call: RecordedCall) => {
    let single: 'single' | 'maybeSingle' | null = null;

    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        call.filters.push({ method, args });

        return chain;
      };

    for (const method of [
      'eq',
      'neq',
      'is',
      'in',
      'gt',
      'gte',
      'lt',
      'lte',
      'order',
      'limit',
      'range',
      'ilike',
      'like',
      'not',
      'or',
      'filter',
    ]) {
      chain[method] = record(method);
    }

    chain.select = (columns?: string, options?: Record<string, unknown>) => {
      if (call.op === 'select') {
        call.columns = columns;
        call.head = options?.head === true;
        call.count = options?.count as string | undefined;
      } else {
        call.filters.push({ method: 'select', args: [columns] });
      }

      return chain;
    };

    chain.single = () => {
      single = 'single';

      return chain;
    };

    chain.maybeSingle = () => {
      single = 'maybeSingle';

      return chain;
    };

    chain.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      try {
        const result = answer(call);
        let data = result.data;

        if (single && Array.isArray(data)) {
          data = data[0] ?? null;

          if (single === 'single' && data === null && !result.error) {
            return Promise.resolve(
              resolve({
                data: null,
                error: { code: 'PGRST116', message: 'no rows' },
                count: null,
              }),
            );
          }
        }

        return Promise.resolve(resolve({ ...result, data }));
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
      }
    };

    return chain;
  };

  const from = (table: string) => ({
    select: (columns?: string, options?: Record<string, unknown>) => {
      const call: RecordedCall = {
        table,
        op: 'select',
        payload: null,
        filters: [],
        columns,
        head: options?.head === true,
        count: options?.count as string | undefined,
      };
      calls.push(call);

      return builder(call);
    },
    insert: (payload: unknown) => {
      const call: RecordedCall = { table, op: 'insert', payload, filters: [] };
      calls.push(call);

      return builder(call);
    },
    update: (payload: unknown) => {
      const call: RecordedCall = { table, op: 'update', payload, filters: [] };
      calls.push(call);

      return builder(call);
    },
    upsert: (payload: unknown) => {
      const call: RecordedCall = { table, op: 'upsert', payload, filters: [] };
      calls.push(call);

      return builder(call);
    },
    delete: () => {
      const call: RecordedCall = {
        table,
        op: 'delete',
        payload: null,
        filters: [],
      };
      calls.push(call);

      return builder(call);
    },
  });

  const rpc = (name: string, args: unknown) => {
    const call: RecordedCall = {
      table: name,
      op: 'rpc',
      payload: args,
      filters: [],
    };
    calls.push(call);

    return builder(call);
  };

  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    calls,
    tables: () =>
      calls.map((call) =>
        call.op === 'rpc' ? `rpc:${call.table}` : call.table,
      ),
  };
}

export function fakeContext(client: SupabaseClient<Database>) {
  return {
    principal: {
      userId: '11111111-1111-4111-8111-111111111111',
      accountId: '22222222-2222-4222-8222-222222222222',
      connectionId: '33333333-3333-4333-8333-333333333333',
      scopes: ['studio:read' as const, 'studio:write' as const],
      clientName: 'test',
      supabase: client,
    },
    accountId: '22222222-2222-4222-8222-222222222222',
    accountSlug: 'team-a',
    requestId: 'req-1',
    setRunId() {},
  };
}
