import 'server-only';

import type { McpToolDefinition } from '../../registry';
import { authorTools } from './author';
import { readTools } from './read';
import { whoamiTool } from './whoami';
import { getWorkflowGuideTool } from './workflow-guide';

/**
 * The tools every StoryBook MCP server exposes: orientation (FILM-1904,
 * FILM-1905), the read and author tools (FILM-1905). FILM-1906 and
 * FILM-1908 append their lists here, one spread each.
 */
export const defaultTools: McpToolDefinition[] = [
  whoamiTool as unknown as McpToolDefinition,
  getWorkflowGuideTool as unknown as McpToolDefinition,
  ...readTools,
  ...authorTools,
];

export { whoamiTool, getWorkflowGuideTool, readTools, authorTools };
