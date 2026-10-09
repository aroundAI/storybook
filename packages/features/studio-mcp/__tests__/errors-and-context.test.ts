import { describe, expect, it } from 'vitest';

import {
  MCP_ERROR_CODES,
  McpToolError,
  defineTool,
  getMcpRequestContext,
  isMcpRequest,
  requireMcpRequestContext,
  runWithMcpRequestContext,
  toMcpToolError,
} from '../src';
import type { McpPrincipal } from '../src';

const principal = {
  userId: 'u',
  accountId: 'a',
  connectionId: 'c',
  scopes: ['studio:read'],
  clientName: 'x',
  supabase: {},
} as unknown as McpPrincipal;

describe('the error contract', () => {
  it('names the ten codes the specs list (MISSING_INPUTS: FILM-2204)', () => {
    expect([...MCP_ERROR_CODES]).toEqual([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'MISSING_INPUTS',
      'RUN_IN_PROGRESS',
      'TARGET_CHANGED',
      'RUN_EXPIRED',
      'RATE_LIMITED',
      'INTERNAL',
    ]);
  });

  it('a tool error becomes isError with {code, message, retryable, details}', () => {
    const error = new McpToolError('RATE_LIMITED', 'Too many calls', {
      details: { retry_after_s: 17 },
    });

    expect(error.toCallToolResult()).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'RATE_LIMITED: Too many calls' }],
      structuredContent: {
        code: 'RATE_LIMITED',
        message: 'Too many calls',
        retryable: true,
        details: { retry_after_s: 17 },
      },
    });
  });

  it('retryable follows the code unless overridden', () => {
    expect(new McpToolError('FORBIDDEN', 'no').retryable).toBe(false);
    expect(new McpToolError('RUN_IN_PROGRESS', 'wait').retryable).toBe(true);
    expect(
      new McpToolError('NOT_FOUND', 'gone', { retryable: true }).retryable,
    ).toBe(true);
  });

  it('an unexpected error becomes INTERNAL without its message', () => {
    const internal = toMcpToolError(new Error('ECONNREFUSED 10.0.0.1:5432'));

    expect(internal.code).toBe('INTERNAL');
    expect(internal.message).not.toContain('ECONNREFUSED');
    expect(internal.retryable).toBe(true);
  });

  it('a contract error passes through toMcpToolError unchanged', () => {
    const original = new McpToolError('NOT_FOUND', 'No such episode');

    expect(toMcpToolError(original)).toBe(original);
  });
});

describe('the request context', () => {
  it('is absent outside an MCP request', () => {
    expect(getMcpRequestContext()).toBeUndefined();
    expect(isMcpRequest()).toBe(false);
    expect(() => requireMcpRequestContext()).toThrow(
      /Not inside an MCP request/,
    );
  });

  it('fixes mode to external and survives awaits', async () => {
    const seen = await runWithMcpRequestContext(
      { principal, toolName: 'whoami', requestId: 'r1' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return requireMcpRequestContext();
      },
    );

    expect(seen.mode).toBe('external');
    expect(seen.toolName).toBe('whoami');
    expect(seen.principal).toBe(principal);
    expect(getMcpRequestContext()).toBeUndefined();
  });

  it('mode cannot be supplied by the caller', () => {
    const context = runWithMcpRequestContext(
      // @ts-expect-error mode is not an input
      { principal, toolName: null, requestId: 'r2', mode: 'server' },
      () => requireMcpRequestContext(),
    );

    expect(context.mode).toBe('external');
  });
});

describe('defineTool', () => {
  it('refuses a tool that declares the reserved "account" argument', () => {
    expect(() =>
      defineTool({
        name: 'bad',
        title: 'Bad',
        description: 'x',
        inputSchema: { account: {} as never },
        scope: 'studio:read',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        handler: async () => ({ structuredContent: {} }),
      }),
    ).toThrow(/"account" is added to every tool/);
  });
});
