import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { listAssetsTool } from './assets';
import { getEpisodeTool, listEpisodesTool } from './episodes';
import { getProjectTool, listProjectsTool } from './projects';
import {
  getDialogueTool,
  getScreenplayTool,
  getShotsTool,
} from './stage-content';

/** The eight `studio:read` tools of FILM-1905, in the order a client meets them. */
export const readTools: McpToolDefinition[] = [
  listProjectsTool,
  getProjectTool,
  listEpisodesTool,
  getEpisodeTool,
  getScreenplayTool,
  getShotsTool,
  getDialogueTool,
  listAssetsTool,
].map((tool) => tool as unknown as McpToolDefinition);

export {
  listProjectsTool,
  getProjectTool,
  listEpisodesTool,
  getEpisodeTool,
  getScreenplayTool,
  getShotsTool,
  getDialogueTool,
  listAssetsTool,
};
