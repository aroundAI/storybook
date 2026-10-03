import { z } from 'zod';

import type { McpToolContext, McpToolDefinition } from '../../src/registry';

/**
 * A PostgREST-shaped in-memory client for the analytics tool tests. Every
 * filter narrows the table's rows where the column is a plain property (or
 * a dotted path into an embedded object); the terminal calls — `then`,
 * `maybeSingle`, `single`, `range`, `limit` — resolve what is left. Writes
 * record themselves and resolve empty.
 *
 * It is the same object the page's action wrapper and the MCP tool read, so
 * a test can hand both one database and compare what each returns.
 */
export type Row = Record<string, unknown>;
export type FakeDb = Record<string, Row[]>;

export interface FakeClientOptions {
  /** `rpc(name)` answers; a function is called with the arguments. */
  rpc?: Record<string, unknown | ((args: Row) => unknown)>;
}

function at(row: Row, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Row)[key] : undefined,
      row,
    );
}

export function fakeClient(db: FakeDb, options: FakeClientOptions = {}) {
  const reads: string[] = [];
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];

  function builder(table: string) {
    let rows = [...(db[table] ?? [])];
    let error: { message: string; code?: string } | null = null;

    const resolve = () => ({ data: error ? null : rows, error });

    const chain = {
      select: () => chain,
      insert: (payload: unknown) => {
        writes.push({ table, op: 'insert', payload });
        rows = Array.isArray(payload) ? (payload as Row[]) : [payload as Row];
        return chain;
      },
      upsert: (payload: unknown) => {
        writes.push({ table, op: 'upsert', payload });
        rows = [];
        return chain;
      },
      update: (payload: unknown) => {
        writes.push({ table, op: 'update', payload });
        rows = rows.map((row) => ({ ...row, ...(payload as Row) }));
        return chain;
      },
      delete: () => {
        writes.push({ table, op: 'delete', payload: null });
        rows = [];
        return chain;
      },
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => at(row, column) === value);
        return chain;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((row) => at(row, column) !== value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(at(row, column)));
        return chain;
      },
      is: (column: string, value: unknown) => {
        rows = rows.filter((row) =>
          value === null ? at(row, column) == null : at(row, column) === value,
        );
        return chain;
      },
      not: (column: string, operator: string, value: unknown) => {
        if (operator === 'is' && value === null) {
          rows = rows.filter((row) => at(row, column) != null);
        }
        return chain;
      },
      gte: (column: string, value: string | number) => {
        rows = rows.filter(
          (row) => (at(row, column) as string | number) >= value,
        );
        return chain;
      },
      gt: (column: string, value: string | number) => {
        rows = rows.filter(
          (row) => (at(row, column) as string | number) > value,
        );
        return chain;
      },
      lte: (column: string, value: string | number) => {
        rows = rows.filter(
          (row) => (at(row, column) as string | number) <= value,
        );
        return chain;
      },
      lt: (column: string, value: string | number) => {
        rows = rows.filter(
          (row) => (at(row, column) as string | number) < value,
        );
        return chain;
      },
      ilike: () => chain,
      or: () => chain,
      order: () => chain,
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return chain;
      },
      range: (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return chain;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error }),
      single: () => {
        const result = Promise.resolve(
          rows[0]
            ? { data: rows[0], error: null }
            : {
                data: null,
                error: {
                  message:
                    'JSON object requested, multiple (or no) rows returned',
                  code: 'PGRST116',
                },
              },
        );

        // PostgREST's type-only cast: `.single().overrideTypes<…>()`
        return Object.assign(result, { overrideTypes: () => result });
      },
      then: <R>(
        onfulfilled: (value: ReturnType<typeof resolve>) => R,
        onrejected?: (reason: unknown) => R,
      ) => Promise.resolve(resolve()).then(onfulfilled, onrejected),
    };

    return chain;
  }

  const client = {
    reads,
    writes,
    from: (table: string) => {
      reads.push(table);
      return builder(table);
    },
    rpc: async (name: string, args: Row = {}) => {
      const answer = options.rpc?.[name];

      return {
        data:
          typeof answer === 'function'
            ? (answer as (args: Row) => unknown)(args)
            : (answer ?? null),
        error: null,
      };
    },
  };

  return client;
}

export type FakeClient = ReturnType<typeof fakeClient>;

/** A tool context for team `accountId`, reading through `client`. */
export function contextFor(
  client: FakeClient,
  account: { id: string; slug: string },
  scopes: McpToolContext['principal']['scopes'] = [
    'studio:read',
    'studio:write',
  ],
): McpToolContext {
  return {
    principal: {
      userId: '00000000-0000-4000-8000-00000000u001',
      accountId: account.id,
      connectionId: '00000000-0000-4000-8000-00000000c001',
      scopes,
      clientName: 'test',
      supabase: client as never,
    },
    accountId: account.id,
    accountSlug: account.slug,
    requestId: 'req-1',
    setRunId() {},
  };
}

/**
 * Calls a tool as the registry would: the arguments parsed with the tool's
 * own input schema (so defaults apply), then the handler.
 */
export async function callTool(
  tools: McpToolDefinition[],
  name: string,
  args: Record<string, unknown>,
  context: McpToolContext,
) {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) throw new Error(`No tool named ${name}`);

  const input = z.object(tool.inputSchema).parse(args);

  return tool.handler(input, context);
}
