import { createHash, randomBytes } from 'node:crypto';

import { ownerToken, timedRest } from './seed';

/**
 * Driving `/api/mcp` from a spec (FILM-1904, FILM-1906).
 *
 * A personal access token is minted through the same database function the
 * settings page calls (`create_mcp_personal_access_token`), as the seeded
 * user, so a spec about a tool does not first drive the Connected apps page;
 * `connected-apps.spec.ts` covers that page. Tool calls go over the wire as
 * JSON-RPC, which is what the SDK client sends in the stateless JSON mode
 * the endpoint speaks.
 */

const MCP_URL = () =>
  `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'}/api/mcp`;

export type McpScope =
  | 'studio:read'
  | 'studio:write'
  | 'studio:render'
  | 'studio:publish';

/** `sbk_pat_` + 32 random bytes, base64url: the shape `isOwnTokenShape` accepts. */
export async function mintPersonalAccessToken(
  user: { email: string; password: string; accountId: string },
  options: { name?: string; scopes?: McpScope[] } = {},
) {
  const token = `sbk_pat_${randomBytes(32).toString('base64url')}`;

  await timedRest(
    'POST',
    '/rest/v1/rpc/create_mcp_personal_access_token',
    await ownerToken(user),
    {
      p_account_id: user.accountId,
      p_name: options.name ?? 'spec',
      p_scopes: options.scopes ?? ['studio:read', 'studio:write'],
      p_token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
    },
  );

  return token;
}

export interface McpToolCall {
  status: number;
  isError: boolean;
  structuredContent: Record<string, unknown>;
  text: string;
}

export async function callMcpTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCall> {
  const response = await fetch(MCP_URL(), {
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
      params: { name, arguments: args },
    }),
  });

  const body = (await response.json()) as {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content?: Array<{ type: string; text?: string }>;
    };
    error?: { code: number | string; message: string };
  };

  if (!body.result) {
    throw new Error(
      `${name} returned no result (${response.status}): ${JSON.stringify(body.error)}`,
    );
  }

  return {
    status: response.status,
    isError: body.result.isError === true,
    structuredContent: body.result.structuredContent ?? {},
    text: body.result.content?.find((part) => part.type === 'text')?.text ?? '',
  };
}

export async function listMcpTools(token: string) {
  const response = await fetch(MCP_URL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  const body = (await response.json()) as {
    result?: {
      tools: Array<{
        name: string;
        annotations?: Record<string, unknown>;
        inputSchema?: { properties?: Record<string, unknown> };
      }>;
    };
  };

  return body.result?.tools ?? [];
}
