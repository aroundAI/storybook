'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Types
// =============================================================================

export interface EpisodePublishingConfig {
    id: string;
    episodeId: string;
    platformConnectionId: string;
    language: string;
    titleOverride: string | null;
    descriptionOverride: string | null;
    tagsOverride: string[] | null;
    thumbnailOverrideUrl: string | null;
    publishImmediately: boolean;
    scheduledPublishAt: string | null;
    isEnabled: boolean;
    lastPublishedAt: string | null;
    lastPublishedVideoId: string | null;
    // Joined from platform_connections
    platform?: string;
    platformAccountName?: string;
}

export interface PlatformConnection {
    id: string;
    platform: string;
    platformAccountId: string | null;
    platformAccountName: string | null;
    language: string | null;
    isActive: boolean;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get all publishing configs for an episode
 */
export async function getEpisodePublishingConfigs(
    episodeId: string,
): Promise<EpisodePublishingConfig[]> {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
        .from('episode_publishing_configs')
        .select(
            `
      id,
      episode_id,
      platform_connection_id,
      language,
      title_override,
      description_override,
      tags_override,
      thumbnail_override_url,
      publish_immediately,
      scheduled_publish_at,
      is_enabled,
      last_published_at,
      last_published_video_id,
      platform_connections!inner (
        platform,
        platform_account_name
      )
    `,
        )
        .eq('episode_id', episodeId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to fetch configs: ${error.message}`);
    }

    return (data ?? []).map(
        (row: {
            id: string;
            episode_id: string;
            platform_connection_id: string;
            language: string;
            title_override: string | null;
            description_override: string | null;
            tags_override: string[] | null;
            thumbnail_override_url: string | null;
            publish_immediately: boolean;
            scheduled_publish_at: string | null;
            is_enabled: boolean;
            last_published_at: string | null;
            last_published_video_id: string | null;
            platform_connections: {
                platform: string;
                platform_account_name: string | null;
            };
        }) => ({
            id: row.id,
            episodeId: row.episode_id,
            platformConnectionId: row.platform_connection_id,
            language: row.language,
            titleOverride: row.title_override,
            descriptionOverride: row.description_override,
            tagsOverride: row.tags_override,
            thumbnailOverrideUrl: row.thumbnail_override_url,
            publishImmediately: row.publish_immediately,
            scheduledPublishAt: row.scheduled_publish_at,
            isEnabled: row.is_enabled,
            lastPublishedAt: row.last_published_at,
            lastPublishedVideoId: row.last_published_video_id,
            platform: row.platform_connections?.platform,
            platformAccountName: row.platform_connections?.platform_account_name,
        }),
    );
}

/**
 * Get all platform connections for an account
 */
export async function getAccountPlatformConnections(
    accountId: string,
): Promise<PlatformConnection[]> {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
        .from('platform_connections')
        .select(
            `
      id,
      platform,
      platform_account_id,
      platform_account_name,
      language,
      is_active
    `,
        )
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('platform', { ascending: true });

    if (error) {
        throw new Error(`Failed to fetch connections: ${error.message}`);
    }

    return (data ?? []).map(
        (row: {
            id: string;
            platform: string;
            platform_account_id: string | null;
            platform_account_name: string | null;
            language: string | null;
            is_active: boolean;
        }) => ({
            id: row.id,
            platform: row.platform,
            platformAccountId: row.platform_account_id,
            platformAccountName: row.platform_account_name,
            language: row.language,
            isActive: row.is_active,
        }),
    );
}

// =============================================================================
// Actions
// =============================================================================

const UpdateEpisodePublishingConfigSchema = z.object({
    episodeId: z.string().uuid(),
    configs: z.array(
        z.object({
            id: z.string().uuid().optional(), // Existing config ID
            platformConnectionId: z.string().uuid(),
            language: z.enum(['en', 'hi', 'es', 'pt']),
            isEnabled: z.boolean(),
            titleOverride: z.string().max(200).optional().nullable(),
            descriptionOverride: z.string().optional().nullable(),
            tagsOverride: z.array(z.string()).optional().nullable(),
            publishImmediately: z.boolean().optional(),
            scheduledPublishAt: z.string().datetime().optional().nullable(),
        }),
    ),
});

/**
 * Update publishing configs for an episode
 * - Creates new configs
 * - Updates existing configs
 * - Deletes removed configs
 */
export const updateEpisodePublishingConfigsAction = enhanceAction(
    async (
        input: z.infer<typeof UpdateEpisodePublishingConfigSchema>,
    ): Promise<{ success: boolean; error?: string }> => {
        const logger = await getLogger();
        const ctx = { name: 'publishing.updateConfigs', episodeId: input.episodeId };

        logger.info(ctx, 'Updating episode publishing configs');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        try {
            // Get existing configs
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existing } = await (client as any)
                .from('episode_publishing_configs')
                .select('id, platform_connection_id, language')
                .eq('episode_id', input.episodeId);

            const existingIds = new Set((existing ?? []).map((e: { id: string }) => e.id));
            const inputIds = new Set(input.configs.filter((c) => c.id).map((c) => c.id));

            // Delete removed configs
            const toDelete = [...existingIds].filter((id) => !inputIds.has(id));
            if (toDelete.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any)
                    .from('episode_publishing_configs')
                    .delete()
                    .in('id', toDelete);
            }

            // Upsert configs
            for (const config of input.configs) {
                if (config.id && existingIds.has(config.id)) {
                    // Update existing
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (client as any)
                        .from('episode_publishing_configs')
                        .update({
                            platform_connection_id: config.platformConnectionId,
                            language: config.language,
                            is_enabled: config.isEnabled,
                            title_override: config.titleOverride ?? null,
                            description_override: config.descriptionOverride ?? null,
                            tags_override: config.tagsOverride ?? null,
                            publish_immediately: config.publishImmediately ?? false,
                            scheduled_publish_at: config.scheduledPublishAt ?? null,
                        })
                        .eq('id', config.id);
                } else {
                    // Insert new
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (client as any).from('episode_publishing_configs').insert({
                        episode_id: input.episodeId,
                        platform_connection_id: config.platformConnectionId,
                        language: config.language,
                        is_enabled: config.isEnabled,
                        title_override: config.titleOverride ?? null,
                        description_override: config.descriptionOverride ?? null,
                        tags_override: config.tagsOverride ?? null,
                        publish_immediately: config.publishImmediately ?? false,
                        scheduled_publish_at: config.scheduledPublishAt ?? null,
                    });
                }
            }

            logger.info(
                { ...ctx, configCount: input.configs.length },
                'Configs updated successfully',
            );

            revalidatePath('/home/[account]/studio', 'layout');

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Failed to update configs');
            return { success: false, error: message };
        }
    },
    {
        schema: UpdateEpisodePublishingConfigSchema,
    },
);

// =============================================================================
// Toggle Single Config
// =============================================================================

const ToggleConfigSchema = z.object({
    configId: z.string().uuid(),
    isEnabled: z.boolean(),
});

export const togglePublishingConfigAction = enhanceAction(
    async (
        input: z.infer<typeof ToggleConfigSchema>,
    ): Promise<{ success: boolean }> => {
        const client = getSupabaseServerClient();
        const { error: authError } = await requireUser(client);

        if (authError) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (client as any)
            .from('episode_publishing_configs')
            .update({ is_enabled: input.isEnabled })
            .eq('id', input.configId);

        if (error) {
            throw new Error(`Failed to toggle: ${error.message}`);
        }

        revalidatePath('/home/[account]/studio', 'layout');

        return { success: true };
    },
    {
        schema: ToggleConfigSchema,
    },
);
