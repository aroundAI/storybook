import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { configuredGenerationDeps } from '../generation';
import { createEditTools } from './tools';
import { runLayerEditWriter } from './writer';

/**
 * FILM-1909's edit tools: one scene, one shot, one dialogue line, each a
 * stage commit under an external run (`runLayerEditWriter`). The episode
 * context their checks read is the one the route configured for the
 * generation tools.
 */
const { editSceneTool, editShotTool, editDialogueLineTool } = createEditTools(
  () => ({
    writer: runLayerEditWriter,
    episodeContext: configuredGenerationDeps().episodeContext,
  }),
);

export const editTools: McpToolDefinition[] = [
  editSceneTool,
  editShotTool,
  editDialogueLineTool,
].map((tool) => tool as unknown as McpToolDefinition);

export { runLayerEditWriter };
export {
  createEditTools,
  targetChanged,
  type EditCommitRequest,
  type EditCommitResult,
  type EditToolDeps,
  type EditWriter,
} from './tools';
export {
  planLineEdit,
  planSceneEdit,
  planShotEdit,
  screenplayWithScene,
  shotColumns,
  type DialogueChange,
  type EditPlan,
  type EditStage,
  type EditWrite,
} from './plan';
