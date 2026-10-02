import { handleTokenRequest } from '@kit/studio-mcp/server';

import {
  bodyParams,
  oauthDeps,
  oauthErrorResponse,
  oauthJson,
  oauthPreflight,
} from '../_lib/server/oauth-route';

/**
 * The token endpoint (FILM-1907): `authorization_code` with PKCE, and
 * `refresh_token` with rotation. Tokens are bound to the MCP resource URL;
 * a request for any other `resource` is refused with invalid_target.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const params = await bodyParams(request);
    const tokens = await handleTokenRequest(params, oauthDeps());

    return oauthJson(tokens);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export const OPTIONS = oauthPreflight;
