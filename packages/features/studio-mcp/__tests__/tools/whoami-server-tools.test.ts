import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import { MemoryCache } from '@kit/cache';

import type { McpPrincipal } from '../../src';
import { buildMcpServer } from '../../src/server/build-server';
import { defaultTools } from '../../src/server/tools/index';
import { WORKFLOW_GUIDE_TEXT } from '../../src/server/tools/workflow-guide';

// A client keeps the tool list from when it connected (FILM-2213), so
// whoami, which every snapshot has, says how many tools the server lists.

const rows: Record<string, unknown> = {
  a1: { id: 'a1', slug: 'acme', name: 'Acme' },
  u1: { id: 'u1', name: 'Ada', email: 'ada@acme.test' },
};

const principal: McpPrincipal = {
  userId: 'u1',
  accountId: 'a1',
  connectionId: 'c1',
  scopes: ['studio:read'],
  clientName: 'claude.ai',
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: rows[id] ?? null, error: null }),
        }),
      }),
    }),
  } as unknown as McpPrincipal['supabase'],
};

describe('whoami: the server tool list', () => {
  it('counts every tool the server lists, so a stale client can tell', async () => {
    const cache = new MemoryCache();
    const server = buildMcpServer(
      principal,
      defaultTools,
      {
        cache,
        limits: { callsPerMinute: 120, writesPerMinute: 20 },
        recordToolCall: async () => {},
        logInternalError: vi.fn(),
      },
      'req-1',
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    const serverTools = (
      result.structuredContent as {
        serverTools: { count: number; names: string[] };
      }
    ).serverTools;
    const [first] = result.content as Array<{ type: string; text: string }>;

    expect(serverTools.count).toBe(defaultTools.length);
    expect(serverTools.count).toBe(tools.length);
    expect(serverTools.names).toEqual(tools.map((tool) => tool.name));
    expect(serverTools.names).toContain('reschedule_publish');
    expect(serverTools.names).toContain('replan_schedule');
    expect(first?.text).toBe(
      `This server has ${defaultTools.length} tools. If your tool list has fewer, disconnect and reconnect StoryBook in your client's connector settings, then start a new chat: a client keeps the tool list from when it connected.`,
    );

    await client.close();
    await server.close();
    cache.destroy();
  });

  it('the workflow guide says the same near the top', () => {
    const top = WORKFLOW_GUIDE_TEXT.split('## Orientation')[0];

    expect(top).toContain('`whoami`');
    expect(top).toContain('disconnect and reconnect StoryBook');
  });
});
