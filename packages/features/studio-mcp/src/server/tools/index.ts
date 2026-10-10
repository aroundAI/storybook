import 'server-only';

import type { McpToolDefinition } from '../../registry';
import { analyticsTools } from './analytics';
import { authorTools } from './author';
import { editTools } from './edit';
import { generationTools } from './generation';
import { publishTools } from './publish';
import { readTools } from './read';
import { renderTools } from './render';
import { studioTools } from './studio';
import { studioRenderTools } from './studio/renders';
import { whoamiTool } from './whoami';
import { getWorkflowGuideTool } from './workflow-guide';

/**
 * The tools every StoryBook MCP server exposes: orientation (FILM-1904,
 * FILM-1905), the read and author tools (FILM-1905), the analytics tools
 * (FILM-1906), the generation tools (FILM-1908), the render and edit tools
 * (FILM-1909), the StorybookStudio tools (Phase 20), and scheduling
 * publishes (owner, 2026-10-10); one spread each.
 */
export const defaultTools: McpToolDefinition[] = [
  whoamiTool as unknown as McpToolDefinition,
  getWorkflowGuideTool as unknown as McpToolDefinition,
  ...readTools,
  ...authorTools,
  ...analyticsTools,
  ...generationTools,
  ...renderTools,
  ...editTools,
  ...studioTools,
  ...studioRenderTools,
  ...publishTools,
];

export {
  whoamiTool,
  getWorkflowGuideTool,
  readTools,
  authorTools,
  generationTools,
};
