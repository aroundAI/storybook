import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

/**
 * The contract test (FILM-1904): the SDK's own client, over Streamable HTTP,
 * against a running StoryBook with a personal access token. Lists the tools
 * and calls whoami; checks the 401 shape without a token.
 *
 *   MCP_CONTRACT_URL=http://localhost:3201/api/mcp \
 *   MCP_CONTRACT_TOKEN=sbk_pat_… pnpm --filter @kit/studio-mcp test contract
 *
 * Skipped without both variables, so the unit run needs no server. CI's
 * E2E job runs it through `apps/e2e/tests/mcp/connected-apps.spec.ts`,
 * which creates the token it uses.
 */
const URL_ = process.env.MCP_CONTRACT_URL;
const TOKEN = process.env.MCP_CONTRACT_TOKEN;

describe.skipIf(!URL_ || !TOKEN)(
  'the MCP endpoint, through the SDK client',
  () => {
    const url = new URL(URL_ ?? 'http://localhost/');

    async function connect(token = TOKEN) {
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: 'contract-test', version: '0' });
      await client.connect(transport);

      return client;
    }

    it('initializes, lists tools with annotations, and whoami answers', async () => {
      const client = await connect();

      const { tools } = await client.listTools();
      const whoami = tools.find((tool) => tool.name === 'whoami');

      expect(whoami).toBeDefined();
      expect(whoami?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });

      const result = await client.callTool({ name: 'whoami', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        user: { id: expect.any(String) },
        team: { id: expect.any(String), slug: expect.any(String) },
        connection: { scopes: expect.any(Array) },
        mode: { generation: 'external' },
      });

      await client.close();
    });

    it('a wrong team slug is FORBIDDEN in the error contract', async () => {
      const client = await connect();
      const result = await client.callTool({
        name: 'whoami',
        arguments: { account: 'not-this-team' },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'FORBIDDEN',
        retryable: false,
      });

      await client.close();
    });

    it('no token: 401 with WWW-Authenticate naming the protected-resource metadata', async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(
        /^Bearer resource_metadata=".+\/\.well-known\/oauth-protected-resource"$/,
      );
      expect(await response.json()).toMatchObject({
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('GET and DELETE are 405', async () => {
      for (const method of ['GET', 'DELETE']) {
        const response = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${TOKEN}` },
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toContain('POST');
      }
    });
  },
);
