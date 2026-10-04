export type GatewayErrorCode =
  /** A model call for a run that is not an open server-mode run */
  | 'LLM_FORBIDDEN_EXTERNAL_RUN'
  /** A model call with no run at all: nothing outside a run reaches a model */
  | 'LLM_NO_RUN'
  /** Server mode on a deployment that holds no key to any model (FILM-1911) */
  | 'LLM_NOT_CONFIGURED'
  /** A server run for a team past its daily LLM spend cap (2026-10-03) */
  | 'DAILY_SPEND_CAP_REACHED';

/**
 * The gateway's refusal, thrown before any model call. `code` is what the
 * worker and the tests branch on.
 */
export class GatewayError extends Error {
  override readonly name = 'GatewayError';

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly runId?: string,
  ) {
    super(message);
  }
}

export function isGatewayError(
  error: unknown,
  code?: GatewayErrorCode,
): error is GatewayError {
  return (
    error instanceof GatewayError && (code === undefined || error.code === code)
  );
}
