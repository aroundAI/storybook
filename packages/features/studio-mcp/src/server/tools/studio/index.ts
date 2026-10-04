import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
} from './sessions';

/**
 * Phase 20's StorybookStudio tools: the edit session (FILM-2002). FILM-2001
 * adds the edit package tool here; FILM-2003's delivery tools are their own
 * spread in ../index.ts (studioRenderTools).
 */
export const studioTools: McpToolDefinition[] = [
  openEditSessionTool,
  recordEditEventsTool,
  closeEditSessionTool,
].map((tool) => tool as unknown as McpToolDefinition);

export { closeEditSessionTool, openEditSessionTool, recordEditEventsTool };
