import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

import { localServiceUrl } from '@kit/shared/vendors';

import { OAuthError } from './errors';
import type { OAuthClientRecord, OAuthStore } from './store';

/**
 * Who may ask for a grant. Two ways in, both public clients (no secret):
 *
 * - Dynamic Client Registration (RFC 7591): `POST /oauth/register` with the
 *   client's metadata; we mint a `client_id` and store the metadata.
 * - A client metadata document: the client's `client_id` is an https URL
 *   that serves its metadata as JSON (Claude's and ChatGPT's published
 *   identities work this way). The first `/oauth/authorize` with that id fetches the
 *   document once, validates it and caches it with `metadata_url` set.
 *
 * The one thing a client is held to afterwards is its `redirect_uris`:
 * the authorize endpoint matches the request's `redirect_uri` against
 * them character for character.
 */
export const CLIENT_ID_PREFIX = 'sbk_client_';

const MAX_DOCUMENT_BYTES = 64 * 1024;
/** A cached document older than this is fetched again (KB-185). */
export const CLIENT_DOCUMENT_TTL_MS = 24 * 60 * 60 * 1000;
const DOCUMENT_TIMEOUT_MS = 5_000;

const ALLOWED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

const ClientMetadataSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(20),
  client_name: z.string().trim().min(1).max(200).optional(),
  client_uri: z.string().url().optional(),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
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

  if (!canActAsPublicClient(metadata)) {
    throw new OAuthError(
      'invalid_client_metadata',
      'Only public clients are registered here: token_endpoint_auth_method must be "none", or token_endpoint_auth_methods_supported must include it.',
    );
  }

  if (
    metadata.grant_types &&
    !metadata.grant_types.includes('authorization_code')
  ) {
    throw new OAuthError(
      'invalid_client_metadata',
      'grant_types must include authorization_code; refresh_token is the only other grant issued.',
    );
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

/**
 * Whether the client can redeem a code with PKCE alone. ChatGPT's document
 * prefers `private_key_jwt` but lists `none` among the methods it supports,
 * so it is registered as public, as RFC 7591 §3.2.1 lets a server do. A
 * client that can only authenticate is refused: no secret or key is ever
 * accepted here.
 */
function canActAsPublicClient(metadata: ClientMetadata) {
  const method = metadata.token_endpoint_auth_method;

  return (
    !method ||
    method === 'none' ||
    (metadata.token_endpoint_auth_methods_supported ?? []).includes('none')
  );
}

/**
 * Clients here never authenticate, so a credential one presents is refused
 * rather than ignored: a `client_assertion` (private_key_jwt), a
 * `client_secret`, or an Authorization header (client_secret_basic).
 * Accepting one unchecked would let a request look authenticated when it
 * is not (KB-185).
 */
export function refusePresentedClientCredentials(
  params: URLSearchParams,
  authorizationHeader?: string | null,
) {
  if (
    params.has('client_assertion') ||
    params.has('client_assertion_type') ||
    params.has('client_secret') ||
    authorizationHeader
  ) {
    throw new OAuthError(
      'invalid_client',
      'StoryBook verifies no client credential: send none, as token_endpoint_auth_method "none", and prove the request with PKCE.',
    );
  }
}

/**
 * The grants a client gets: those it asked for that we issue. Claude's
 * document also lists a JWT-bearer grant, which is dropped, not refused.
 */
function issuedGrantTypes(metadata: ClientMetadata) {
  return ALLOWED_GRANT_TYPES.filter(
    (grant) => !metadata.grant_types || metadata.grant_types.includes(grant),
  );
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
    grant_types: issuedGrantTypes(metadata),
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
 * there, fetched once and cached. `null` means "no such client"; a document
 * whose client can only authenticate throws invalid_client with the reason.
 * Either way the authorize page shows it and never redirects.
 */
export async function resolveClient(
  store: OAuthStore,
  clientId: string,
  options: {
    fetchFn?: FetchLike;
    now?: Date;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<OAuthClientRecord | null> {
  const now = options.now ?? new Date();
  const stored = await store.getClient(clientId);

  // A registered client is kept as registered; a document's copy is
  // refreshed once a day, so a vendor's rotated redirect URIs take effect.
  // Its createdAt is when it was last fetched.
  if (
    stored &&
    (!stored.metadataUrl ||
      now.getTime() - new Date(stored.createdAt).getTime() <
        CLIENT_DOCUMENT_TTL_MS)
  ) {
    return stored;
  }

  if (!isFetchableMetadataUrl(clientId)) return stored;

  const document = await fetchClientMetadataDocument(
    clientId,
    options.fetchFn ?? fetch,
    localServiceUrl('clientdocs', options.env),
  );

  // A refetch that fails keeps the copy we have
  if (!document) return stored;

  const record: OAuthClientRecord = {
    clientId,
    clientName: document.client_name,
    redirectUris: document.redirect_uris,
    metadataUrl: clientId,
    createdAt: now.toISOString(),
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

/**
 * Fetches and validates the document at `url`. `sandboxBase` is set only by
 * the vendor sandbox (development or test, local addresses only): the
 * document is then read from it, keyed by the client id, and still held to
 * that id.
 */
async function fetchClientMetadataDocument(
  url: string,
  fetchFn: FetchLike,
  sandboxBase: string | undefined,
): Promise<(ClientMetadata & { client_name: string }) | null> {
  let response: Response;

  try {
    response = await fetchFn(
      sandboxBase ? `${sandboxBase}/${encodeURIComponent(url)}` : url,
      {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
      },
    );
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

  const shape = ClientMetadataSchema.safeParse(body);

  if (shape.success && !canActAsPublicClient(shape.data)) {
    // Shown on our page, so the person adding the connector learns why
    throw new OAuthError(
      'invalid_client',
      `This client authenticates only with ${shape.data.token_endpoint_auth_method}; StoryBook accepts public clients, which prove each request with PKCE (token_endpoint_auth_method "none").`,
    );
  }

  try {
    return validateClientMetadata(body);
  } catch (error) {
    if (error instanceof OAuthError) return null;
    throw error;
  }
}
