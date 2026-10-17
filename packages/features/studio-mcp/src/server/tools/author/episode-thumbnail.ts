import 'server-only';

import { z } from 'zod';

import { saveEpisodeThumbnail } from '@kit/episodes/server/episode-thumbnail-service';
import { SUPPORTED_LANGUAGES } from '@kit/publishing/lib/constants';
import { type StorageAdapter, getStorageAdapter } from '@kit/storage';
import {
  PROJECT_ASSETS_BUCKET,
  episodeThumbnailFolder,
  episodeThumbnailPath,
  isUploadPath,
} from '@kit/storage/upload-paths';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { type McpToolDefinition, defineTool } from '../../../registry';
import { requireEpisodeInAccount } from '../read/scope';
import { signPut } from '../studio/renders';
import { refused } from '../validation';

/**
 * FILM-2208: an episode's thumbnail over MCP, saved where the Publish
 * screen's thumbnail upload saves it (saveEpisodeThumbnail), so a long video
 * scheduled by schedule_release carries it. Shorts never do (KB-197).
 */

type Client = McpPrincipal['supabase'];

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

/** YouTube's limit for a custom thumbnail */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const language = z
  .enum(SUPPORTED_LANGUAGES)
  .describe('The language of the videos it goes on (en, hi, es, …).');

/** Each tool takes the storage adapter from here, so a test can stand one in. */
export interface EpisodeThumbnailToolDeps {
  storage(client: Client): StorageAdapter;
  now(): number;
}

const defaultDeps: EpisodeThumbnailToolDeps = {
  storage: (client) => getStorageAdapter(client),
  now: () => Date.now(),
};

export function createEpisodeThumbnailTools(
  deps: EpisodeThumbnailToolDeps = defaultDeps,
) {
  const request = defineTool({
    name: 'request_episode_thumbnail_upload',
    title: 'Request an episode thumbnail upload',
    description: `Starts uploading the thumbnail an episode's long video posts with, in one language. Takes the content type (image/jpeg, image/png or image/webp) and the exact size in bytes (at most ${MAX_THUMBNAIL_BYTES / 1024 / 1024} MB, YouTube's limit). Returns {key, uploadUrl, method, headers}: PUT the file to uploadUrl within an hour with exactly those headers, then call finalize_episode_thumbnail with the key. Shorts and Reels post with no thumbnail. Project owner, admin or member.`,
    inputSchema: {
      episodeId: z.string().uuid(),
      language,
      contentType: z.enum(
        Object.keys(IMAGE_TYPES) as [keyof typeof IMAGE_TYPES],
      ),
      bytes: z.number().int().positive().max(MAX_THUMBNAIL_BYTES),
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

      const key = episodeThumbnailPath(
        input.episodeId,
        input.language,
        IMAGE_TYPES[input.contentType],
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
        text: `PUT ${input.bytes} bytes to uploadUrl within ${Math.round(signed.expiresIn / 60)} minutes, then call finalize_episode_thumbnail with key ${key}.`,
        structuredContent: { episodeId: input.episodeId, ...signed },
      };
    },
  });

  const finalize = defineTool({
    name: 'finalize_episode_thumbnail',
    title: 'Finalize an episode thumbnail',
    description:
      "Confirms a thumbnail uploaded after request_episode_thumbnail_upload: checks the file is stored at the key, then makes it the episode's thumbnail in that language, replacing (and deleting) the one before. The first one, or one with isDefault, is also the thumbnail for languages that have none. Calling it again with the same key changes nothing.",
    inputSchema: {
      episodeId: z.string().uuid(),
      language,
      key: z
        .string()
        .min(1)
        .describe('The key request_episode_thumbnail_upload returned.'),
      isDefault: z
        .boolean()
        .optional()
        .describe(
          'Also the thumbnail for languages that have none. Defaults to true when the episode has no default yet.',
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

      // Only a key request_episode_thumbnail_upload could have signed for
      // this episode and language
      const folder = episodeThumbnailFolder(input.episodeId);
      const name = input.key.slice(folder.length);

      if (
        !input.key.startsWith(folder) ||
        !name.startsWith(`${input.language}-`) ||
        name.includes('/') ||
        !isUploadPath(PROJECT_ASSETS_BUCKET, input.key)
      ) {
        throw refused(
          `key must be the one request_episode_thumbnail_upload returned for this episode and language (under ${folder}).`,
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

      const { data: current } = await client
        .from('episode_thumbnails')
        .select('language')
        .eq('episode_id', input.episodeId)
        .eq('is_default', true)
        .maybeSingle();

      const thumbnailUrl = storage.getPublicUrl(
        PROJECT_ASSETS_BUCKET,
        input.key,
      );
      // The default stays where it is, unless there is none yet
      const isDefault =
        input.isDefault ?? (!current || current.language === input.language);

      const saved = await saveEpisodeThumbnail(
        client,
        storage,
        context.principal.userId,
        {
          episodeId: input.episodeId,
          language: input.language,
          thumbnailUrl,
          fileSizeBytes: stored.bytes,
          isDefault,
        },
      );

      if (!saved.ok) throw refused(saved.refusal, 'key');

      return {
        text: `The episode's ${input.language} thumbnail is set${isDefault ? ', and is its default' : ''}. Long videos scheduled from now on post with it; Shorts post with none.`,
        structuredContent: {
          episodeId: input.episodeId,
          language: input.language,
          thumbnailUrl,
          isDefault,
        },
      };
    },
  });

  return [request, finalize] as unknown as McpToolDefinition[];
}
