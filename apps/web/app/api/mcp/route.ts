import { createMcpRouteHandlers } from '@kit/studio-mcp/server';

/**
 * StoryBook's remote MCP server (FILM-1904): stateless Streamable HTTP,
 * JSON responses, a fresh server per request. Bearer tokens only; the
 * cookie session never reaches this route, which is why it sits outside
 * enhanceRouteHandler. Tools come from @kit/studio-mcp's registry.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { POST, GET, DELETE, OPTIONS } = createMcpRouteHandlers();
