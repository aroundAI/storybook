'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { executeLLM } from '@kit/prompt-engine/server';
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

        const currentVideos = (episode.localized_videos as Record<string, string>) || {};
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
            throw new Error(`Failed to update published video: ${updateError.message}`);
        }

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

        return { success: true };
    },
    { schema: UpdateShortsGroupsSchema },
);

const TranslateMetadataSchema = z.object({
    title: z.string(),
    description: z.string(),
    targetLanguage: z.string(),
});

/**
 * Translate metadata (title, description) to target language using LLM
 * In production, queues via SQS for background processing.
 */
export const translateMetadataAction = enhanceAction(
    async ({ title, description, targetLanguage }): Promise<{
        success: boolean;
        translatedTitle: string;
        translatedDescription: string;
        targetLanguage: string;
        queued?: boolean;
    }> => {
        // Skip translation for English
        if (targetLanguage === 'en') {
            return {
                success: true,
                translatedTitle: title,
                translatedDescription: description,
                targetLanguage,
            };
        }

        // Always queue to Lambda for processing
        const { queueLlmJob } = await import('@kit/prompt-engine/server');

        await queueLlmJob({
            jobType: 'publish-metadata',
            userId: 'system',
            payload: { title, description, targetLanguage },
        });

        return {
            success: true,
            translatedTitle: title,
            translatedDescription: description,
            targetLanguage,
            queued: true,
        };
    },
    { schema: TranslateMetadataSchema },
);
