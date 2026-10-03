/**
 * The error contract every tool answers with (FILM-1904). A failure is a
 * normal tool result with `isError: true` and this shape in
 * `structuredContent`, so a client can branch on `code` and read
 * `retryable` instead of parsing prose.
 */
export const MCP_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'RUN_IN_PROGRESS',
  'TARGET_CHANGED',
  'RUN_EXPIRED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

const RETRYABLE: Record<McpErrorCode, boolean> = {
  UNAUTHORIZED: false,
  FORBIDDEN: false,
  NOT_FOUND: false,
  VALIDATION_FAILED: false,
  RUN_IN_PROGRESS: true,
  TARGET_CHANGED: false,
  RUN_EXPIRED: false,
  RATE_LIMITED: true,
  INTERNAL: true,
};

export interface McpErrorBody {
  code: McpErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class McpToolError extends Error {
  override name = 'McpToolError';
  readonly code: McpErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: McpErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryable?: boolean } = {},
  ) {
    super(message);
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE[code];
    this.details = options.details;
  }

  toBody(): McpErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  /** The tool result a client sees. */
  toCallToolResult() {
    const body = this.toBody();

    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: `${body.code}: ${body.message}` },
      ],
      structuredContent: body as unknown as Record<string, unknown>,
    };
  }
}

/**
 * Anything a handler throws that is not already a contract error becomes
 * INTERNAL, with no detail: the message of an unexpected error is for the
 * log, not the client.
 */
export function toMcpToolError(error: unknown): McpToolError {
  if (error instanceof McpToolError) return error;

  return new McpToolError(
    'INTERNAL',
    'The tool failed unexpectedly. Try again; if it keeps failing, report the request id.',
  );
}
