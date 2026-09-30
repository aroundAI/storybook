import type http from 'node:http';

import { sendJson } from '../../../http';
import { bearerOf } from '../../oauth';
import type { SocialState, SocialToken } from '../../state';

/**
 * X's problem objects
 * (https://docs.x.com/x-api/fundamentals/response-codes-and-errors): `type`,
 * `title` and `detail`, and whatever else the problem needs (`status`,
 * `errors`, `resource_id`, …).
 */
export function xProblem(
  status: number,
  title: string,
  detail: string,
  type = 'about:blank',
) {
  return { title, type, status, detail };
}

export const UNAUTHORIZED = xProblem(401, 'Unauthorized', 'Unauthorized');

/**
 * A token that lacks a scope the endpoint needs. X's own body does not say
 * which scope it wanted (the app's upload hint says as much); the wording is
 * inferred, recorded in the capability reference's ledger.
 */
export const FORBIDDEN = xProblem(403, 'Forbidden', 'Forbidden');

export function invalidRequest(message: string) {
  return {
    title: 'Invalid Request',
    detail: 'One or more parameters to your request was invalid.',
    type: 'https://api.x.com/2/problems/invalid-request',
    errors: [{ message }],
  };
}

export function notFound(id: string) {
  return {
    errors: [
      {
        value: id,
        detail: `Could not find tweet with id: [${id}].`,
        title: 'Not Found Error',
        resource_type: 'tweet',
        parameter: 'id',
        resource_id: id,
        type: 'https://api.x.com/2/problems/resource-not-found',
      },
    ],
  };
}

/** What an app not enrolled in the endpoint's tier is told (Enterprise-only endpoints). */
export const CLIENT_NOT_ENROLLED = {
  client_id: '30112233',
  detail:
    'Your client app is not configured with the appropriate access level to use this endpoint.',
  registration_url: 'https://developer.x.com/en/portal/products',
  title: 'Client Forbidden',
  required_enrollment: 'Appropriate Level of API Access',
  reason: 'client-not-enrolled',
  type: 'https://api.x.com/2/problems/client-forbidden',
  status: 403,
};

/** An injected failure (`/__sandbox/fail`), shaped as X shapes it. */
export function xFailure(status: number) {
  if (status === 401) return { status, body: UNAUTHORIZED };
  if (status === 429) {
    return {
      status,
      body: xProblem(429, 'Too Many Requests', 'Too Many Requests'),
    };
  }
  return {
    status,
    body:
      status >= 500
        ? xProblem(status, 'Internal Server Error', 'Internal Server Error')
        : xProblem(status, 'Bad Request', 'Bad Request'),
  };
}

export const SCOPE = {
  read: 'tweet.read',
  write: 'tweet.write',
  users: 'users.read',
  media: 'media.write',
  offline: 'offline.access',
} as const;

export const KNOWN_SCOPES: readonly string[] = Object.values(SCOPE);

/**
 * The request's user token, if it holds every scope in `required`. Otherwise
 * answers with X's 401 or 403 and returns null.
 */
export function authorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  social: SocialState,
  required: readonly string[],
): SocialToken | null {
  const value = bearerOf(req);
  const check = value ? social.checkToken(value) : null;

  if (
    !check ||
    !check.ok ||
    check.token.kind !== 'access' ||
    check.token.platform !== 'x'
  ) {
    sendJson(res, 401, UNAUTHORIZED);
    return null;
  }
  if (!required.every((scope) => check.token.scopes.includes(scope))) {
    sendJson(res, 403, FORBIDDEN);
    return null;
  }
  return check.token;
}
