'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const PublishVideoSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string(),
  videoUrl: z.string(), // Allow empty string for removal
});

/**
 * Update full video URL for a specific language
 */
export const updatePublishedVideoAction = enhanceAction(
  async ({ episodeId, language, videoUrl }) => {
    const client = getSupabaseServerClient();

    const { data: episode, error: fetchError } = await client
      .from('episodes')
      .select('localized_videos')
      .eq('id', episodeId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch episode: ${fetchError.message}`);
    }

    const currentVideos =
      (episode.localized_videos as Record<string, string>) || {};
    const updatedVideos = { ...currentVideos };

    if (videoUrl) {
      updatedVideos[language] = videoUrl;
    } else {
      delete updatedVideos[language];
    }

    const { error: updateError } = await client
      .from('episodes')
      .update({ localized_videos: updatedVideos })
      .eq('id', episodeId);

    if (updateError) {
      throw new Error(
        `Failed to update published video: ${updateError.message}`,
      );
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return { success: true };
  },
  { schema: PublishVideoSchema },
);

const ShortsGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  videos: z.record(z.string(), z.string()),
});

const UpdateShortsGroupsSchema = z.object({
  episodeId: z.string().uuid(),
  shortsGroups: z.array(ShortsGroupSchema),
});

/**
 * Update the entire shorts_groups array for an episode.
 * This persists add/update/delete operations on shorts groups.
 */
export const updateShortsGroupsAction = enhanceAction(
  async ({ episodeId, shortsGroups }) => {
    const client = getSupabaseServerClient();

    const { error: updateError } = await client
      .from('episodes')
      .update({ shorts_groups: shortsGroups })
      .eq('id', episodeId);

    if (updateError) {
      throw new Error(`Failed to update shorts groups: ${updateError.message}`);
    }

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return { success: true };
  },
  { schema: UpdateShortsGroupsSchema },
);

/**
 * Item to be translated in a batch
 */
const TranslationItemSchema = z.object({
  id: z.string(), // Unique identifier (e.g., 'full-video-hi', 'group-123-es')
  contentType: z.enum(['full-video', 'shorts-group']),
  title: z.string(),
  description: z.string(),
  targetLanguage: z.string(),
  groupId: z.string().optional(), // For shorts groups
  groupName: z.string().optional(), // For display purposes
});

const BatchTranslateSchema = z.object({
  items: z.array(TranslationItemSchema),
});

export type TranslationItem = z.infer<typeof TranslationItemSchema>;

/**
 * Batch translate multiple content items in a single LLM call.
 * More cost-effective than individual translations.
 * Results delivered via WebSocket.
 */
export const batchTranslateMetadataAction = enhanceAction(
  async ({
    items,
  }): Promise<{
    success: boolean;
    queued: boolean;
    itemCount: number;
  }> => {
    // Filter out English items (no translation needed)
    const itemsToTranslate = items.filter(
      (item) => item.targetLanguage !== 'en',
    );

    if (itemsToTranslate.length === 0) {
      return {
        success: true,
        queued: false,
        itemCount: 0,
      };
    }

    // Queue batch job to Lambda
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    // Get actual userId from session for WebSocket delivery
    const client = getSupabaseServerClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    const userId = user?.id || 'system';

    await queueLlmJob({
      jobType: 'batch-translate-metadata',
      userId,
      payload: { items: itemsToTranslate },
    });

    return {
      success: true,
      queued: true,
      itemCount: itemsToTranslate.length,
    };
  },
  { schema: BatchTranslateSchema },
);
