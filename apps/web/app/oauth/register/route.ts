import { createCacheClient } from '@kit/cache';
import { OAuthError, registerClient } from '@kit/studio-mcp/server';

import {
  clientAddress,
  jsonBody,
  oauthDeps,
  oauthErrorResponse,
  oauthJson,
  oauthPreflight,
} from '../_lib/server/oauth-route';

/**
 * Dynamic Client Registration (RFC 7591) for public clients (FILM-1907).
 * Anyone may register, so each address gets a bounded number of
 * registrations an hour (`MCP_OAUTH_REGISTRATIONS_PER_HOUR`, default 20):
 * a client registers once and keeps its id.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_REGISTRATIONS_PER_HOUR = 20;

export async function POST(request: Request) {
  try {
    await enforceRegistrationLimit(request);

    const body = await jsonBody(request);
    const { store } = oauthDeps();
    const registered = await registerClient(store, body);

    return oauthJson(registered, 201);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export const OPTIONS = oauthPreflight;

async function enforceRegistrationLimit(request: Request) {
  const limit = positiveInt(
    process.env.MCP_OAUTH_REGISTRATIONS_PER_HOUR,
    DEFAULT_REGISTRATIONS_PER_HOUR,
  );
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `mcp:oauth:register:${clientAddress(request)}:${hour}`;
  const count = await createCacheClient().incr(key, 2 * 3600);

  if (count > limit) {
    throw new OAuthError(
      'temporarily_unavailable',
      'Too many client registrations from this address. Try again in an hour.',
      429,
    );
  }
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
