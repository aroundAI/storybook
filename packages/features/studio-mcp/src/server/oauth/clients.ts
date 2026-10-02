import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

import { OAuthError } from './errors';
import type { OAuthClientRecord, OAuthStore } from './store';

/**
 * Who may ask for a grant. Two ways in, both public clients (no secret):
 *
 * - Dynamic Client Registration (RFC 7591): `POST /oauth/register` with the
 *   client's metadata; we mint a `client_id` and store the metadata.
 * - A client metadata document: the client's `client_id` is an https URL
 *   that serves its metadata as JSON (Claude's published identity works
 *   this way). The first `/oauth/authorize` with that id fetches the
 *   document once, validates it and caches it with `metadata_url` set.
 *
 * The one thing a client is held to afterwards is its `redirect_uris`:
 * the authorize endpoint matches the request's `redirect_uri` against
 * them character for character.
 */
export const CLIENT_ID_PREFIX = 'sbk_client_';

const MAX_DOCUMENT_BYTES = 64 * 1024;
const DOCUMENT_TIMEOUT_MS = 5_000;

const ALLOWED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

const ClientMetadataSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(20),
  client_name: z.string().trim().min(1).max(200).optional(),
  client_uri: z.string().url().optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export type ClientMetadata = z.infer<typeof ClientMetadataSchema>;

/**
 * Where an authorization code may be sent (OAuth 2.1 §8.4): https
 * anywhere, http only to the loopback interface (a local MCP client or
 * the Inspector), and private-use schemes for native apps. Never a
 * fragment.
 */
export function isAllowedRedirectUri(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.hash) return false;

  switch (url.protocol) {
    case 'https:':
      return true;
    case 'http:':
      return isLoopbackHost(url.hostname);
    case 'javascript:':
    case 'data:':
    case 'file:':
    case 'vbscript:':
      return false;
    default:
      // A private-use scheme (RFC 8252 §7.1), e.g. cursor://…
      return (
        /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && url.protocol.length > 1
      );
  }
}

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Validates RFC 7591 metadata for a public client; throws the RFC's errors. */
export function validateClientMetadata(body: unknown): ClientMetadata & {
  client_name: string;
} {
  const parsed = ClientMetadataSchema.safeParse(body);

  if (!parsed.success) {
    const redirectProblem = parsed.error.issues.some(
      (issue) => issue.path[0] === 'redirect_uris',
    );

    throw new OAuthError(
      redirectProblem ? 'invalid_redirect_uri' : 'invalid_client_metadata',
      redirectProblem
        ? 'redirect_uris is required: one to twenty absolute URIs.'
        : parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }

  const metadata = parsed.data;

  for (const uri of metadata.redirect_uris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new OAuthError(
        'invalid_redirect_uri',
        `redirect_uri ${uri} is not allowed: use https, http on the loopback interface, or a private-use scheme, without a fragment.`,
      );
    }
  }

  if (
    metadata.token_endpoint_auth_method &&
    metadata.token_endpoint_auth_method !== 'none'
  ) {
    throw new OAuthError(
      'invalid_client_metadata',
      'Only public clients are registered here: token_endpoint_auth_method must be "none".',
    );
  }

  for (const grant of metadata.grant_types ?? []) {
    if (!(ALLOWED_GRANT_TYPES as readonly string[]).includes(grant)) {
      throw new OAuthError(
        'invalid_client_metadata',
        `grant_type ${grant} is not supported: authorization_code and refresh_token are.`,
      );
    }
  }

  for (const type of metadata.response_types ?? []) {
    if (type !== 'code') {
      throw new OAuthError(
        'invalid_client_metadata',
        `response_type ${type} is not supported: only code is.`,
      );
    }
  }

  return {
    ...metadata,
    client_name:
      metadata.client_name ?? new URL(metadata.redirect_uris[0]!).hostname,
  };
}

export interface ClientRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
}

/** `POST /oauth/register`: validates, mints a client id, stores the client. */
export async function registerClient(
  store: OAuthStore,
  body: unknown,
  options: { now?: Date } = {},
): Promise<ClientRegistrationResponse> {
  const metadata = validateClientMetadata(body);
  const now = options.now ?? new Date();
  const clientId = `${CLIENT_ID_PREFIX}${randomBytes(24).toString('base64url')}`;

  await store.saveClient({
    clientId,
    clientName: metadata.client_name,
    redirectUris: metadata.redirect_uris,
    metadataUrl: null,
    createdAt: now.toISOString(),
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: metadata.client_name,
    redirect_uris: metadata.redirect_uris,
    grant_types: metadata.grant_types ?? [...ALLOWED_GRANT_TYPES],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The client for a `client_id`: a stored one, or, when the id is an https
 * URL to a public host, the client described by the metadata document
 * there, fetched once and cached. `null` means "no such client", for
 * every reason: the authorize page shows that and never redirects.
 */
export async function resolveClient(
  store: OAuthStore,
  clientId: string,
  options: { fetchFn?: FetchLike; now?: Date } = {},
): Promise<OAuthClientRecord | null> {
  const stored = await store.getClient(clientId);

  if (stored) return stored;

  if (!isFetchableMetadataUrl(clientId)) return null;

  const document = await fetchClientMetadataDocument(
    clientId,
    options.fetchFn ?? fetch,
  );

  if (!document) return null;

  const record: OAuthClientRecord = {
    clientId,
    clientName: document.client_name,
    redirectUris: document.redirect_uris,
    metadataUrl: clientId,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  await store.saveClient(record);

  return record;
}

/** https, a public host name (never an IP literal or loopback), no fragment. */
export function isFetchableMetadataUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.hash || url.username || url.password) {
    return false;
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isLoopbackHost(host) || isIP(host) !== 0) return false;
  if (
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  ) {
    return false;
  }

  return true;
}

async function fetchClientMetadataDocument(
  url: string,
  fetchFn: FetchLike,
): Promise<(ClientMetadata & { client_name: string }) | null> {
  let response: Response;

  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('json')) return null;

  const text = await response.text();

  if (text.length > MAX_DOCUMENT_BYTES) return null;

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    (body as { client_id?: unknown }).client_id !== url
  ) {
    return null;
  }

  try {
    return validateClientMetadata(body);
  } catch (error) {
    if (error instanceof OAuthError) return null;
    throw error;
  }
}
