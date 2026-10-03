import 'server-only';

/**
 * Discovery documents are public and read cross-origin by browser-based
 * MCP clients (the Inspector, claude.ai), so they allow any origin and may
 * be cached briefly.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Protocol-Version',
};

export function discoveryResponse(body: Record<string, unknown>) {
  return Response.json(body, {
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export function discoveryPreflight() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}
