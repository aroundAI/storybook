import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import {
  type RenderStartDeps,
  createRenderStartTools,
  webRenderStarts,
} from './starts';
import { getRenderStatusTool } from './status';
import { getVeoManifestTool } from './veo-manifest';

const { startVoiceRenderTool, startAudioRenderTool } =
  createRenderStartTools(webRenderStarts);

/**
 * FILM-1909's render tools: voice, music and SFX started through the web's
 * own render starts (studio:render), their status, and the VEO manifest for
 * an external video tool (studio:read). None calls a language model.
 */
export const renderTools: McpToolDefinition[] = [
  startVoiceRenderTool,
  startAudioRenderTool,
  getRenderStatusTool,
  getVeoManifestTool,
].map((tool) => tool as unknown as McpToolDefinition);

export {
  createRenderStartTools,
  getRenderStatusTool,
  getVeoManifestTool,
  webRenderStarts,
  type RenderStartDeps,
};
