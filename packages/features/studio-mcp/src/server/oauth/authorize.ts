import { randomBytes } from 'node:crypto';

import { STORYBOOKSTUDIO_CLIENT_ID } from '../../desktop-client';
import {
  MCP_SCOPES,
  type McpScope,
  McpScopeSchema,
  OPT_IN_SCOPES,
} from '../../scopes';
import { hashToken } from '../token';
import { resolveClient } from './clients';
import { OAuthError } from './errors';
import { isCodeChallengeShape } from './pkce';
import { resourceMatches } from './resource';
import type { OAuthClientRecord, OAuthStore } from './store';

/** A code lives one minute: long enough for the redirect, no longer. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

/** What a client gets when it asks for no scope in particular. */
export const DEFAULT_SCOPES: McpScope[] = ['studio:read', 'studio:write'];

export interface AuthorizeRequest {
  client: OAuthClientRecord;
  redirectUri: string;
  scopes: McpScope[];
  codeChallenge: string;
  state: string | null;
  /** The MCP resource URL the grant is for, canonical. */
  resource: string;
  /** Our issuer, returned as `iss` on every redirect (RFC 9207). */
  issuer: string;
}

export type AuthorizeParse =
  | { ok: true; request: AuthorizeRequest }
  /**
   * The client or its redirect URI could not be trusted, so the error is
   * shown on our page and the user agent goes nowhere (RFC 6749 §4.1.2.1:
   * never redirect to an unverified URI).
   */
  | { ok: false; kind: 'render'; error: OAuthError }
  /** The client and URI are fine; the request is not. The client is told. */
  | { ok: false; kind: 'redirect'; location: string; error: OAuthError };

export interface AuthorizeDeps {
  store: OAuthStore;
  /** The configured MCP resource URL. */
  resource: string;
  /** The authorization server's issuer, exactly as its metadata names it. */
  issuer: string;
  fetchFn?: typeof fetch;
}

/**
 * Validates the query of `GET /oauth/authorize` before anything is shown:
 * a known client, an exactly registered redirect URI (or StorybookStudio's
 * loopback), `response_type=code`,
 * PKCE with S256, scopes from the catalogue, and a `resource` (RFC 8707),
 * when given, that is this deployment's MCP URL.
 */
export async function parseAuthorizeRequest(
  params: URLSearchParams,
  deps: AuthorizeDeps,
): Promise<AuthorizeParse> {
  const clientId = params.get('client_id');

  if (!clientId) {
    return render('invalid_request', 'client_id is required.');
  }

  let client: OAuthClientRecord | null;

  try {
    client = await resolveClient(deps.store, clientId, {
      fetchFn: deps.fetchFn,
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      return { ok: false, kind: 'render', error };
    }

    throw error;
  }

  if (!client) {
    return render(
      'invalid_client',
      'This client is not registered with StoryBook.',
    );
  }

  const requestedRedirect = params.get('redirect_uri');
  const redirectUri =
    requestedRedirect ??
    (client.redirectUris.length === 1 ? client.redirectUris[0]! : null);

  if (!redirectUri || !isRegisteredRedirectUri(client, redirectUri)) {
    return render(
      'invalid_redirect_uri',
      'The redirect URI is not one this client registered.',
    );
  }

  const state = params.get('state');
  const redirectWith = (error: OAuthError): AuthorizeParse => ({
    ok: false,
    kind: 'redirect',
    location: errorLocation(redirectUri, error, state, deps.issuer),
    error,
  });

  if (params.get('response_type') !== 'code') {
    return redirectWith(
      new OAuthError(
        'unsupported_response_type',
        'response_type must be code.',
      ),
    );
  }

  const codeChallenge = params.get('code_challenge');

  if (!codeChallenge || !isCodeChallengeShape(codeChallenge)) {
    return redirectWith(
      new OAuthError(
        'invalid_request',
        'code_challenge is required: 43 base64url characters (PKCE S256).',
      ),
    );
  }

  if (params.get('code_challenge_method') !== 'S256') {
    return redirectWith(
      new OAuthError(
        'invalid_request',
        'code_challenge_method must be S256; plain is not accepted.',
      ),
    );
  }

  const scopes = parseScopes(params.get('scope'));

  if (!scopes) {
    return redirectWith(
      new OAuthError(
        'invalid_scope',
        `Unknown scope. Supported: ${MCP_SCOPES.join(', ')}.`,
      ),
    );
  }

  const requestedResource = params.get('resource');

  if (requestedResource && !resourceMatches(requestedResource, deps.resource)) {
    return redirectWith(
      new OAuthError(
        'invalid_target',
        `This server issues tokens for ${deps.resource} only.`,
      ),
    );
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      scopes,
      codeChallenge,
      state,
      resource: deps.resource,
      issuer: deps.issuer,
    },
  };
}

