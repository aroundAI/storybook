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

/**
 * Update shorts URL for a specific language
 */
export const updatePublishedShortsAction = enhanceAction(
    async ({ episodeId, language, videoUrl }) => {
        const client = getSupabaseServerClient();

        const { data: episode, error: fetchError } = await client
            .from('episodes')
            .select('localized_shorts')
            .eq('id', episodeId)
            .single();

        if (fetchError) {
            throw new Error(`Failed to fetch episode: ${fetchError.message}`);
        }

        const currentShorts = (episode.localized_shorts as Record<string, string>) || {};
        const updatedShorts = { ...currentShorts };

        if (videoUrl) {
            updatedShorts[language] = videoUrl;
        } else {
            delete updatedShorts[language];
        }

        const { error: updateError } = await client
            .from('episodes')
            .update({ localized_shorts: updatedShorts })
            .eq('id', episodeId);

        if (updateError) {
            throw new Error(`Failed to update published shorts: ${updateError.message}`);
        }

        return { success: true };
    },
    { schema: PublishVideoSchema },
);

const TranslateMetadataSchema = z.object({
    title: z.string(),
    description: z.string(),
    targetLanguage: z.string(),
});

/**
 * Translate metadata (title, description) to target language using LLM
 */
export const translateMetadataAction = enhanceAction(
    async ({ title, description, targetLanguage }) => {
        // Skip translation for English
        if (targetLanguage === 'en') {
            return {
                success: true,
                translatedTitle: title,
                translatedDescription: description,
                targetLanguage,
            };
        }

        try {
            const result = await executeLLM<{ title: string; description: string }>({
                templateSlug: 'publishing/translate-metadata',
                variables: { title, description, targetLanguage },
                context: { name: 'translate-metadata', accountId: 'system' },
            });

            return {
                success: true,
                translatedTitle: result.data?.title || title,
                translatedDescription: result.data?.description || description,
                targetLanguage,
            };
        } catch (error) {
            console.error('Translation failed, using original:', error);
            // Fallback to original if translation fails
            return {
                success: false,
                translatedTitle: title,
                translatedDescription: description,
                targetLanguage,
            };
        }
    },
    { schema: TranslateMetadataSchema },
);
