'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { refuseRunError } from '@kit/ai-gateway/refuse-run-error';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { episodeVideoSaveRefusal } from '@kit/storage/episode-video';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const PublishVideoSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string(),
  videoUrl: z.string(), // Allow empty string for removal
});

/**
 * Update full video URL for a specific language. A new video must be one of
 * the episode's own uploads (KB-123); an empty `videoUrl` removes it.
 */
const updatePublishedVideo = enhanceAction(
  async ({ episodeId, language, videoUrl }) => {
    const client = getSupabaseServerClient();

    const { data: episode, error: fetchError } = await client
      .from('episodes')
      .select('project_id, final_video_url, localized_videos, shorts_groups')
      .eq('id', episodeId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch episode: ${fetchError.message}`);
    }

    const refusal = episodeVideoSaveRefusal({
      episodeId,
      projectId: episode.project_id,
      stored: episode,
      next: [videoUrl],
    });

    if (refusal) {
      throw new ActionRefusal(refusal);
    }

    const currentVideos =
      (episode.localized_videos as Record<string, string>) || {};
    const updatedVideos = { ...currentVideos };

    if (videoUrl) {
      updatedVideos[language] = videoUrl;
    } else {
      delete updatedVideos[language];
    }

    const { data: updated, error: updateError } = await client
      .from('episodes')
      .update({ localized_videos: updatedVideos })
      .eq('id', episodeId)
      .select('id');

    if (updateError) {
      throw new Error(
        `Failed to update published video: ${updateError.message}`,
      );
    }

    requireAffectedRows(
      updated,
      "You can't change this episode's published videos.",
    );

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return { success: true };
  },
  { schema: PublishVideoSchema },
);

export const updatePublishedVideoAction = returnRefusals(updatePublishedVideo);

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
 * This persists add/update/delete operations on shorts groups. Every video
 * must be one of the episode's own uploads or one it already holds (KB-123).
 */
const updateShortsGroups = enhanceAction(
  async ({ episodeId, shortsGroups }) => {
    const client = getSupabaseServerClient();

    const { data: episode, error: fetchError } = await client
      .from('episodes')
      .select('project_id, final_video_url, localized_videos, shorts_groups')
      .eq('id', episodeId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch episode: ${fetchError.message}`);
    }

    const refusal = episodeVideoSaveRefusal({
      episodeId,
      projectId: episode.project_id,
      stored: episode,
      next: shortsGroups.flatMap((group) => Object.values(group.videos)),
    });

    if (refusal) {
      throw new ActionRefusal(refusal);
    }

    const { data: updated, error: updateError } = await client
      .from('episodes')
      .update({ shorts_groups: shortsGroups })
      .eq('id', episodeId)
      .select('id');

    if (updateError) {
      throw new Error(`Failed to update shorts groups: ${updateError.message}`);
    }

    requireAffectedRows(updated, "You can't change this episode's shorts.");

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return { success: true };
  },
  { schema: UpdateShortsGroupsSchema },
);

export const updateShortsGroupsAction = returnRefusals(updateShortsGroups);

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
  /** The episode being published: the run belongs to its team (KB-99) */
  episodeId: z.string().uuid(),
  items: z.array(TranslationItemSchema),
});

export type TranslationItem = z.infer<typeof TranslationItemSchema>;

/**
 * Batch translate multiple content items in a single LLM call.
 * More cost-effective than individual translations.
 * Results delivered via WebSocket.
 */
const batchTranslateMetadata = enhanceAction(
  async ({
    episodeId,
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
    const { openRunForJob } = await import('@kit/ai-gateway');

    const client = getSupabaseServerClient();
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      throw new Error('Authentication required');
    }

    // The titles are the caller's own text, but the run belongs to the
    // episode's team (KB-99, KB-31): the caller must be able to write it
    const target = await authorizeEpisodeTarget(client, episodeId);

    if (!target) {
      throw new Error('Episode not found or access denied');
    }

    const run = await openRunForJob(
      {
        jobType: 'batch-translate-metadata',
        userId: user.id,
        target,
        payload: { items: itemsToTranslate },
        name: 'publish.batchTranslateMetadata',
      },
      { client, accountId: target.accountId, userId: user.id },
    ).catch(refuseRunError);
    await run.dispatch();

    return {
      success: true,
      queued: true,
      itemCount: itemsToTranslate.length,
    };
  },
  { schema: BatchTranslateSchema },
);

export const batchTranslateMetadataAction = returnRefusals(
  batchTranslateMetadata,
);
