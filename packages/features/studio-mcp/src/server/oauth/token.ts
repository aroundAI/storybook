import { randomBytes } from 'node:crypto';

import { type McpScope, McpScopeSchema } from '../../scopes';
import { hashToken } from '../token';
import { OAuthError } from './errors';
import { verifyPkce } from './pkce';
import { resourceMatches } from './resource';
import type { OAuthStore, TokenRecord } from './store';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_TOKEN_PREFIX = 'sbk_at_';
export const REFRESH_TOKEN_PREFIX = 'sbk_rt_';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface TokenDeps {
  store: OAuthStore;
  /** The configured MCP resource URL every token is bound to. */
  resource: string;
  now?: () => Date;
}

/**
 * `POST /oauth/token`. Two grants:
 *
 * - `authorization_code`: the code is consumed (once), then checked against
 *   the client, the redirect URI, its expiry, the PKCE verifier and the
 *   resource; a connection is created and a token pair issued.
 * - `refresh_token`: the refresh token is rotated. Presenting one that was
 *   already rotated means two parties hold it, so the whole connection is
 *   revoked (OAuth 2.1 §6.1).
 *
 * Tokens are opaque random strings; the store holds their SHA-256 hashes,
 * each with the resource it was issued for (RFC 8707).
 */
export async function handleTokenRequest(
  params: URLSearchParams,
  deps: TokenDeps,
): Promise<TokenResponse> {
  const grantType = params.get('grant_type');

  switch (grantType) {
    case 'authorization_code':
      return exchangeAuthorizationCode(params, deps);
    case 'refresh_token':
      return refreshTokens(params, deps);
    default:
      throw new OAuthError(
        'unsupported_grant_type',
        'grant_type must be authorization_code or refresh_token.',
      );
  }
}

async function exchangeAuthorizationCode(
  params: URLSearchParams,
  deps: TokenDeps,
): Promise<TokenResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const code = params.get('code');
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeVerifier = params.get('code_verifier');
  const resource = params.get('resource');

  if (!code) throw new OAuthError('invalid_request', 'code is required.');
  if (!clientId)
    throw new OAuthError('invalid_request', 'client_id is required.');
  if (!codeVerifier) {
    throw new OAuthError(
      'invalid_request',
      'code_verifier is required (PKCE).',
    );
  }

  if (resource && !resourceMatches(resource, deps.resource)) {
    throw new OAuthError(
      'invalid_target',
      `This server issues tokens for ${deps.resource} only.`,
    );
  }

  const consumed = await deps.store.consumeCode(hashToken(code), now);

  if (!consumed.ok) {
    throw new OAuthError(
      'invalid_grant',
      consumed.reason === 'used'
        ? 'This authorization code was already used.'
        : 'Unknown authorization code.',
    );
  }

  const grant = consumed.code;

  if (grant.clientId !== clientId) {
    throw new OAuthError(
      'invalid_grant',
      'The code was issued to another client.',
    );
  }

  if (new Date(grant.expiresAt) <= now) {
    throw new OAuthError(
      'invalid_grant',
      'The authorization code has expired.',
    );
  }

  if (redirectUri !== grant.redirectUri) {
    throw new OAuthError(
      'invalid_grant',
      'redirect_uri does not match the authorization request.',
    );
  }

  if (!verifyPkce(codeVerifier, grant.codeChallenge)) {
    throw new OAuthError(
      'invalid_grant',
      'code_verifier does not match code_challenge.',
    );
  }

  if (!resourceMatches(grant.resource, deps.resource)) {
    throw new OAuthError(
      'invalid_target',
      'The code was issued for another resource.',
    );
  }

  const client = await deps.store.getClient(grant.clientId);

  const connection = await deps.store.createConnection({
    userId: grant.userId,
    accountId: grant.accountId,
    clientId: grant.clientId,
    name: client?.clientName ?? grant.clientId,
    scopes: grant.scopes,
  });

  return issuePair(deps.store, {
    connectionId: connection.id,
    scopes: grant.scopes,
    resource: deps.resource,
    rotatedFrom: null,
    now,
  });
}

