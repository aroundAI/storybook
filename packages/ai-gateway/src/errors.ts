export type GatewayErrorCode =
  /** A model call for a run that is not an open server-mode run */
  | 'LLM_FORBIDDEN_EXTERNAL_RUN'
  /** A model call with no run at all: nothing outside a run reaches a model */
  | 'LLM_NO_RUN'
  /** Server mode on a deployment that holds no key to any model (FILM-1911) */
  | 'LLM_NOT_CONFIGURED';

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

export function isGatewayError(error: unknown, code?: GatewayErrorCode) {
  return (
    error instanceof GatewayError && (code === undefined || error.code === code)
  );
}
