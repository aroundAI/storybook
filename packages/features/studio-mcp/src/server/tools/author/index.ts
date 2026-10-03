import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { upsertAssetTool } from './assets';
import { createEpisodeTool, updateEpisodeTool } from './episodes';
import { linkAssetsToEpisodeTool } from './link-assets';
import { createProjectTool, updateProjectTool } from './projects';

/**
 * The `studio:write` tools of FILM-1905 and KB-183: what a user writes by hand.
 * Generated content (story, screenplay, shots, dialogue, audio cues) is
 * never written here; it goes through FILM-1908's generation tools.
 */
export const authorTools: McpToolDefinition[] = [
  createProjectTool,
  updateProjectTool,
  createEpisodeTool,
  updateEpisodeTool,
  upsertAssetTool,
  linkAssetsToEpisodeTool,
].map((tool) => tool as unknown as McpToolDefinition);

export {
  createProjectTool,
  updateProjectTool,
  createEpisodeTool,
  updateEpisodeTool,
  upsertAssetTool,
  linkAssetsToEpisodeTool,
};