/**
 * StorybookStudio's loopback fallback (FILM-2005, RFC 8252 §7.3): the
 * desktop app listens on a port it picks for one sign-in, so the port is
 * any, and everything else is fixed: http, the IPv4 literal, `/callback`,
 * no query or fragment.
 */
const STUDIO_LOOPBACK_REDIRECT =
  /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/callback$/;

/**
 * Whether `uri` is one the client registered: character for character for
 * every client, plus, for the StorybookStudio client alone, a loopback
 * callback on any valid port.
 */
export function isRegisteredRedirectUri(
  client: Pick<OAuthClientRecord, 'clientId' | 'redirectUris'>,
  uri: string,
) {
  if (client.redirectUris.includes(uri)) return true;
  if (client.clientId !== STORYBOOKSTUDIO_CLIENT_ID) return false;

  const port = STUDIO_LOOPBACK_REDIRECT.exec(uri)?.[1];

  return port !== undefined && Number(port) <= 65535;
}

/**
 * `null` for an unknown scope; for no scope at all, the default set plus the
 * opt-in scopes, which the consent screen offers unticked.
 */
export function parseScopes(value: string | null): McpScope[] | null {
  const parts = (value ?? '').split(/\s+/).filter(Boolean);

  if (parts.length === 0) return [...DEFAULT_SCOPES, ...OPT_IN_SCOPES];

  const scopes: McpScope[] = [];

  for (const part of parts) {
    const parsed = McpScopeSchema.safeParse(part);

    if (!parsed.success) return null;
    if (!scopes.includes(parsed.data)) scopes.push(parsed.data);
  }

  return scopes;
}

/**
 * The user approved: mint a code, store its hash with everything the token
 * endpoint will check (client, user, team, scopes, PKCE challenge,
 * redirect URI, resource, expiry), and build the redirect.
 */
export async function issueAuthorizationCode(
  store: OAuthStore,
  input: {
    request: AuthorizeRequest;
    userId: string;
    accountId: string;
    /** What the user granted: a non-empty subset of the request's scopes. */
    scopes: McpScope[];
    now?: Date;
  },
): Promise<{ code: string; location: string }> {
  const now = input.now ?? new Date();
  const granted = input.scopes.filter((scope) =>
    input.request.scopes.includes(scope),
  );

  if (granted.length === 0) {
    throw new OAuthError('invalid_scope', 'Grant at least one scope.');
  }

  const code = randomBytes(32).toString('base64url');

  await store.saveCode({
    codeHash: hashToken(code),
    clientId: input.request.client.clientId,
    userId: input.userId,
    accountId: input.accountId,
    scopes: granted,
    codeChallenge: input.request.codeChallenge,
    redirectUri: input.request.redirectUri,
    resource: input.request.resource,
    expiresAt: new Date(
      now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    ).toISOString(),
    usedAt: null,
  });

  const location = new URL(input.request.redirectUri);
  location.searchParams.set('code', code);

  if (input.request.state !== null) {
    location.searchParams.set('state', input.request.state);
  }

  location.searchParams.set('iss', input.request.issuer);

  return { code, location: location.toString() };
}

/** The user declined. */
export function denialLocation(request: AuthorizeRequest) {
  return errorLocation(
    request.redirectUri,
    new OAuthError('access_denied', 'The user declined the request.'),
    request.state,
    request.issuer,
  );
}

function errorLocation(
  redirectUri: string,
  error: OAuthError,
  state: string | null,
  issuer: string,
) {
  const location = new URL(redirectUri);

  location.searchParams.set('error', error.code);
  location.searchParams.set('error_description', error.message);

  if (state !== null) location.searchParams.set('state', state);

  location.searchParams.set('iss', issuer);

  return location.toString();
}

function render(code: OAuthError['code'], description: string): AuthorizeParse {
  return {
    ok: false,
    kind: 'render',
    error: new OAuthError(code, description),
  };
}
