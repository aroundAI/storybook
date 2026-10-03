import {
  authorizationServerMetadata,
  siteOriginFromEnv,
} from '@kit/studio-mcp/server';

import {
  discoveryPreflight,
  discoveryResponse,
} from '../_lib/discovery-response';

/**
 * RFC 8414: our own authorization server's endpoints, PKCE S256 only, the
 * scopes, both grant types, no client authentication (FILM-1907).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return discoveryResponse(
    authorizationServerMetadata({ issuer: siteOriginFromEnv() }),
  );
}

export const OPTIONS = discoveryPreflight;
