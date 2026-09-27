import type http from 'node:http';

import { sendJson } from '../../../http';
import { bearerOf } from '../../oauth';
import type { SocialState, SocialToken } from '../../state';

/**
 * Google's API error envelope (https://developers.google.com/youtube/v3/docs/errors):
 * `error.code`, `error.message`, `error.errors[]` (domain, reason, message,
 * location, locationType) and `error.status`.
 */
export function googleError(
  code: number,
  message: string,
  reason: string,
  status: string,
  extra: { location?: string; locationType?: string } = {},
) {
  return {
    error: {
      code,
      message,
      errors: [{ message, domain: 'global', reason, ...extra }],
      status,
    },
  };
}

export const UNAUTHENTICATED = googleError(
  401,
  'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
  'authError',
  'UNAUTHENTICATED',
  { location: 'Authorization', locationType: 'header' },
);

/**
 * The auth layer's refusal of a token without the scope an endpoint needs.
 * The wording is Google's usual one, not quoted from a YouTube page — the
 * capability reference records it as inferred. The app's
 * `isScopeMissingError` reads it.
 */
export const INSUFFICIENT_SCOPES = googleError(
  403,
  'Request had insufficient authentication scopes.',
  'insufficientPermissions',
  'PERMISSION_DENIED',
);

/** An injected failure (`/__sandbox/fail`), shaped as Google shapes it. */
export function googleFailure(status: number) {
  if (status === 429) {
    return {
      status: 403,
      body: googleError(
        403,
        'The request cannot be completed because you have exceeded your quota.',
        'quotaExceeded',
        'RESOURCE_EXHAUSTED',
      ),
    };
  }
  if (status === 401) return { status: 401, body: UNAUTHENTICATED };
  return {
    status,
    body: googleError(
      status,
      status >= 500 ? 'Backend Error' : 'Bad Request',
      status >= 500 ? 'backendError' : 'badRequest',
      status >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT',
    ),
  };
}

/**
 * The request's token, if it may use an endpoint authorised by any one of
 * `anyOf`. Otherwise answers with Google's 401 or 403 and returns null.
 */
export function authorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  social: SocialState,
  anyOf: readonly string[],
): SocialToken | null {
  const value = bearerOf(req);
  const check = value ? social.checkToken(value) : null;

  if (!check || !check.ok || check.token.kind !== 'access') {
    sendJson(res, 401, UNAUTHENTICATED);
    return null;
  }
  if (!anyOf.some((scope) => check.token.scopes.includes(scope))) {
    sendJson(res, 403, INSUFFICIENT_SCOPES);
    return null;
  }
  return check.token;
}

export const SCOPE = {
  upload: 'https://www.googleapis.com/auth/youtube.upload',
  readonly: 'https://www.googleapis.com/auth/youtube.readonly',
  youtube: 'https://www.googleapis.com/auth/youtube',
  forceSsl: 'https://www.googleapis.com/auth/youtube.force-ssl',
  partner: 'https://www.googleapis.com/auth/youtubepartner',
  analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  monetary: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
} as const;

/** Scopes that authorise reading a channel's own data. */
export const READ_SCOPES = [SCOPE.readonly, SCOPE.youtube, SCOPE.forceSsl, SCOPE.partner];
/** Scopes that authorise an upload. */
export const UPLOAD_SCOPES = [SCOPE.upload, SCOPE.youtube, SCOPE.forceSsl];
/** Scopes that authorise changing a playlist. */
export const MANAGE_SCOPES = [SCOPE.youtube, SCOPE.forceSsl, SCOPE.partner];
/** Scopes that authorise Analytics and Reporting. */
export const ANALYTICS_SCOPES = [SCOPE.analytics, SCOPE.monetary];
