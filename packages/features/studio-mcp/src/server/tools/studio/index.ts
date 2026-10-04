import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { getEditPackageTool } from './edit-package';
import { localizeEpisodeTool, regenerateShotsTool } from './jobs';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
} from './sessions';

/**
 * Phase 20's StorybookStudio tools: the edit session (FILM-2002), the
 * edit package (FILM-2001), and shot regeneration and localization
 * (FILM-2007). FILM-2003's delivery tools are their own spread
 * in ../index.ts (studioRenderTools).
 */
export const studioTools: McpToolDefinition[] = [
  openEditSessionTool,
  recordEditEventsTool,
  closeEditSessionTool,
  getEditPackageTool,
  regenerateShotsTool,
  localizeEpisodeTool,
].map((tool) => tool as unknown as McpToolDefinition);

export {
  closeEditSessionTool,
  getEditPackageTool,
  localizeEpisodeTool,
  openEditSessionTool,
  recordEditEventsTool,
  regenerateShotsTool,
};
