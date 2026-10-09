import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { upsertAssetTool } from './assets';
import {
  createEpisodeVideoTools,
  importScreenplayTool,
  linkPublishedVideoTool,
  setStageSkippedTool,
} from './episode-production';
import { createEpisodeTool, updateEpisodeTool } from './episodes';
import { linkAssetsToEpisodeTool } from './link-assets';
import { createProjectTool, updateProjectTool } from './projects';
import {
  createSeasonTool,
  deleteSeasonTool,
  reorderSeasonsTool,
  updateSeasonTool,
} from './seasons';

/**
 * The `studio:write` tools of FILM-1905 and KB-183: what a user writes by hand,
 * and FILM-2204's seasons, skipped stages and finished videos.
 * Generated content (story, screenplay, shots, dialogue, audio cues) is
 * never written here; it goes through FILM-1908's generation tools.
 */
export const authorTools: McpToolDefinition[] = [
  ...[
    createProjectTool,
    updateProjectTool,
    createSeasonTool,
    updateSeasonTool,
    reorderSeasonsTool,
    deleteSeasonTool,
    createEpisodeTool,
    updateEpisodeTool,
    setStageSkippedTool,
    importScreenplayTool,
    upsertAssetTool,
    linkAssetsToEpisodeTool,
    linkPublishedVideoTool,
  ].map((tool) => tool as unknown as McpToolDefinition),
  ...createEpisodeVideoTools(),
];

export {
  createSeasonTool,
  updateSeasonTool,
  reorderSeasonsTool,
  deleteSeasonTool,
  setStageSkippedTool,
  importScreenplayTool,
  linkPublishedVideoTool,
  createProjectTool,
  updateProjectTool,
  createEpisodeTool,
  updateEpisodeTool,
  upsertAssetTool,
  linkAssetsToEpisodeTool,
};
