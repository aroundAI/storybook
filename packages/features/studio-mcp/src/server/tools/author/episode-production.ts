import 'server-only';

import { z } from 'zod';

import { SKIPPABLE_STAGES } from '@kit/episodes/lib/stage-state';
import { ImportScreenplaySchema } from '@kit/episodes/schemas/create-episode-start';
import {
  OptimisticLockError,
  setStageSkipped,
} from '@kit/episodes/server/episode-service';
import { saveEpisodeVideo } from '@kit/episodes/server/episode-video-service';
import { importScreenplay } from '@kit/episodes/server/screenplay-import-service';
import { SUPPORTED_LANGUAGES } from '@kit/publishing/lib/constants';
import { MarkAsExternallyUploadedSchema } from '@kit/publishing/lib/schemas/upload-only';
import { linkPublishedVideo } from '@kit/publishing/server/link-published-video';
import { type StorageAdapter, getStorageAdapter } from '@kit/storage';
import {
  PROJECT_ASSETS_BUCKET,
  episodeVideoFolder,
  isUploadPath,
  publishVideoPath,
} from '@kit/storage/upload-paths';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { type McpToolDefinition, defineTool } from '../../../registry';
import { editGroups } from '../publish/shorts';
import { requireEpisodeInAccount } from '../read/scope';
import { signPut } from '../studio/renders';
import { refused } from '../validation';

/**
 * FILM-2204: an episode made outside the pipeline, over MCP. Skip the stages
 * you will not do, attach the finished video without a StorybookStudio
 * session, or link one already on a platform. Each tool calls the function
 * the web calls (setStageSkipped, saveEpisodeVideo, linkPublishedVideo).
 */

type Client = McpPrincipal['supabase'];

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** The finished video: the types and the cap a StorybookStudio render has. */
const VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
} as const;

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const language = z
  .enum(SUPPORTED_LANGUAGES)
  .describe('The language the video is in (en, hi, es, …).');

/** Each tool takes the storage adapter from here, so a test can stand one in. */
export interface EpisodeVideoToolDeps {
  storage(client: Client): StorageAdapter;
  now(): number;
}

const defaultDeps: EpisodeVideoToolDeps = {
  storage: (client) => getStorageAdapter(client),
  now: () => Date.now(),
};

export const setStageSkippedTool = defineTool({
  name: 'set_stage_skipped',
  title: 'Skip a stage',
  description:
    'Marks a stage you will not do as skipped, or clears the mark (skipped false), under optimistic locking: pass the version get_episode returned. Ideation, story, screenplay, shots and audio can be skipped; a skipped stage stays reachable, and reads as done once it has output. Skipping changes no content.',
  inputSchema: {
    episodeId: z.string().uuid(),
    version: z
      .number()
      .int()
      .positive()
      .describe('The version from get_episode or list_episodes.'),
    stage: z.enum(SKIPPABLE_STAGES),
    skipped: z.boolean(),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    let result;

    try {
      result = await setStageSkipped(client, input);
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new McpToolError(
          'TARGET_CHANGED',
          'The episode changed since you read it. Call get_episode and retry with the new version.',
          { details: { episodeId: input.episodeId, version: input.version } },
        );
      }

      throw error;
    }

    if (!result.ok) {
      throw new McpToolError('NOT_FOUND', result.refusal);
    }

    return {
      text: `${input.stage} is ${input.skipped ? 'skipped' : 'no longer skipped'} (episode version ${result.data.version}).`,
      structuredContent: {
        episodeId: input.episodeId,
        skippedStages: result.data.skipped_stages,
        version: result.data.version,
      },
    };
  },
});

