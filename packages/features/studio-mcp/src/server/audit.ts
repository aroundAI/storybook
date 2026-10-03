import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { McpErrorCode } from '../errors';

export interface ToolCallRecord {
  connectionId: string;
  userId: string;
  accountId: string;
  tool: string;
  runId: string | null;
  status: 'ok' | 'error';
  errorCode: McpErrorCode | null;
  durationMs: number;
}

/**
 * One `mcp_tool_calls` row per call: what ran, how it ended, how long it
 * took. Never the arguments or the result. Written with the service role
 * because the table has no write policy; a failure to record is logged and
 * does not fail the call it describes.
 */
export async function recordToolCall(
  admin: SupabaseClient<Database>,
  record: ToolCallRecord,
) {
  const { error } = await admin.from('mcp_tool_calls').insert({
    connection_id: record.connectionId,
    user_id: record.userId,
    account_id: record.accountId,
    tool: record.tool,
    run_id: record.runId,
    status: record.status,
    error_code: record.errorCode,
    duration_ms: Math.max(0, Math.round(record.durationMs)),
  });

  if (error) {
    console.error('[studio-mcp] could not record tool call', {
      tool: record.tool,
      code: error.code,
      message: error.message,
    });
  }
}

const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'x-api-key',
]);

/**
 * Headers fit for a log line: every credential-bearing header's value is
 * replaced, whatever its casing, so a token can never land in a log.
 */
export function redactHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): Record<string, string> {
  const entries: Array<[string, string]> =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(', ') : (value ?? ''),
        ]);

  return Object.fromEntries(
    entries.map(([key, value]): [string, string] => {
      const name = key.toLowerCase();

      return [name, SECRET_HEADERS.has(name) ? '[redacted]' : value];
    }),
  );
}

/** What the route logs about a request: method, path and redacted headers. */
export function describeRequestForLog(request: Request) {
  const url = new URL(request.url);

  return {
    method: request.method,
    path: url.pathname,
    headers: redactHeaders(request.headers),
  };
}