async function refreshTokens(
  params: URLSearchParams,
  deps: TokenDeps,
): Promise<TokenResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const refreshToken = params.get('refresh_token');
  const clientId = params.get('client_id');
  const resource = params.get('resource');

  if (!refreshToken) {
    throw new OAuthError('invalid_request', 'refresh_token is required.');
  }

  if (resource && !resourceMatches(resource, deps.resource)) {
    throw new OAuthError(
      'invalid_target',
      `This server issues tokens for ${deps.resource} only.`,
    );
  }

  const presentedHash = hashToken(refreshToken);
  const token = await deps.store.getToken(presentedHash);

  if (!token || token.kind !== 'refresh') {
    throw new OAuthError('invalid_grant', 'Unknown refresh token.');
  }

  if (token.revokedAt || (await deps.store.hasRotatedChild(presentedHash))) {
    // A rotated token presented again: someone else has it too. End the
    // grant for both of them.
    await deps.store.revokeConnection(token.connectionId, now);

    throw new OAuthError(
      'invalid_grant',
      'This refresh token was already used; the connection has been revoked. Sign in again.',
    );
  }

  if (token.expiresAt && new Date(token.expiresAt) <= now) {
    throw new OAuthError('invalid_grant', 'The refresh token has expired.');
  }

  const connection = await deps.store.getConnection(token.connectionId);

  if (!connection || connection.revokedAt) {
    throw new OAuthError('invalid_grant', 'The connection was revoked.');
  }

  if (clientId && connection.clientId !== clientId) {
    throw new OAuthError(
      'invalid_grant',
      'The refresh token belongs to another client.',
    );
  }

  if (token.audience && !resourceMatches(token.audience, deps.resource)) {
    throw new OAuthError(
      'invalid_target',
      'The refresh token was issued for another resource.',
    );
  }

  const scopes = narrowScopes(params.get('scope'), connection.scopes);

  await deps.store.revokeToken(presentedHash, now);

  return issuePair(deps.store, {
    connectionId: connection.id,
    scopes,
    resource: deps.resource,
    rotatedFrom: presentedHash,
    now,
  });
}

/** A refresh may ask for fewer scopes than the grant, never more. */
function narrowScopes(requested: string | null, granted: McpScope[]) {
  if (!requested) return granted;

  const asked = requested
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => McpScopeSchema.safeParse(scope));

  if (asked.some((result) => !result.success)) {
    throw new OAuthError('invalid_scope', 'Unknown scope.');
  }

  const scopes = asked
    .flatMap((result) => (result.success ? [result.data] : []))
    .filter((scope) => granted.includes(scope));

  if (scopes.length === 0) {
    throw new OAuthError(
      'invalid_scope',
      'The requested scopes exceed the grant.',
    );
  }

  return scopes;
}

async function issuePair(
  store: OAuthStore,
  input: {
    connectionId: string;
    scopes: McpScope[];
    resource: string;
    rotatedFrom: string | null;
    now: Date;
  },
): Promise<TokenResponse> {
  const accessToken = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const refreshToken = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

  const rows: TokenRecord[] = [
    {
      tokenHash: hashToken(accessToken),
      connectionId: input.connectionId,
      kind: 'access',
      expiresAt: new Date(
        input.now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      rotatedFrom: null,
      revokedAt: null,
      audience: input.resource,
    },
    {
      tokenHash: hashToken(refreshToken),
      connectionId: input.connectionId,
      kind: 'refresh',
      expiresAt: new Date(
        input.now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      rotatedFrom: input.rotatedFrom,
      revokedAt: null,
      audience: input.resource,
    },
  ];

  await store.saveTokens(rows);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scopes.join(' '),
  };
}
