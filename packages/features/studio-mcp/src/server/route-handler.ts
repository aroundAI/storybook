import 'server-only';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

import { createCacheClient } from '@kit/cache';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import type { McpToolDefinition } from '../registry';
import { describeRequestForLog, recordToolCall } from './audit';
import { type ToolRuntime, buildMcpServer } from './build-server';
import { createMcpJwtSigner } from './jwt';
import { collectNodeResponse, toNodeRequest } from './node-adapter';
import { createOwnTokenVerifier } from './own-verifier';
import type { McpPromptDefinition } from './prompts';
import { rateLimitsFromEnv } from './rate-limit';
import { defaultTools } from './tools';
import { createUserScopedClient } from './user-client';
import { type McpAuthDeps, withMcpAuth } from './with-mcp-auth';

export interface McpRouteOptions {
  tools?: McpToolDefinition[];
  /** Prompts beside the tools; defaults to the workflow guide. */
  prompts?: McpPromptDefinition[];
  auth?: () => McpAuthDeps;
  runtime?: () => ToolRuntime;
  /** Origins allowed to call from a browser; defaults to MCP_ALLOWED_ORIGINS or https://claude.ai. */
  allowedOrigins?: string[];
  /** How long one request may take before the handler answers 504. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 55_000;

/**
 * The `/api/mcp` handlers (EDD "4. Transport and endpoint"): POST carries
 * JSON-RPC over Streamable HTTP in stateless mode with JSON responses, so
 * any instance answers any call; GET and DELETE are 405 because there is no
 * SSE stream and no session to end. A missing or refused token gets a 401
 * with `WWW-Authenticate` pointing at the protected-resource metadata
 * (served by FILM-1907).
 */
export function createMcpRouteHandlers(options: McpRouteOptions = {}) {
  const allowedOrigins = options.allowedOrigins ?? allowedOriginsFromEnv();
  const tools = options.tools ?? defaultTools;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const withCors = (response: Response, request: Request) => {
    const origin = request.headers.get('origin');

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set(
        'Access-Control-Expose-Headers',
        'WWW-Authenticate, Mcp-Session-Id',
      );
    }

    return response;
  };

  async function POST(request: Request) {
    const requestId = randomUUID();

    const auth = await withMcpAuth(
      request,
      (options.auth ?? defaultAuthDeps)(),
    );

    if (!auth.ok) {
      const body = auth.error.toBody();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (auth.status === 401) {
        headers['WWW-Authenticate'] =
          `Bearer resource_metadata="${siteOrigin(request)}/.well-known/oauth-protected-resource"`;
      }

      console.info('[studio-mcp] refused', {
        requestId,
        status: auth.status,
        code: body.code,
        ...describeRequestForLog(request),
      });

      return withCors(
        new Response(JSON.stringify({ error: body }), {
          status: auth.status,
          headers,
        }),
        request,
      );
    }

    const raw = await request.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return withCors(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
        request,
      );
    }

    const server = buildMcpServer(
      auth.principal,
      tools,
      (options.runtime ?? defaultRuntime)(),
      requestId,
      options.prompts,
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    const { res, response } = collectNodeResponse();
    const timeout = new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Request timed out' },
                id: null,
              }),
              { status: 504, headers: { 'Content-Type': 'application/json' } },
            ),
          ),
        timeoutMs,
      ).unref(),
    );

    try {
      await transport.handleRequest(toNodeRequest(request, raw), res, parsed);
      const out = await Promise.race([response, timeout]);
      out.headers.set('X-Request-Id', requestId);

      return withCors(out, request);
    } finally {
      await transport.close();
      await server.close();
    }
  }

  const methodNotAllowed = (request: Request) =>
    withCors(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Method not allowed. This server is stateless: POST JSON-RPC to this URL.',
          },
          id: null,
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            Allow: 'POST, OPTIONS',
          },
        },
      ),
      request,
    );

  const OPTIONS = (request: Request) =>
    withCors(
      new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
          'Access-Control-Max-Age': '86400',
        },
      }),
      request,
    );

  return { POST, GET: methodNotAllowed, DELETE: methodNotAllowed, OPTIONS };
}

function defaultAuthDeps(): McpAuthDeps {
  const admin = getSupabaseServerAdminClient();

  return {
    verifier: createOwnTokenVerifier(admin),
    signer: createMcpJwtSigner(),
    createUserClient: createUserScopedClient,
    async touchConnection(connectionId) {
      const { error } = await admin
        .from('mcp_connections')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', connectionId);

      if (error) throw new Error(error.message);
    },
  };
}

function defaultRuntime(): ToolRuntime {
  const admin = getSupabaseServerAdminClient();

  return {
    cache: createCacheClient(),
    limits: rateLimitsFromEnv(),
    recordToolCall: (record) => recordToolCall(admin, record),
    logInternalError(error, tool, requestId) {
      console.error('[studio-mcp] tool failed', { tool, requestId, error });
    },
  };
}

function allowedOriginsFromEnv() {
  const raw = process.env.MCP_ALLOWED_ORIGINS;

  return raw
    ? raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : ['https://claude.ai'];
}

/** The public origin, for the metadata URL: the configured site URL, else the request's. */
function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request's origin
    }
  }

  return new URL(request.url).origin;
}
