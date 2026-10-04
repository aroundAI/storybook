import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
} from './sessions';

/**
 * Phase 20's StorybookStudio tools: the edit session (FILM-2002). FILM-2001
 * and FILM-2003 add the edit package and delivery tools here.
 */
export const studioTools: McpToolDefinition[] = [
  openEditSessionTool,
  recordEditEventsTool,
  closeEditSessionTool,
].map((tool) => tool as unknown as McpToolDefinition);

export { closeEditSessionTool, openEditSessionTool, recordEditEventsTool };
