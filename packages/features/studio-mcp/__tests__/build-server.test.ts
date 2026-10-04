import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MemoryCache } from '@kit/cache';

import { type McpPrincipal, McpToolError, defineTool } from '../src';
import { getMcpRequestContext } from '../src/request-context';
import { type ToolRuntime, buildMcpServer } from '../src/server/build-server';
import { whoamiTool } from '../src/server/tools/whoami';

/**
 * The per-request server, driven through the SDK's own client over an
 * in-memory transport: tool listing with annotations, the error contract
 * on the wire, scope and team checks, the request context a handler sees,
 * and the audit row every call leaves.
 */

const TEAM = { id: 'a1', slug: 'acme', name: 'Acme' };
const USER = { id: 'u1', name: 'Ada', email: 'ada@acme.test' };

function supabaseStub(options: { teamVisible?: boolean } = {}) {
  const rows: Record<string, unknown> = {
    a1: options.teamVisible === false ? null : TEAM,
    u1: USER,
  };

  return {
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: rows[id] ?? null, error: null }),
        }),
      }),
    }),
  } as unknown as McpPrincipal['supabase'];
}

function principalWith(
  scopes: McpPrincipal['scopes'],
  supabase = supabaseStub(),
): McpPrincipal {
  return {
    userId: 'u1',
    accountId: 'a1',
    connectionId: 'c1',
    scopes,
    clientName: 'laptop',
    supabase,
  };
}

const echoTool = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'Returns its input and what the request context says.',
  inputSchema: { text: z.string() },
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const seen = getMcpRequestContext();
    context.setRunId('run-42');

    return {
      structuredContent: {
        text: input.text,
        accountSlug: context.accountSlug,
        mode: seen?.mode ?? null,
        toolName: seen?.toolName ?? null,
      },
    };
  },
});

const failingTool = defineTool({
  name: 'fail',
  title: 'Fail',
  description: 'Throws.',
  inputSchema: { how: z.enum(['contract', 'crash']) },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input) {
    if (input.how === 'contract') {
      throw new McpToolError('NOT_FOUND', 'No such episode', {
        details: { episodeId: 'e9' },
      });
    }

    throw new Error('ECONNREFUSED database');
  },
});

async function connect(
  principal: McpPrincipal,
  runtime?: Partial<ToolRuntime>,
) {
  const records: Parameters<ToolRuntime['recordToolCall']>[0][] = [];
  const cache = new MemoryCache();
  const full: ToolRuntime = {
    cache,
    limits: { callsPerMinute: 120, writesPerMinute: 20 },
    recordToolCall: async (record) => {
      records.push(record);
    },
    logInternalError: vi.fn(),
    ...runtime,
  };

  const server = buildMcpServer(
    principal,
    [whoamiTool, echoTool, failingTool] as never,
    full,
    'req-1',
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);

  return {
    client,
    records,
    runtime: full,
    close: async () => {
      await client.close();
      await server.close();
      cache.destroy();
    },
  };
}

