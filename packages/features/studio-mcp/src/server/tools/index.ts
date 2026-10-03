import 'server-only';

import type { McpToolDefinition } from '../../registry';
import { analyticsTools } from './analytics';
import { authorTools } from './author';
import { generationTools } from './generation';
import { readTools } from './read';
import { renderTools } from './render';
import { whoamiTool } from './whoami';
import { getWorkflowGuideTool } from './workflow-guide';

/**
 * The tools every StoryBook MCP server exposes: orientation (FILM-1904,
 * FILM-1905), the read and author tools (FILM-1905), the analytics tools
 * (FILM-1906), the render tools (FILM-1909). FILM-1908 appends its list
 * here, one spread.
 */
export const defaultTools: McpToolDefinition[] = [
  whoamiTool as unknown as McpToolDefinition,
  getWorkflowGuideTool as unknown as McpToolDefinition,
  ...readTools,
  ...authorTools,
  ...analyticsTools,
  ...generationTools,
  ...renderTools,
];

export {
  whoamiTool,
  getWorkflowGuideTool,
  readTools,
  authorTools,
  generationTools,
};
