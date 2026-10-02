import {
  authorizationServerFromEnv,
  mcpResourceFromEnv,
  protectedResourceMetadata,
} from '@kit/studio-mcp/server';

import { discoveryResponse, discoveryPreflight } from '../_lib/discovery-response';

/**
 * RFC 9728: where /api/mcp's 401 sends a client. Names the MCP resource URL
 * and the authorization server MCP_AUTH_SERVER selects (FILM-1907).
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
