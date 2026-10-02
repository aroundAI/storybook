import { createHash, randomBytes } from 'node:crypto';

/**
 * A minimal OAuth 2.1 public client for the specs (FILM-1907): PKCE, the
 * authorize URL, and plain `fetch` against /oauth/register, /oauth/token
 * and /oauth/revoke, so what the server answers is measured rather than
 * read off a page.
 */
export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
export const MCP_URL = `${BASE_URL}/api/mcp`;

/**
 * A loopback URI on the app itself whose URL carries the code back. The
 * health check answers plain JSON and runs no client code: the app's 404
 * page, used first, mounts the browser Supabase client, which signed the
 * session out when visited twice in a row (see the probe in the PR).
 */
export const CALLBACK_URL = `${BASE_URL}/healthcheck`;
export const CALLBACK_PATH = '/healthcheck';

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64url');

  return { verifier, challenge };
}

export async function registerClient(input: {
  clientName: string;
  redirectUris?: string[];
}) {
  const response = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: input.clientName,
      redirect_uris: input.redirectUris ?? [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  const body = (await response.json()) as {
    client_id?: string;
    error?: string;
    error_description?: string;
  };

  return { status: response.status, body };
}

export function authorizeUrl(input: {
  clientId: string;
  challenge: string;
  scope?: string | null;
  state?: string;
  redirectUri?: string;
  resource?: string | null;
  method?: string;
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? CALLBACK_URL,
    code_challenge: input.challenge,
    code_challenge_method: input.method ?? 'S256',
    state: input.state ?? randomBytes(8).toString('hex'),
  });

  if (input.scope !== null) {
    params.set(
      'scope',
      input.scope ?? 'studio:read studio:write studio:render',
    );
  }

  if (input.resource !== null) {
    params.set('resource', input.resource ?? MCP_URL);
  }

  return `${BASE_URL}/oauth/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postForm(path: string, params: Record<string, string>) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as TokenResponse,
  };
}

export function exchangeCode(input: {
  code: string;
  clientId: string;
  verifier: string;
  redirectUri?: string;
  resource?: string;
}) {
  return postForm('/oauth/token', {
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? CALLBACK_URL,
    code_verifier: input.verifier,
    resource: input.resource ?? MCP_URL,
  });
}

export function refreshTokens(input: {
  refreshToken: string;
  clientId: string;
}) {
  return postForm('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: MCP_URL,
  });
}

export function revokeToken(token: string) {
  return postForm('/oauth/revoke', { token });
}

export async function callWhoami(token: string | null) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    }),
  });

  return {
    status: response.status,
    wwwAuthenticate: response.headers.get('www-authenticate'),
    body: (await response.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
      };
      error?: { code: string; details?: Record<string, unknown> };
    },
  };
}

export async function discovery(path: string) {
  const response = await fetch(`${BASE_URL}${path}`);

  return {
    status: response.status,
    cors: response.headers.get('access-control-allow-origin'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** The `code` and `state` the browser was sent back with. */
export function callbackParams(url: URL) {
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    errorDescription: url.searchParams.get('error_description'),
  };
}
