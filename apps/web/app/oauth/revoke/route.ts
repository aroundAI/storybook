import { handleRevokeRequest } from '@kit/studio-mcp/server';

import {
  bodyParams,
  oauthDeps,
  oauthErrorResponse,
  oauthJson,
  oauthPreflight,
} from '../_lib/server/oauth-route';

/**
 * Token revocation (RFC 7009, FILM-1907): an access token alone, or a
 * refresh token with its whole connection. Answers 200 whether or not the
 * token was known.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const params = await bodyParams(request);
    await handleRevokeRequest(params, {
      ...oauthDeps(),
      authorizationHeader: request.headers.get('authorization'),
    });

    return oauthJson({});
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export const OPTIONS = oauthPreflight;
