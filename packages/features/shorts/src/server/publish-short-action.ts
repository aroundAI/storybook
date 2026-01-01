'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Schema
// =============================================================================

const PublishShortSchema = z.object({
    shortId: z.string().uuid(),
    platforms: z.array(
        z.object({
            platform: z.enum(['youtube', 'tiktok', 'instagram', 'facebook']),
            language: z.enum(['en', 'hi', 'es', 'pt']),
        }),
    ),
    titleOverride: z.string().max(200).optional(),
    captionOverride: z.string().optional(),
    hashtagsOverride: z.array(z.string()).optional(),
    scheduleAt: z.string().datetime().optional(),
});

type PublishShortInput = z.infer<typeof PublishShortSchema>;

interface PublishShortResult {
    success: boolean;
    publicationIds: string[];
    errors: string[];
}

// =============================================================================
// Main Action
// =============================================================================

/**
 * Publish a short to one or more platforms
 *
 * Creates publication records and initiates upload to platforms
 */
export const publishShortAction = enhanceAction(
    async (input: PublishShortInput): Promise<PublishShortResult> => {
        const logger = await getLogger();
        const ctx = {
            name: 'shorts.publish',
            shortId: input.shortId,
            platforms: input.platforms.map((p) => `${p.platform}:${p.language}`),
        };

        logger.info(ctx, 'Starting short publication');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        try {
            // 1. Fetch the short
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: short, error: shortError } = await (client as any)
                .from('shorts')
                .select(
                    `
          id,
          episode_id,
          video_url_9x16,
          title,
          caption,
          hashtags,
          status
        `,
                )
                .eq('id', input.shortId)
                .single();

            if (shortError || !short) {
                throw new Error('Short not found');
            }

            if (short.status !== 'ready') {
                throw new Error(
                    `Short is not ready for publishing (status: ${short.status})`,
                );
            }

            if (!short.video_url_9x16) {
                throw new Error('Short video URL not available');
            }

            const publicationIds: string[] = [];
            const errors: string[] = [];

            // 2. Create publication records for each platform
            for (const target of input.platforms) {
                try {
                    // Check if publication already exists
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: existing } = await (client as any)
                        .from('short_publications')
                        .select('id')
                        .eq('short_id', input.shortId)
                        .eq('platform', target.platform)
                        .eq('language', target.language)
                        .single();

                    if (existing) {
                        errors.push(
                            `Already published to ${target.platform} (${target.language})`,
                        );
                        continue;
                    }

                    // Find platform connection for this platform + language
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: connection } = await (client as any)
                        .from('platform_connections')
                        .select('id')
                        .eq('platform', target.platform)
                        .eq('language', target.language)
                        .eq('is_active', true)
                        .single();

                    // Create publication record
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data: publication, error: pubError } = await (client as any)
                        .from('short_publications')
                        .insert({
                            short_id: input.shortId,
                            platform: target.platform,
                            language: target.language,
                            platform_connection_id: connection?.id ?? null,
                            title_override: input.titleOverride,
                            caption_override: input.captionOverride,
                            hashtags_override: input.hashtagsOverride,
                            scheduled_at: input.scheduleAt ?? null,
                            status: input.scheduleAt ? 'scheduled' : 'draft',
                        })
                        .select()
                        .single();

                    if (pubError) {
                        errors.push(
                            `Failed to create publication for ${target.platform}: ${pubError.message}`,
                        );
                        continue;
                    }

                    publicationIds.push(publication.id as string);

                    // TODO: If no scheduleAt, trigger immediate upload to platform
                    // This would involve calling the platform-specific API
                    // For now, publications start in 'draft' status

                    logger.info(
                        {
                            ...ctx,
                            platform: target.platform,
                            language: target.language,
                            publicationId: publication.id,
                        },
                        'Publication record created',
                    );
                } catch (platformError) {
                    const message =
                        platformError instanceof Error
                            ? platformError.message
                            : 'Unknown error';
                    errors.push(`${target.platform} (${target.language}): ${message}`);
                }
            }

            revalidatePath('/home/[account]/studio', 'layout');

            return {
                success: errors.length === 0,
                publicationIds,
                errors,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Short publication failed');
            return { success: false, publicationIds: [], errors: [message] };
        }
    },
    {
        schema: PublishShortSchema,
    },
);

// =============================================================================
// Delete Short Action
// =============================================================================

const DeleteShortSchema = z.object({
    shortId: z.string().uuid(),
});

/**
 * Delete a short and all its publications
 */
export const deleteShortAction = enhanceAction(
    async (input: z.infer<typeof DeleteShortSchema>): Promise<{
        success: boolean;
        error?: string;
    }> => {
        const logger = await getLogger();
        const ctx = { name: 'shorts.delete', shortId: input.shortId };

        logger.info(ctx, 'Deleting short');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: deleteError } = await (client as any)
                .from('shorts')
                .delete()
                .eq('id', input.shortId);

            if (deleteError) {
                throw new Error(`Failed to delete: ${deleteError.message}`);
            }

            revalidatePath('/home/[account]/studio', 'layout');

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Delete failed');
            return { success: false, error: message };
        }
    },
    {
        schema: DeleteShortSchema,
    },
);
