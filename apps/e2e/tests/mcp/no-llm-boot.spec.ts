import { expect, test } from '@playwright/test';

import {
  callMcpTool,
  listMcpTools,
  mintPersonalAccessToken,
} from '../utils/mcp';
import { seedProject, seedTeamAccount } from '../utils/seed';

/**
 * FILM-1911, criterion 4: a deployment that holds no key to any model still
 * starts and serves every MCP tool, because external mode needs none.
 *
 * The server is the point, so this spec only means something against one
 * started by `scripts/ci/no-llm-server.mjs`, which strips every LLM_*,
 * GEMINI_*, GOOGLE_*, VOYAGE_*, OPENAI_* and ANTHROPIC_* variable and
 * refuses to start if an env file would put one back. Gated on
 * NO_LLM_BOOT=1, which the CI step sets together with that server command:
 *
 *   NO_LLM_BOOT=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
 *   PLAYWRIGHT_SERVER_COMMAND="node scripts/ci/no-llm-server.mjs 3001" \
 *   npx playwright test mcp/no-llm-boot --project=chromium
 *
 * Every listed tool is called once with no arguments: a tool whose module or
 * handler needed a model key would answer INTERNAL (or fail the request),
 * while a working one answers, or refuses its input with a typed code.
 */

test.describe('the app with no model variables', () => {
  test.skip(
    process.env.NO_LLM_BOOT !== '1',
    'needs a server started by scripts/ci/no-llm-server.mjs',
  );

  test('starts, lists every tool, and answers each one without an internal error', async ({
    request,
  }) => {
    const health = await request.get('/healthcheck');
    expect(health.ok()).toBe(true);

    const team = await seedTeamAccount({ emailPrefix: 'no-llm' });
    const project = await seedProject(team);
    const token = await mintPersonalAccessToken(team, {
      name: 'no-llm boot',
      scopes: ['studio:read', 'studio:write'],
    });

    const tools = (await listMcpTools(token)).map((tool) => tool.name);

    expect(tools).toEqual(
      expect.arrayContaining([
        'whoami',
        'get_workflow_guide',
        'list_projects',
        'get_project',
        'get_account_overview',
      ]),
    );

    const whoami = await callMcpTool(token, 'whoami', {});
    expect(whoami.isError).toBe(false);
    expect(whoami.structuredContent).toMatchObject({
      user: { id: team.userId },
      team: { slug: team.slug },
    });

    const listed = await callMcpTool(token, 'list_projects', {});
    expect(listed.isError).toBe(false);
    expect(JSON.stringify(listed.structuredContent)).toContain(project.id);

    const failed: string[] = [];

    for (const tool of tools) {
      const outcome = await callWithNoArguments(token, tool);

      if (outcome) {
        failed.push(`${tool}: ${outcome}`);
      }
    }

    expect(failed, 'tools that failed without model keys').toEqual([]);
  });
});

const INVALID_PARAMS = -32602;

/**
 * Calls a tool with `{}` and returns why it failed, or null. A typed tool
 * error other than INTERNAL, or the SDK refusing the arguments, is a tool
 * that loaded and answered; an INTERNAL error, any other JSON-RPC error or a
 * non-200 is not.
 */
async function callWithNoArguments(token: string, name: string) {
  const response = await fetch(
    `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'}/api/mcp`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
    },
  );

  const text = await response.text();

  if (response.status !== 200) {
    return `HTTP ${response.status} ${text.slice(0, 300)}`;
  }

  const body = JSON.parse(text) as {
    result?: { isError?: boolean; structuredContent?: { code?: string } };
    error?: { code: number; message: string };
  };

  if (body.error) {
    return body.error.code === INVALID_PARAMS
      ? null
      : `JSON-RPC ${body.error.code} ${body.error.message}`;
  }

  if (
    body.result?.isError &&
    body.result.structuredContent?.code === 'INTERNAL'
  ) {
    return `INTERNAL ${text.slice(0, 300)}`;
  }

  return null;
}
