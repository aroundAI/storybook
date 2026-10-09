import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { listAssetsTool } from './assets';
import { getEpisodeTool, listEpisodesTool } from './episodes';
import { getProjectTool, listProjectsTool } from './projects';
import { listSeasonsTool } from './seasons';
import {
  getDialogueTool,
  getScreenplayTool,
  getShotsTool,
} from './stage-content';

/** The `studio:read` tools of FILM-1905 and FILM-2204, in the order a client meets them. */
export const readTools: McpToolDefinition[] = [
  listProjectsTool,
  getProjectTool,
  listSeasonsTool,
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
  listSeasonsTool,
  listEpisodesTool,
  getEpisodeTool,
  getScreenplayTool,
  getShotsTool,
  getDialogueTool,
  listAssetsTool,
};
