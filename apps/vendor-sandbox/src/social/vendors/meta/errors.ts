import type http from 'node:http';

import { sendJson } from '../../../http';
import { bearerOf } from '../../oauth';
import type { SocialState, SocialToken } from '../../state';

/**
 * The Graph API's error envelope
 * (https://developers.facebook.com/docs/graph-api/guides/error-handling/):
 * `{ error: { message, type, code, error_subcode?, fbtrace_id } }`. The app
 * reads `error` and its `message` and `code`.
 */
export function graphError(
  code: number,
  message: string,
  type = 'OAuthException',
  subcode?: number,
) {
  return {
    error: {
      message,
      type,
      code,
      ...(subcode === undefined ? {} : { error_subcode: subcode }),
      fbtrace_id: 'SandboxTrace',
    },
  };
}

/** Code 190: invalid, expired or revoked token. */
export const INVALID_TOKEN = graphError(
  190,
  'Invalid OAuth access token - Cannot parse access token',
);

/** Code 10: the token lacks a permission the call needs. */
export const MISSING_PERMISSION = graphError(
  10,
  '(#10) Application does not have permission for this action',
);

export function metaFailure(status: number) {
  if (status === 429) {
    // Meta answers rate limiting with 400 and code 4 (app) / 17 (user) /
    // 32 (page) / 80002 (Instagram); the app reads the code.
    return {
      status: 400,
      body: graphError(
        4,
        '(#4) Application request limit reached',
        'OAuthException',
      ),
    };
  }
  if (status === 401) return { status: 400, body: INVALID_TOKEN };
  return {
    status,
    body: graphError(
      status >= 500 ? 2 : 100,
      status >= 500
        ? 'An unexpected error has occurred. Please retry your request later.'
        : 'Invalid parameter',
      status >= 500 ? 'OAuthException' : 'GraphMethodException',
    ),
  };
}

/**
 * The token a Graph call carries: `access_token` in the query, as the app
 * sends it, or a Bearer header. Answers the call itself when there is none
 * or it lacks every one of `anyOf`.
 */
export function metaAuthorize(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  social: SocialState,
  anyOf: readonly string[] = [],
): SocialToken | null {
  const value = url.searchParams.get('access_token') ?? bearerOf(req);
  const check = value ? social.checkToken(value) : null;

  if (!check || !check.ok || check.token.kind !== 'access') {
    sendJson(res, 400, INVALID_TOKEN);
    return null;
  }
  if (anyOf.length > 0 && !anyOf.some((s) => check.token.scopes.includes(s))) {
    sendJson(res, 403, MISSING_PERMISSION);
    return null;
  }
  return check.token;
}

/** `/v23.0/me/accounts` → `/me/accounts`; any documented version path. */
export function graphPath(pathname: string) {
  const match = /^\/v\d+\.\d+(\/.*)$/.exec(pathname);
  return match ? match[1] : null;
}