export function createEpisodeVideoTools(
  deps: EpisodeVideoToolDeps = defaultDeps,
): McpToolDefinition[] {
  const requestUpload = defineTool({
    name: 'request_episode_video_upload',
    title: 'Request an episode video upload',
    description: `Starts attaching a finished video to an episode, with no StorybookStudio session and no earlier stage needed. Takes the language, the content type (video/mp4, video/webm or video/quicktime) and the exact size in bytes (at most ${MAX_VIDEO_BYTES / 1024 / 1024} MB). Returns {key, uploadUrl, method, headers}: PUT the file to uploadUrl within an hour with exactly those headers, then call finalize_episode_video with the key. Project owner, admin or member.`,
    inputSchema: {
      episodeId: z.string().uuid(),
      language,
      contentType: z.enum(
        Object.keys(VIDEO_TYPES) as [keyof typeof VIDEO_TYPES],
      ),
      bytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
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

      const key = publishVideoPath(
        input.episodeId,
        input.language,
        VIDEO_TYPES[input.contentType],
        deps.now(),
      );
      const signed = await signPut(
        client,
        deps.storage(client),
        key,
        input.contentType,
        input.bytes,
      );

      return {
        text: `PUT ${input.bytes} bytes to uploadUrl within ${Math.round(signed.expiresIn / 60)} minutes, then call finalize_episode_video with key ${key}.`,
        structuredContent: { episodeId: input.episodeId, ...signed },
      };
    },
  });

  const finalize = defineTool({
    name: 'finalize_episode_video',
    title: 'Finalize an episode video',
    description:
      "Confirms a video uploaded after request_episode_video_upload: checks the file is stored at the key, then makes it the episode's video in that language, where the web publish screen finds it, and the episode moves to ready unless it is already published. With shortsGroupId, it becomes that Shorts group's video in that language instead (upsert_shorts_group makes the group). Calling it again with the same key changes nothing.",
    inputSchema: {
      episodeId: z.string().uuid(),
      language,
      key: z
        .string()
        .min(1)
        .describe('The key request_episode_video_upload returned.'),
      shortsGroupId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'A Shorts group (upsert_shorts_group, list_episode_publishes): the video is that cut’s short in this language, not the episode video.',
        ),
    },
    scope: 'studio:write',
    annotations: { ...WRITE, idempotentHint: true },
    async handler(input, context) {
      const client = context.principal.supabase;

      await requireEpisodeInAccount(
        client,
        context.accountId,
        input.episodeId,
        'id',
      );

      // Only a key request_episode_video_upload could have signed for this
      // episode and language
      const folder = episodeVideoFolder(input.episodeId);
      const name = input.key.slice(folder.length);

      if (
        !input.key.startsWith(folder) ||
        !name.startsWith(`${input.language}-`) ||
        name.includes('/') ||
        !isUploadPath(PROJECT_ASSETS_BUCKET, input.key)
      ) {
        throw refused(
          `key must be the one request_episode_video_upload returned for this episode and language (under ${folder}).`,
          'key',
        );
      }

      const storage = deps.storage(client);
      const stored = await storage.stat(PROJECT_ASSETS_BUCKET, input.key);

      if (!stored || stored.bytes === 0) {
        throw new McpToolError(
          'VALIDATION_FAILED',
          `No file was uploaded to ${input.key}. PUT it to the uploadUrl first, or request a new upload.`,
          { details: { key: input.key } },
        );
      }

      const videoUrl = storage.getPublicUrl(PROJECT_ASSETS_BUCKET, input.key);

      if (input.shortsGroupId) {
        const groupId = input.shortsGroupId;
        const edited = await editGroups(client, input.episodeId, (groups) => {
          const group = groups.find((g) => g.id === groupId);

          if (!group) {
            return {
              ok: false,
              refusal: `No Shorts group ${groupId} on this episode. Make it with upsert_shorts_group first.`,
            };
          }

          return {
            ok: true,
            groups: groups.map((g) =>
              g.id === groupId
                ? { ...g, videos: { ...g.videos, [input.language]: videoUrl } }
                : g,
            ),
            result: group.name,
          };
        });

        return {
          text: `The Shorts group "${edited.result}" has its ${input.language} video (${stored.bytes} bytes).`,
          structuredContent: {
            episodeId: input.episodeId,
            shortsGroupId: groupId,
            language: input.language,
            videoUrl,
            bytes: stored.bytes,
          },
        };
      }

      const saved = await saveEpisodeVideo(client, {
        episodeId: input.episodeId,
        language: input.language,
        videoUrl,
      });

      if (!saved.ok) {
        throw new McpToolError('FORBIDDEN', saved.refusal);
      }

      return {
        text: `The episode's ${input.language} video is attached (${stored.bytes} bytes); it is ${saved.status}.`,
        structuredContent: {
          episodeId: input.episodeId,
          language: input.language,
          videoUrl,
          bytes: stored.bytes,
          status: saved.status,
        },
      };
    },
  });

  return [requestUpload, finalize].map(
    (tool) => tool as unknown as McpToolDefinition,
  );
}

const link = MarkAsExternallyUploadedSchema.shape;

export const linkPublishedVideoTool = defineTool({
  name: 'link_published_video',
  title: 'Link a published video',
  description:
    "Records that an episode's video is already on a platform (YouTube, TikTok, Instagram or Facebook), uploaded outside StoryBook, from its URL. Analytics then attribute that video to the episode. A video already linked to another episode is refused, since it would be counted twice.",
  inputSchema: {
    episodeId: link.episodeId,
    platform: link.platform,
    platformUrl: link.platformUrl,
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const linked = await linkPublishedVideo(client, input, undefined);

    if (!linked.ok) {
      throw refused(linked.refusal, 'platformUrl');
    }

    return {
      text: `Linked the ${input.platform} video to the episode (publish ${linked.publishId}).`,
      structuredContent: {
        episodeId: input.episodeId,
        publishId: linked.publishId,
        platform: input.platform,
        platformUrl: input.platformUrl,
      },
    };
  },
});

export const importScreenplayTool = defineTool({
  name: 'import_screenplay',
  title: 'Import a screenplay',
  description:
    "Stores a finished script as the episode's screenplay (FILM-2205): Fountain, Final Draft (.fdx) or plain text, read into the screenplay stage's scenes and checked with its schema, under optimistic locking (the version from get_episode). Needs no story. A script that cannot be read as scenes is refused with the reason; the shots stage then reads it as any screenplay.",
  inputSchema: ImportScreenplaySchema.shape,
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    let result;

    try {
      result = await importScreenplay(client, input);
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new McpToolError(
          'TARGET_CHANGED',
          'The episode changed since you read it. Call get_episode and retry with the new version.',
          { details: { episodeId: input.episodeId, version: input.version } },
        );
      }

      throw error;
    }

    if (!result.ok) {
      throw refused(result.refusal, 'script');
    }

    return {
      text: `Stored the screenplay: ${result.data.scenes} scene${result.data.scenes === 1 ? '' : 's'}; the episode is ${result.data.status} (version ${result.data.version}).`,
      structuredContent: result.data,
    };
  },
});
