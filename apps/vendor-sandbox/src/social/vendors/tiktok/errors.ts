import type http from 'node:http';

import { sendJson } from '../../../http';
import { bearerOf } from '../../oauth';
import type { SocialState, SocialToken } from '../../state';

/**
 * TikTok's response envelope: every v2 response carries `error`, success
 * included — `{ data, error: { code: "ok", message: "", log_id } }` — and only
 * a code other than `ok` is a failure (capability reference, TikTok). The
 * human message does not contain the code.
 */
function logId(nowMs: number, suffix: string) {
  const stamp = new Date(nowMs)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  return `${stamp}${suffix}`;
}

function socialLogId(social: SocialState) {
  const hex = [...social.recordId('tiktok-log', 20)]
    .map((c) => (c.charCodeAt(0) % 16).toString(16).toUpperCase())
    .join('');
  return logId(social.now(), hex);
}

function envelope(code: string, message: string, log: string, data: unknown) {
  return { data, error: { code, message, log_id: log } };
}

export function ok(social: SocialState, data: unknown) {
  return envelope('ok', '', socialLogId(social), data);
}

export function tiktokError(
  social: SocialState,
  code: string,
  message: string,
) {
  return envelope(code, message, socialLogId(social), {});
}

export const INVALID_TOKEN_MESSAGE =
  'The access token is invalid or not found in the request.';
export const SCOPE_MESSAGE =
  'The user did not authorize the scope required for completing this request.';

/** An injected failure (`/__sandbox/fail`), shaped as TikTok shapes it. */
export function tiktokFailure(status: number) {
  const failure = (code: string, message: string) =>
    envelope(code, message, logId(Date.now(), '5A4D42005F4641494C5552'), {});
  if (status === 401) {
    return {
      status,
      body: failure('access_token_invalid', INVALID_TOKEN_MESSAGE),
    };
  }
  if (status === 429) {
    return {
      status,
      body: failure('rate_limit_exceeded', 'Too many requests.'),
    };
  }
  return {
    status,
    body:
      status >= 500
        ? failure(
            'internal_error',
            'The service encountered an unexpected error.',
          )
        : failure('invalid_params', 'The request parameters are invalid.'),
  };
}

export const SCOPE = {
  basic: 'user.info.basic',
  profile: 'user.info.profile',
  stats: 'user.info.stats',
  list: 'video.list',
  upload: 'video.upload',
  publish: 'video.publish',
} as const;

export const KNOWN_SCOPES: readonly string[] = Object.values(SCOPE);

/**
 * The request's token, if it holds one of `anyOf`. Otherwise answers with
 * TikTok's 401 — `access_token_invalid` for a token that is unknown, expired
 * or revoked, `scope_not_authorized` for one that lacks the scope — and
 * returns null.
 */
export function authorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  social: SocialState,
  anyOf: readonly string[],
): SocialToken | null {
  const value = bearerOf(req);
  const check = value ? social.checkToken(value) : null;

  if (
    !check ||
    !check.ok ||
    check.token.kind !== 'access' ||
    check.token.platform !== 'tiktok'
  ) {
    sendJson(
      res,
      401,
      tiktokError(social, 'access_token_invalid', INVALID_TOKEN_MESSAGE),
    );
    return null;
  }
  if (!anyOf.some((scope) => check.token.scopes.includes(scope))) {
    sendJson(
      res,
      401,
      tiktokError(social, 'scope_not_authorized', SCOPE_MESSAGE),
    );
    return null;
  }
  return check.token;
}
