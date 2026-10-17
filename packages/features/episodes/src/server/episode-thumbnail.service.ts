import 'server-only';

import { getLogger } from '@kit/shared/logger';
import {
  type StorageAdapter,
  deleteOwnedObject,
  ownedStorageKey,
} from '@kit/storage';
import {
  PROJECT_ASSETS_BUCKET,
  episodeThumbnailFolder,
} from '@kit/storage/upload-paths';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import { INTRO_THUMBNAIL_REFUSALS } from './intro-thumbnail-refusals';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

export interface SaveEpisodeThumbnailInput {
  episodeId: string;
  language: string;
  languageLabel?: string;
  thumbnailUrl: string;
  fileName?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  isDefault?: boolean;
}

/**
 * Best-effort delete of a thumbnail's stored file. Only a file inside this
 * episode's folder: the URL came from the client, and on R2 the delete runs
 * with the app's own credentials (KB-54).
 */
export async function removeThumbnailFile(
  storage: StorageAdapter,
  thumbnailUrl: string,
  episodeId: string,
  ctx: Record<string, unknown>,
) {
  const logger = await getLogger();
  const result = await deleteOwnedObject(
    storage,
    'project-assets',
    thumbnailUrl,
    `episodes/${episodeId}/`,
  );

  if (result.deleted) {
    logger.info({ ...ctx, key: result.key }, 'Deleted thumbnail from storage');
  } else {
    logger.warn(
      { ...ctx, thumbnailUrl, reason: result.reason, error: result.error },
      'Thumbnail left in storage',
    );
  }
}

/**
 * Stores an episode's thumbnail for one language, for the Publish screen's
 * upload and the MCP thumbnail tools alike (FILM-2208). Only one of the
 * episode's own uploads: a publish sends what is saved here to the platforms
 * (KB-90). The file it replaces is removed once the row points at the new
 * one (KB-54). The caller has checked the user may edit the episode.
 */
export async function saveEpisodeThumbnail(
  client: Client,
  storage: StorageAdapter,
  userId: string,
  input: SaveEpisodeThumbnailInput,
) {
  if (
    !ownedStorageKey(
      storage,
      PROJECT_ASSETS_BUCKET,
      input.thumbnailUrl,
      episodeThumbnailFolder(input.episodeId),
    )
  ) {
    return {
      ok: false as const,
      refusal: INTRO_THUMBNAIL_REFUSALS.foreignFile,
    };
  }

  const { data: existing } = await client
    .from('episode_thumbnails')
    .select('id, thumbnail_url')
    .eq('episode_id', input.episodeId)
    .eq('language', input.language)
    .single();

  if (input.isDefault) {
    await client
      .from('episode_thumbnails')
      .update({ is_default: false })
      .eq('episode_id', input.episodeId)
      .eq('is_default', true);
  }

  const { data: thumbnail, error } = await client
    .from('episode_thumbnails')
    .upsert(
      {
        episode_id: input.episodeId,
        language: input.language,
        language_label: input.languageLabel || null,
        thumbnail_url: input.thumbnailUrl,
        file_name: input.fileName || null,
        file_size_bytes: input.fileSizeBytes || null,
        mime_type: input.mimeType || null,
        width: input.width || null,
        height: input.height || null,
        is_default: input.isDefault || false,
        created_by: userId,
      },
      { onConflict: 'episode_id,language' },
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save thumbnail: ${error.message}`);
  }

  if (!thumbnail) {
    throw new Error('Failed to save thumbnail: no data returned');
  }

  if (
    existing?.thumbnail_url &&
    existing.thumbnail_url !== input.thumbnailUrl
  ) {
    await removeThumbnailFile(
      storage,
      existing.thumbnail_url,
      input.episodeId,
      {
        name: 'thumbnail.replace',
        episodeId: input.episodeId,
      },
    );
  }

  return { ok: true as const, thumbnail };
}
