import {
  configureGenerationTools,
  createMcpRouteHandlers,
} from '@kit/studio-mcp/server';

import { episodeContextLoader } from '../../../lambda/llm-worker/utils/episode-context-loader';

/**
 * StoryBook's remote MCP server (FILM-1904): stateless Streamable HTTP,
 * JSON responses, a fresh server per request. Bearer tokens only; the
 * cookie session never reaches this route, which is why it sits outside
 * enhanceRouteHandler. Tools come from @kit/studio-mcp's registry.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The generation tools' episode context is the worker's, without the
// similar-episode recall: that is an embedding call, and an external run
// makes none (FILM-1908, FR-20)
configureGenerationTools({
  episodeContext: (client) => episodeContextLoader(client, { semantic: false }),
});

export const { POST, GET, DELETE, OPTIONS } = createMcpRouteHandlers();
