import 'server-only';

import { z } from 'zod';

import { OptimisticLockError } from '@kit/episodes/server/episode-service';
import {
  type StoredShortsGroup,
  editShortsGroups,
} from '@kit/episodes/server/shorts-groups-service';
import { SHORTS_PLATFORMS, takesVideo } from '@kit/publishing/lib/constants';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { type McpToolDefinition, defineTool } from '../../../registry';
import { requireEpisodeInAccount } from '../read/scope';
import { refused } from '../validation';

/**
 * Shorts groups over MCP (owner, 2026-10-10): a short is cut differently
 * for each platform, so each cut is a group naming the platforms it goes
 * to, with one video per language. These tools edit the groups the Publish
 * screen edits, through the same saveShortsGroups; a video goes into a
 * group with request_episode_video_upload and finalize_episode_video's
 * shortsGroupId.
 */

type Client = McpPrincipal['supabase'];

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const platforms = z
  .array(z.enum(SHORTS_PLATFORMS))
  .max(SHORTS_PLATFORMS.length)
  .refine(
    (list) => list.every((platform) => takesVideo('short', platform)),
    'StoryBook does not publish shorts to that platform at the moment.',
  )
  .describe(
    'The platforms this cut goes to (youtube, instagram, facebook, tiktok). An empty list means every Shorts platform.',
  );

const TARGET_CHANGED =
  'The episode changed while saving. Call list_episode_publishes and retry.';

/** Runs one edit of an episode's groups, as the tools' errors say it */
export async function editGroups<T>(
  client: Client,
  episodeId: string,
  edit: Parameters<typeof editShortsGroups<T>>[2],
) {
  let edited;

  try {
    edited = await editShortsGroups(client, episodeId, edit);
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      throw new McpToolError('TARGET_CHANGED', TARGET_CHANGED, {
        details: { episodeId },
      });
    }

    throw error;
  }

  if (!edited.ok) {
    throw refused(edited.refusal, 'shortsGroupId');
  }

  return edited;
}

function describeGroup(group: StoredShortsGroup) {
  return {
    id: group.id,
    name: group.name,
    title: group.title,
    description: group.description,
    tags: group.tags,
    platforms: group.platforms ?? [],
    languages: Object.entries(group.videos)
      .filter(([, url]) => url)
      .map(([language]) => language),
  };
}

export const upsertShortsGroupTool = defineTool({
  name: 'upsert_shorts_group',
  title: 'Create or update a Shorts group',
  description:
    'Creates a Shorts group (leave shortsGroupId out; name is required) or updates one: its name, the title, description and tags its shorts post with, and the platforms it goes to. A short is cut differently per platform, so make one group per cut, e.g. "YT cut" to youtube and "IG/FB cut" to instagram and facebook; each channel then gets the cut for its platform in its own language. Fields left out keep their value. Add videos with request_episode_video_upload and finalize_episode_video(shortsGroupId).',
  inputSchema: {
    episodeId: z.string().uuid(),
    shortsGroupId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The group to update (list_episode_publishes); omit to create one.',
      ),
    name: z.string().min(1).max(100).optional(),
    title: z.string().max(5000).optional(),
    description: z.string().max(70000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(100).optional(),
    platforms: platforms.optional(),
  },
  scope: 'studio:write',
  annotations: WRITE,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const fields = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.platforms !== undefined && { platforms: input.platforms }),
    };

    const edited = await editGroups(client, input.episodeId, (groups) => {
      if (!input.shortsGroupId) {
        if (!input.name) {
          return { ok: false, refusal: 'A new Shorts group needs a name.' };
        }

        const group: StoredShortsGroup = {
          id: `group-${Date.now()}`,
          name: input.name,
          title: '',
          description: '',
          tags: [],
          videos: {},
          ...fields,
        };

        return { ok: true, groups: [...groups, group], result: group };
      }

      const existing = groups.find((g) => g.id === input.shortsGroupId);

      if (!existing) {
        return {
          ok: false,
          refusal: `No Shorts group ${input.shortsGroupId} on this episode. Call list_episode_publishes for its groups.`,
        };
      }

      const group = { ...existing, ...fields };

      return {
        ok: true,
        groups: groups.map((g) => (g.id === group.id ? group : g)),
        result: group,
      };
    });

    const group = describeGroup(edited.result);

    return {
      text: `${input.shortsGroupId ? 'Updated' : 'Created'} the Shorts group "${group.name}" (${group.id}); it goes to ${group.platforms.length ? group.platforms.join(', ') : 'every Shorts platform'}.`,
      structuredContent: { episodeId: input.episodeId, shortsGroup: group },
    };
  },
});

export const deleteShortsGroupTool = defineTool({
  name: 'delete_shorts_group',
  title: 'Delete a Shorts group',
  description:
    'Deletes a Shorts group and its videos from the episode. Refused while a scheduled publish still uses it: cancel that first (cancel_scheduled_publish), since it would have no video when its time came.',
  inputSchema: {
    episodeId: z.string().uuid(),
    shortsGroupId: z.string().min(1),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const { count, error } = await client
      .from('publishes')
      .select('id', { count: 'exact', head: true })
      .eq('episode_id', input.episodeId)
      .eq('status', 'scheduled')
      .eq('metadata->>shortsGroupId', input.shortsGroupId);

    if (error) {
      throw new Error(`Could not read the publishes: ${error.message}`);
    }

    if (count) {
      throw refused(
        `${count} scheduled publish${count === 1 ? '' : 'es'} still use${count === 1 ? 's' : ''} this group. Cancel ${count === 1 ? 'it' : 'them'} first with cancel_scheduled_publish.`,
        'shortsGroupId',
      );
    }

    const edited = await editGroups(client, input.episodeId, (groups) => {
      const remaining = groups.filter((g) => g.id !== input.shortsGroupId);

      return {
        ok: true,
        groups: remaining,
        result: remaining.length !== groups.length,
      };
    });

    return {
      text: edited.result
        ? `Deleted the Shorts group ${input.shortsGroupId}.`
        : `No Shorts group ${input.shortsGroupId}; nothing changed.`,
      structuredContent: {
        episodeId: input.episodeId,
        shortsGroupId: input.shortsGroupId,
        deleted: edited.result,
      },
    };
  },
});

export const shortsGroupTools = [
  upsertShortsGroupTool,
  deleteShortsGroupTool,
] as unknown as McpToolDefinition[];
