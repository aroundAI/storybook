import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

/**
 * Credentials the `own` authorization server issues. All are opaque random
 * strings with a prefix that says what they are; the database holds only
 * their SHA-256 hashes (`mcp_tokens.token_hash`), so a leaked table yields
 * nothing usable and a presented token is looked up by hashing it.
 */
export const PAT_PREFIX = 'sbk_pat_';

/** 32 random bytes, base64url: 43 characters after the prefix. */
const OWN_TOKEN_SHAPE = /^sbk_(?:pat|at|rt)_[A-Za-z0-9_-]{43}$/;

/** The two that may be sent as `Authorization: Bearer`; a refresh token may not. */
const BEARER_TOKEN_SHAPE = /^sbk_(?:pat|at)_[A-Za-z0-9_-]{43}$/;

export function generatePersonalAccessToken() {
  return `${PAT_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Whether a presented string is even a token of ours, before any lookup. */
export function isOwnTokenShape(token: string) {
  return OWN_TOKEN_SHAPE.test(token);
}

/** Whether a presented string is a credential the MCP endpoint accepts. */
export function isBearerTokenShape(token: string) {
  return BEARER_TOKEN_SHAPE.test(token);
}

/**
 * The value of an `Authorization` header, as a token. `null` when the
 * header is missing or not a bearer scheme.
 */
export function bearerToken(request: Request) {
  const header = request.headers.get('authorization');

  if (!header) return null;

  const [scheme, value, ...rest] = header.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value || rest.length) {
    return null;
  }

  return value;
}
