import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
} from './sessions';
import { studioRenderTools } from './renders';

/**
 * Phase 20's StorybookStudio tools: the edit session (FILM-2002) and the
 * delivery (FILM-2003). FILM-2001 adds the edit package tool here.
 */
export const studioTools: McpToolDefinition[] = [
  openEditSessionTool,
  recordEditEventsTool,
  closeEditSessionTool,
]
  .map((tool) => tool as unknown as McpToolDefinition)
  .concat(studioRenderTools);

export { closeEditSessionTool, openEditSessionTool, recordEditEventsTool };
