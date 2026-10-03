/**
 * The error vocabulary of RFC 6749 §5.2 and §4.1.2.1, RFC 7591 §3.2.2 and
 * RFC 8707 §2, as the token, authorize and registration endpoints answer
 * with it. A client branches on `error`; `error_description` is for the
 * person reading the log.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'invalid_target'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri'
  | 'server_error'
  | 'temporarily_unavailable';

export class OAuthError extends Error {
  override name = 'OAuthError';
  readonly code: OAuthErrorCode;
  readonly status: number;

  constructor(code: OAuthErrorCode, description: string, status?: number) {
    super(description);
    this.code = code;
    this.status = status ?? (code === 'invalid_client' ? 401 : 400);
  }

  toBody() {
    return { error: this.code, error_description: this.message };
  }

  toResponse() {
    return Response.json(this.toBody(), {
      status: this.status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  }
}

/** Anything thrown that is not an OAuthError becomes server_error, with no detail. */
export function toOAuthError(error: unknown): OAuthError {
  if (error instanceof OAuthError) return error;

  return new OAuthError(
    'server_error',
    'The authorization server failed unexpectedly.',
    500,
  );
}
