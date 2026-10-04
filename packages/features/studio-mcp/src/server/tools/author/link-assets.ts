import 'server-only';

import { z } from 'zod';

import { linkAssetsToEpisode } from '@kit/episodes/server/episode-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { requireEpisodeInAccount } from '../read/scope';
import { refused } from '../validation';

export const linkAssetsToEpisodeTool = defineTool({
  name: 'link_assets_to_episode',
  title: "Link a team's characters and locations to an episode",
  description:
    "Links existing characters and locations (ids from list_assets) to an episode, as the episode header's asset sidebar does. The screenplay, shots and audio stages read their cast and places from these links, so link the characters who speak and the locations a scene is set in before starting those stages; a speaker or location that is not linked is refused unless the submission declares it as new. Assets must belong to the episode's own project. Linking an asset twice changes nothing. Linking changes the episode, so a generation run opened before it is closed with TARGET_CHANGED: link first, then call start_generation.",
  inputSchema: {
    episodeId: z
      .string()
      .uuid()
      .describe('The episode id (from list_episodes).'),
    assetIds: z
      .array(z.string().uuid())
      .min(1)
      .max(50)
      .describe('Character and location asset ids (from list_assets).'),
  },
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const result = await linkAssetsToEpisode(client, input);

    if (!result.ok) {
      if (result.code === 'asset_not_in_project') {
        throw refused(result.message, 'assetIds');
      }

      throw new McpToolError(
        result.code === 'episode_not_found' ? 'NOT_FOUND' : 'FORBIDDEN',
        result.message,
        { details: { episodeId: input.episodeId } },
      );
    }

    const { linked } = result.data;

    return {
      text: `Linked ${linked.map((asset) => `${asset.type} "${asset.name}"`).join(', ')} to the episode.`,
      structuredContent: { episodeId: input.episodeId, linked },
    };
  },
});
