import 'server-only';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { CacheClient } from '@kit/cache';

import { McpToolError, toMcpToolError } from '../errors';
import type { McpPrincipal } from '../principal';
import {
  type McpToolContext,
  type McpToolDefinition,
  isWriteTool,
} from '../registry';
import { runWithMcpRequestContext } from '../request-context';
import { hasScope } from '../scopes';
import type { ToolCallRecord } from './audit';
import { type McpPromptDefinition, defaultPrompts } from './prompts';
import { type RateLimits, checkRateLimits } from './rate-limit';

export interface ToolRuntime {
  cache: CacheClient;
  limits: RateLimits;
  recordToolCall: (record: ToolCallRecord) => Promise<void>;
  /** For the one error class whose detail is not shown to the client. */
  logInternalError: (error: unknown, tool: string, requestId: string) => void;
}

export const SERVER_INFO = { name: 'storybook', version: '1.0.0' } as const;

const ACCOUNT_ARG = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Team slug. Optional; when given it must be the team this connection is bound to (whoami lists it).',
  );

/**
 * A fresh server for one request, with every tool wrapped in the runtime
 * rules: rate limits, scope, team membership, the request context that
 * fixes generation mode, the error contract, and the audit row. Nothing is
 * kept between requests.
 */
export function buildMcpServer(
  principal: McpPrincipal,
  tools: McpToolDefinition[],
  runtime: ToolRuntime,
  requestId: string,
  prompts: McpPromptDefinition[] = defaultPrompts,
) {
  const server = new McpServer(SERVER_INFO);

  // Prompts carry no data of the caller's and no scope: today only the
  // workflow guide (FILM-1905), the same text get_workflow_guide returns.
  for (const prompt of prompts) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description },
      () => ({ messages: prompt.messages({}) }),
    );
  }

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: { ...tool.inputSchema, account: ACCOUNT_ARG },
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args) =>
        runTool(
          tool,
          args as Record<string, unknown>,
          principal,
          runtime,
          requestId,
        ),
    );
  }

  return server;
}

async function runTool(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
  principal: McpPrincipal,
  runtime: ToolRuntime,
  requestId: string,
): Promise<CallToolResult> {
  const started = performance.now();
  let runId: string | null = null;
  let errorCode: ToolCallRecord['errorCode'] = null;

  try {
    const decision = await checkRateLimits(runtime.cache, {
      connectionId: principal.connectionId,
      accountId: principal.accountId,
      isWrite: isWriteTool(tool),
      limits: runtime.limits,
    });

    if (!decision.allowed) {
      throw new McpToolError(
        'RATE_LIMITED',
        `Too many calls; retry in ${decision.retryAfterS}s.`,
        {
          details: {
            retry_after_s: decision.retryAfterS,
            limit: decision.limit,
          },
        },
      );
    }

    if (tool.scope && !hasScope(principal.scopes, tool.scope)) {
      throw new McpToolError(
        'FORBIDDEN',
        `This connection does not hold the ${tool.scope} scope.`,
        { details: { required_scope: tool.scope, scopes: principal.scopes } },
      );
    }

    const { account, ...input } = args;
    const team = await resolveTeam(principal, account as string | undefined);

    const context: McpToolContext = {
      principal,
      accountId: team.id,
      accountSlug: team.slug,
      requestId,
      setRunId(id) {
        runId = id;
      },
    };

    const result = await runWithMcpRequestContext(
      { principal, toolName: tool.name, requestId },
      () => tool.handler(input, context),
    );

    return {
      content: [
        {
          type: 'text',
          text:
            result.text ?? JSON.stringify(result.structuredContent, null, 2),
        },
      ],
      structuredContent: result.structuredContent,
    };
  } catch (error) {
    const toolError = toMcpToolError(error);
    errorCode = toolError.code;

    if (toolError.code === 'INTERNAL') {
      runtime.logInternalError(error, tool.name, requestId);
    }

    return toolError.toCallToolResult();
  } finally {
    await runtime.recordToolCall({
      connectionId: principal.connectionId,
      userId: principal.userId,
      accountId: principal.accountId,
      tool: tool.name,
      runId,
      status: errorCode ? 'error' : 'ok',
      errorCode,
      durationMs: performance.now() - started,
    });
  }
}

/**
 * The team a call runs in. Read as the user, so a membership that ended
 * since the token was issued leaves no row; an `account` slug that names
 * another team is refused even if the user belongs to it, because a token
 * is bound to one team.
 */
async function resolveTeam(principal: McpPrincipal, slug: string | undefined) {
  const { data, error } = await principal.supabase
    .from('accounts')
    .select('id, slug')
    .eq('id', principal.accountId)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the team.');
  }

  if (!data?.slug) {
    throw new McpToolError(
      'FORBIDDEN',
      'You are no longer a member of the team this connection is bound to.',
    );
  }

  if (slug !== undefined && slug !== data.slug) {
    throw new McpToolError(
      'FORBIDDEN',
      `This connection is bound to the team "${data.slug}", not "${slug}".`,
      { details: { bound_account: data.slug, requested_account: slug } },
    );
  }

  return { id: data.id, slug: data.slug };
}
