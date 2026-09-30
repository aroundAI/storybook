import type http from 'node:http';

import { sendJson } from '../../../http';
import { bearerOf } from '../../oauth';
import type { SocialState, SocialToken } from '../../state';

/**
 * LinkedIn's error body
 * (https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling):
 * `message`, `serviceErrorCode` and `status`, with a `code` on the errors the
 * Posts and Videos pages name (`ACCESS_DENIED`, `NOT_FOUND`, …).
 */
export function linkedInError(
  status: number,
  message: string,
  extra: { serviceErrorCode?: number; code?: string } = {},
) {
  return {
    message,
    serviceErrorCode: extra.serviceErrorCode ?? status,
    status,
    ...(extra.code ? { code: extra.code } : {}),
  };
}

/**
 * The three 401s the error page names. Its own sample carries the status as
 * `serviceErrorCode`; the specific codes here are LinkedIn's usual ones and
 * are recorded as inferred in the capability reference.
 */
export const EMPTY_TOKEN = linkedInError(401, 'Empty oauth2_access_token');
export const INVALID_TOKEN = linkedInError(401, 'Invalid access token', {
  serviceErrorCode: 65600,
});
export const REVOKED_TOKEN = linkedInError(
  401,
  'The token used in the request has been revoked by the user',
  { serviceErrorCode: 65601 },
);
export const EXPIRED_TOKEN = linkedInError(
  401,
  'The token used in the request has expired',
  { serviceErrorCode: 65604 },
);

export function accessDenied(resource: string, method: string) {
  return linkedInError(
    403,
    `Not enough permissions to access: ${resource}.${method}.NO_VERSION`,
    { serviceErrorCode: 100, code: 'ACCESS_DENIED' },
  );
}

export function notFound(message = 'Could not find entity') {
  return linkedInError(404, message, { code: 'NOT_FOUND' });
}

export function badRequest(code: string, message: string) {
  return linkedInError(400, message, { code });
}

/** An injected failure (`/__sandbox/fail`), shaped as LinkedIn shapes it. */
export function linkedInFailure(status: number) {
  if (status === 401) return { status, body: INVALID_TOKEN };
  if (status === 429) {
    return {
      status,
      body: linkedInError(
        429,
        'Resource level throttle limit for calls to this resource is reached.',
        { code: 'TOO_MANY_REQUESTS' },
      ),
    };
  }
  return {
    status,
    body:
      status >= 500
        ? linkedInError(status, 'Internal Server Error', {
            code: 'INTERNAL_SERVER_ERROR',
          })
        : badRequest('INVALID_VALUE_FOR_FIELD', 'Bad Request'),
  };
}

export const SCOPE = {
  openid: 'openid',
  profile: 'profile',
  email: 'email',
  writeMember: 'w_member_social',
  readMember: 'r_member_social',
  readOrganization: 'r_organization_social',
  writeOrganization: 'w_organization_social',
} as const;

export const KNOWN_SCOPES: readonly string[] = [
  ...Object.values(SCOPE),
  'r_liteprofile',
  'r_emailaddress',
];

/**
 * The request's token, if it holds every scope in `required` (or, when
 * `anyOf` is given, at least one of them). Otherwise answers with
 * LinkedIn's 401 or 403 and returns null.
 */
export function authorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  social: SocialState,
  needs: {
    resource: string;
    method: string;
    all?: readonly string[];
    anyOf?: readonly string[];
  },
): SocialToken | null {
  const value = bearerOf(req);
  if (!value) {
    sendJson(res, 401, EMPTY_TOKEN);
    return null;
  }
  const check = social.checkToken(value);
  if (!check.ok) {
    sendJson(
      res,
      401,
      check.reason === 'revoked'
        ? REVOKED_TOKEN
        : check.reason === 'expired'
          ? EXPIRED_TOKEN
          : INVALID_TOKEN,
    );
    return null;
  }
  const { token } = check;
  if (token.kind !== 'access' || token.platform !== 'linkedin') {
    sendJson(res, 401, INVALID_TOKEN);
    return null;
  }
  const hasAll = (needs.all ?? []).every((s) => token.scopes.includes(s));
  const hasAny =
    !needs.anyOf || needs.anyOf.some((s) => token.scopes.includes(s));
  if (!hasAll || !hasAny) {
    sendJson(res, 403, accessDenied(needs.resource, needs.method));
    return null;
  }
  return token;
}

export function personUrn(accountId: string) {
  return `urn:li:person:${accountId}`;
}
