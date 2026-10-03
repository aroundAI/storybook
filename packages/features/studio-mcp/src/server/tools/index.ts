import 'server-only';

import type { McpToolDefinition } from '../../registry';
import { whoamiTool } from './whoami';

/**
 * The tools every StoryBook MCP server exposes. FILM-1905, FILM-1906 and
 * FILM-1908 add theirs by exporting a list from their own package and
 * passing it to `createMcpRouteHandler({ tools })`, or by appending here.
 */
export const defaultTools: McpToolDefinition[] = [
  whoamiTool as unknown as McpToolDefinition,
];

export { whoamiTool };
