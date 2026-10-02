import 'server-only';

import {
  OAuthError,
  createSupabaseOAuthStore,
  mcpResourceFromEnv,
  toOAuthError,
} from '@kit/studio-mcp/server';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/**
 * What the three POST endpoints share (FILM-1907): the store over the
 * service-role client, the configured resource, form or JSON bodies, OAuth
 * error responses, and CORS for public clients that call from a browser.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Mcp-Protocol-Version',
};

export function oauthDeps() {
  return {
    store: createSupabaseOAuthStore(getSupabaseServerAdminClient()),
    resource: mcpResourceFromEnv(),
  };
}

/** `application/x-www-form-urlencoded` (RFC 6749) or JSON, as URLSearchParams. */
export async function bodyParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  const text = await request.text();

  if (contentType.includes('application/json')) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OAuthError('invalid_request', 'The body is not valid JSON.');
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new OAuthError(
        'invalid_request',
        'The body must be a JSON object.',
      );
    }

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') params.set(key, value);
    }

    return params;
  }

  return new URLSearchParams(text);
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OAuthError(
      'invalid_client_metadata',
      'The body is not valid JSON.',
    );
  }
}

export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

export function oauthErrorResponse(error: unknown, requestId?: string) {
  const oauthError = toOAuthError(error);

  if (oauthError.code === 'server_error') {
    console.error('[studio-mcp] oauth endpoint failed', { requestId, error });
  }

  const response = oauthError.toResponse();

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export function oauthPreflight() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}

export function clientAddress(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