describe('buildMcpServer', () => {
  it('lists tools with their annotations and the registry-added account argument', async () => {
    const { client, close } = await connect(principalWith(['studio:read']));
    const { tools } = await client.listTools();

    const whoami = tools.find((tool) => tool.name === 'whoami');
    expect(whoami?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(whoami?.inputSchema.properties).toHaveProperty('account');

    const echo = tools.find((tool) => tool.name === 'echo');
    expect(echo?.annotations?.readOnlyHint).toBe(false);
    expect(Object.keys(echo?.inputSchema.properties ?? {}).sort()).toEqual([
      'account',
      'text',
    ]);
    await close();
  });

  it('whoami answers user, team, scopes and the external mode, and leaves an ok audit row', async () => {
    const { client, records, close } = await connect(
      principalWith(['studio:read']),
    );
    const result = await client.callTool({ name: 'whoami', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      user: USER,
      team: TEAM,
      connection: { id: 'c1', clientName: 'laptop', scopes: ['studio:read'] },
      mode: {
        generation: 'external',
        canRead: true,
        canWrite: false,
        canRender: false,
      },
    });
    expect(records).toEqual([
      expect.objectContaining({
        tool: 'whoami',
        status: 'ok',
        errorCode: null,
        connectionId: 'c1',
        accountId: 'a1',
        userId: 'u1',
      }),
    ]);
    expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);
    await close();
  });

  it('a handler runs inside the request context with mode external, and may tag the run id', async () => {
    const { client, records, close } = await connect(
      principalWith(['studio:write']),
    );
    const result = await client.callTool({
      name: 'echo',
      arguments: { text: 'hi', account: 'acme' },
    });

    expect(result.structuredContent).toEqual({
      text: 'hi',
      accountSlug: 'acme',
      mode: 'external',
      toolName: 'echo',
    });
    expect(records[0]).toMatchObject({
      tool: 'echo',
      runId: 'run-42',
      status: 'ok',
    });
    await close();
  });

  it('a tool the connection lacks the scope for is FORBIDDEN', async () => {
    const { client, records, close } = await connect(
      principalWith(['studio:read']),
    );
    const result = await client.callTool({
      name: 'echo',
      arguments: { text: 'x' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: 'FORBIDDEN',
      message: 'This connection does not hold the studio:write scope.',
      retryable: false,
      details: { required_scope: 'studio:write', scopes: ['studio:read'] },
    });
    expect(records[0]).toMatchObject({
      status: 'error',
      errorCode: 'FORBIDDEN',
    });
    await close();
  });

  it('an account slug for another team is FORBIDDEN: a token is bound to one team', async () => {
    const { client, close } = await connect(principalWith(['studio:read']));
    const result = await client.callTool({
      name: 'whoami',
      arguments: { account: 'other-team' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'FORBIDDEN',
      details: { bound_account: 'acme', requested_account: 'other-team' },
    });
    await close();
  });

  it('a team the user can no longer see is FORBIDDEN on every call', async () => {
    const { client, close } = await connect(
      principalWith(['studio:read'], supabaseStub({ teamVisible: false })),
    );
    const result = await client.callTool({ name: 'whoami', arguments: {} });

    expect(result.structuredContent).toMatchObject({ code: 'FORBIDDEN' });
    await close();
  });

  it('a contract error reaches the client as isError with its details; a crash is INTERNAL without them', async () => {
    const logInternalError = vi.fn();
    const { client, records, close } = await connect(
      principalWith(['studio:read']),
      {
        logInternalError,
      },
    );

    const contract = await client.callTool({
      name: 'fail',
      arguments: { how: 'contract' },
    });
    expect(contract.isError).toBe(true);
    expect(contract.structuredContent).toEqual({
      code: 'NOT_FOUND',
      message: 'No such episode',
      retryable: false,
      details: { episodeId: 'e9' },
    });

    const crash = await client.callTool({
      name: 'fail',
      arguments: { how: 'crash' },
    });
    expect(crash.isError).toBe(true);
    expect(crash.structuredContent).toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
    expect(JSON.stringify(crash)).not.toContain('ECONNREFUSED');
    expect(logInternalError).toHaveBeenCalledWith(
      expect.any(Error),
      'fail',
      'req-1',
    );
    expect(records.map((r) => r.errorCode)).toEqual(['NOT_FOUND', 'INTERNAL']);
    await close();
  });

  it('over the limit returns RATE_LIMITED with retry_after_s', async () => {
    const { client, close } = await connect(principalWith(['studio:read']), {
      limits: { callsPerMinute: 2, writesPerMinute: 1 },
    });

    await client.callTool({ name: 'whoami', arguments: {} });
    await client.callTool({ name: 'whoami', arguments: {} });
    const third = await client.callTool({ name: 'whoami', arguments: {} });

    expect(third.isError).toBe(true);
    expect(third.structuredContent).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      details: { limit: 'connection_calls', retry_after_s: expect.any(Number) },
    });
    const retryAfter = (
      third.structuredContent as { details: { retry_after_s: number } }
    ).details.retry_after_s;
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    await close();
  });
});
