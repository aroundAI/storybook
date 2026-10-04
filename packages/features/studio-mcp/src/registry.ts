import type { ZodRawShape, ZodTypeAny, z } from 'zod';

import type { McpPrincipal } from './principal';
import type { McpScope } from './scopes';

/**
 * MCP's tool annotations, all four required here so a tool author decides
 * each one: ChatGPT asks before any tool that is not read-only, Claude
 * before a destructive one. `openWorldHint` is true only for a tool that
 * reaches outside StoryBook (MCP reads a missing one as true).
 */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * What a handler gets besides its arguments. `accountId` is the team the
 * call runs in: the connection's team, re-checked against the caller's
 * membership on this call, and equal to the `account` slug if one was
 * given.
 */
export interface McpToolContext {
  principal: McpPrincipal;
  accountId: string;
  accountSlug: string;
  requestId: string;
  /** Attach a generation run id to this call's audit row (FILM-1903+). */
  setRunId(runId: string): void;
}

export interface McpToolResult {
  /** Shown to clients that render text; defaults to the JSON of `structuredContent`. */
  text?: string;
  structuredContent: Record<string, unknown>;
}

export interface McpToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** A Zod raw shape, as the SDK takes it; `account` is reserved for the registry. */
  inputSchema: Shape;
  /** The scope the connection must hold to call this tool; null for any connection (whoami). */
  scope: McpScope | null;
  annotations: McpToolAnnotations;
  handler: (
    input: z.objectOutputType<Shape, ZodTypeAny>,
    context: McpToolContext,
  ) => Promise<McpToolResult>;
}

/** Keeps the handler's `input` typed from `inputSchema`. */
export function defineTool<Shape extends ZodRawShape>(
  definition: McpToolDefinition<Shape>,
): McpToolDefinition<Shape> {
  if ('account' in definition.inputSchema) {
    throw new Error(
      `Tool ${definition.name}: "account" is added to every tool by the registry`,
    );
  }

  return definition;
}

/** A write for rate limiting: anything the author did not mark read-only. */
export function isWriteTool(tool: McpToolDefinition) {
  return !tool.annotations.readOnlyHint;
}
