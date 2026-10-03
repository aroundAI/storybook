import { AsyncLocalStorage } from 'node:async_hooks';

import type { McpPrincipal } from './principal';

/**
 * What every piece of code running inside an MCP tool call can learn about
 * the call, without being handed it (FILM-1904; read by FILM-1903's
 * `openRun`).
 *
 * `mode` is fixed to `'external'` here and is not a field a caller can set:
 * a generation run opened from an MCP request is always written by the
 * connected client, never by the server's own model. The web app runs
 * outside this context, so `getMcpRequestContext()` is `undefined` there
 * and `openRun` falls back to the team's default mode.
 *
 * Deliberately free of `server-only` and Next imports: the Lambda worker
 * bundles packages that may import this to ask "am I inside MCP?".
 */
export interface McpRequestContext {
  readonly mode: 'external';
  readonly principal: McpPrincipal;
  /** The tool being called, once the registry knows it. */
  readonly toolName: string | null;
  /** Correlates the audit row, the log line and an error reported by a client. */
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpRequestContext<T>(
  context: Omit<McpRequestContext, 'mode'>,
  fn: () => T,
): T {
  return storage.run({ ...context, mode: 'external' }, fn);
}

export function getMcpRequestContext(): McpRequestContext | undefined {
  return storage.getStore();
}

export function requireMcpRequestContext(): McpRequestContext {
  const context = storage.getStore();

  if (!context) {
    throw new Error('Not inside an MCP request');
  }

  return context;
}

export function isMcpRequest() {
  return storage.getStore() !== undefined;
}
