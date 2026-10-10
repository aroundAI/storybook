'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { refuseRunError } from '@kit/ai-gateway/refuse-run-error';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { saveEpisodeVideo } from '../../../server/episode-video.service';
import { saveShortsGroups } from '../../../server/shorts-groups.service';

const PublishVideoSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string(),
  videoUrl: z.string(), // Allow empty string for removal
});

/**
 * Update full video URL for a specific language (rules: saveEpisodeVideo).
 */
const updatePublishedVideo = enhanceAction(
  async ({ episodeId, language, videoUrl }) => {
    const result = await saveEpisodeVideo(getSupabaseServerClient(), {
      episodeId,
      language,
      videoUrl,
    });

    if (!result.ok) {
      throw new ActionRefusal(result.refusal);
    }

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
  // The platforms this cut goes to; none means every Shorts platform
  platforms: z
    .array(z.enum(['youtube', 'instagram', 'facebook', 'tiktok', 'twitter']))
    .optional(),
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
    const saved = await saveShortsGroups(getSupabaseServerClient(), {
      episodeId,
      shortsGroups,
    });

    if (!saved.ok) {
      throw new ActionRefusal(saved.refusal);
    }

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
