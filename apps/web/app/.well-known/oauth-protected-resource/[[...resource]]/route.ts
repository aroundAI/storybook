import {
  authorizationServerFromEnv,
  mcpResourceFromEnv,
  protectedResourceMetadata,
} from '@kit/studio-mcp/server';

import {
  discoveryPreflight,
  discoveryResponse,
} from '../../_lib/discovery-response';

/**
 * RFC 9728: where /api/mcp's 401 sends a client. Names the MCP resource URL
 * and the authorization server MCP_AUTH_SERVER selects (FILM-1907). Served
 * at the root URL and at the path-aware one
 * (`/.well-known/oauth-protected-resource/api/mcp`), which the MCP SDK
 * tries first.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return discoveryResponse(
    protectedResourceMetadata({
      resource: mcpResourceFromEnv(),
      authorizationServer: authorizationServerFromEnv(),
    }),
  );
}

export const OPTIONS = discoveryPreflight;
