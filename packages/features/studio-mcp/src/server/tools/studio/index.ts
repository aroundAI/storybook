import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { getEditPackageTool } from './edit-package';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
} from './sessions';

/**
 * Phase 20's StorybookStudio tools: the edit session (FILM-2002) and the
 * edit package (FILM-2001). FILM-2003's delivery tools are their own spread
 * in ../index.ts (studioRenderTools).
 */
export const studioTools: McpToolDefinition[] = [
  openEditSessionTool,
  recordEditEventsTool,
  closeEditSessionTool,
  getEditPackageTool,
].map((tool) => tool as unknown as McpToolDefinition);

export {
  closeEditSessionTool,
  getEditPackageTool,
  openEditSessionTool,
  recordEditEventsTool,
};
