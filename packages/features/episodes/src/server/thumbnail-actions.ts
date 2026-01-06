'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Schema for uploading an episode thumbnail
 */
const UploadEpisodeThumbnailSchema = z.object({
    episodeId: z.string().uuid(),
    language: z.string().min(2).max(10),
    languageLabel: z.string().max(100).optional(),
    thumbnailUrl: z.string().url(),
    fileName: z.string().max(255).optional(),
    fileSizeBytes: z.number().int().positive().optional(),
    mimeType: z.string().max(100).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    isDefault: z.boolean().optional(),
});

export type UploadEpisodeThumbnailInput = z.infer<typeof UploadEpisodeThumbnailSchema>;

/**
 * Schema for deleting an episode thumbnail
 */
const DeleteEpisodeThumbnailSchema = z.object({
    thumbnailId: z.string().uuid(),
    episodeId: z.string().uuid(),
});

export type DeleteEpisodeThumbnailInput = z.infer<typeof DeleteEpisodeThumbnailSchema>;

/**
 * Schema for getting episode thumbnails
 */
const GetEpisodeThumbnailsSchema = z.object({
    episodeId: z.string().uuid(),
});

export type GetEpisodeThumbnailsInput = z.infer<typeof GetEpisodeThumbnailsSchema>;

/**
 * Schema for setting default thumbnail
 */
const SetDefaultThumbnailSchema = z.object({
    thumbnailId: z.string().uuid(),
    episodeId: z.string().uuid(),
});

export type SetDefaultThumbnailInput = z.infer<typeof SetDefaultThumbnailSchema>;

/**
 * Episode thumbnail data type
 */
export interface EpisodeThumbnail {
    id: string;
    episodeId: string;
    language: string;
    languageLabel: string | null;
    thumbnailUrl: string;
    fileName: string | null;
    fileSizeBytes: number | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Helper: Check Episode Access
// ============================================================================

async function canEditEpisode(episodeId: string): Promise<boolean> {
    const client = getSupabaseServerClient();

    const { data } = await client
        .from('episodes')
        .select(`
            id,
            project:projects!inner(
                id,
                project_members!inner(user_id, role)
            )
        `)
        .eq('id', episodeId)
        .single();

    if (!data) return false;

    const { data: user } = await requireUser(client);
    if (!user) return false;

    // Check if user is a project member with edit rights
    const project = data.project as { project_members: Array<{ user_id: string; role: string }> };
    return project.project_members.some(
        (m) => m.user_id === user.id && ['owner', 'admin', 'member'].includes(m.role)
    );
}

// ============================================================================
// Upload Episode Thumbnail Action
// ============================================================================

/**
 * Upload or replace a thumbnail for a specific episode + language
 */
export const uploadEpisodeThumbnailAction = enhanceAction(
    async (data): Promise<{ success: boolean; thumbnail?: EpisodeThumbnail; error?: string }> => {
        const logger = await getLogger();
        const ctx = {
            name: 'thumbnail.upload',
            episodeId: data.episodeId,
            language: data.language,
        };

        logger.info(ctx, 'Uploading episode thumbnail');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized thumbnail upload attempt');
            throw new Error('Authentication required');
        }

        // Verify episode edit permission
        const canEdit = await canEditEpisode(data.episodeId);
        if (!canEdit) {
            logger.warn(ctx, 'Insufficient permissions for thumbnail upload');
            throw new Error('Insufficient permissions');
        }

        try {
            // Check if thumbnail already exists for this episode + language
            const { data: existingThumbnail } = await client
                .from('episode_thumbnails')
                .select('id, thumbnail_url')
                .eq('episode_id', data.episodeId)
                .eq('language', data.language)
                .single();

            // If replacing, delete old file from storage
            if (existingThumbnail?.thumbnail_url && existingThumbnail.thumbnail_url !== data.thumbnailUrl) {
                try {
                    const storage = getStorageAdapter(client);
                    const urlPath = new URL(existingThumbnail.thumbnail_url).pathname;
                    const storagePath = urlPath.split('/').slice(-2).join('/');
                    await storage.delete('project-assets', storagePath);
                    logger.info(ctx, 'Deleted old thumbnail from storage');
                } catch (deleteError) {
                    logger.warn({ ...ctx, error: deleteError }, 'Failed to delete old thumbnail');
                }
            }

            // If setting this as default, unset other defaults first
            if (data.isDefault) {
                await client
                    .from('episode_thumbnails')
                    .update({ is_default: false })
                    .eq('episode_id', data.episodeId)
                    .eq('is_default', true);
            }

            // Upsert thumbnail record
            const thumbnailData = {
                episode_id: data.episodeId,
                language: data.language,
                language_label: data.languageLabel || null,
                thumbnail_url: data.thumbnailUrl,
                file_name: data.fileName || null,
                file_size_bytes: data.fileSizeBytes || null,
                mime_type: data.mimeType || null,
                width: data.width || null,
                height: data.height || null,
                is_default: data.isDefault || false,
                created_by: user.id,
            };

            const { data: thumbnail, error: upsertError } = await client
                .from('episode_thumbnails')
                .upsert(thumbnailData, {
                    onConflict: 'episode_id,language',
                })
                .select()
                .single();

            if (upsertError) {
                logger.error({ ...ctx, error: upsertError }, 'Failed to upsert thumbnail');
                throw new Error(`Failed to save thumbnail: ${upsertError.message}`);
            }

            if (!thumbnail) {
                throw new Error('Failed to save thumbnail: no data returned');
            }

            logger.info(ctx, 'Episode thumbnail uploaded successfully');

            return {
                success: true,
                thumbnail: {
                    id: thumbnail.id,
                    episodeId: thumbnail.episode_id,
                    language: thumbnail.language,
                    languageLabel: thumbnail.language_label,
                    thumbnailUrl: thumbnail.thumbnail_url,
                    fileName: thumbnail.file_name,
                    fileSizeBytes: thumbnail.file_size_bytes,
                    mimeType: thumbnail.mime_type,
                    width: thumbnail.width,
                    height: thumbnail.height,
                    isDefault: thumbnail.is_default ?? false,
                    createdAt: thumbnail.created_at ?? '',
                    updatedAt: thumbnail.updated_at ?? '',
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Thumbnail upload failed');
            return { success: false, error: message };
        }
    },
    {
        schema: UploadEpisodeThumbnailSchema,
    },
);

// ============================================================================
// Delete Episode Thumbnail Action
// ============================================================================

/**
 * Delete an episode thumbnail
 */
export const deleteEpisodeThumbnailAction = enhanceAction(
    async (data): Promise<{ success: boolean; error?: string }> => {
        const logger = await getLogger();
        const ctx = {
            name: 'thumbnail.delete',
            thumbnailId: data.thumbnailId,
            episodeId: data.episodeId,
        };

        logger.info(ctx, 'Deleting episode thumbnail');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized thumbnail delete attempt');
            throw new Error('Authentication required');
        }

        // Verify episode edit permission
        const canEdit = await canEditEpisode(data.episodeId);
        if (!canEdit) {
            logger.warn(ctx, 'Insufficient permissions for thumbnail delete');
            throw new Error('Insufficient permissions');
        }

        try {
            // Fetch thumbnail for storage cleanup
            const { data: thumbnail, error: fetchError } = await client
                .from('episode_thumbnails')
                .select('thumbnail_url')
                .eq('id', data.thumbnailId)
                .eq('episode_id', data.episodeId)
                .single();

            if (fetchError || !thumbnail) {
                throw new Error('Thumbnail not found');
            }

            // Delete from storage
            if (thumbnail.thumbnail_url) {
                try {
                    const storage = getStorageAdapter(client);
                    const urlPath = new URL(thumbnail.thumbnail_url).pathname;
                    const storagePath = urlPath.split('/').slice(-2).join('/');
                    await storage.delete('project-assets', storagePath);
                    logger.info(ctx, 'Deleted thumbnail from storage');
                } catch (deleteError) {
                    logger.warn({ ...ctx, error: deleteError }, 'Failed to delete thumbnail from storage');
                }
            }

            // Delete from database
            const { error: deleteError } = await client
                .from('episode_thumbnails')
                .delete()
                .eq('id', data.thumbnailId);

            if (deleteError) {
                throw new Error(`Failed to delete thumbnail: ${deleteError.message}`);
            }

            logger.info(ctx, 'Episode thumbnail deleted successfully');

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Thumbnail delete failed');
            return { success: false, error: message };
        }
    },
    {
        schema: DeleteEpisodeThumbnailSchema,
    },
);

// ============================================================================
// Get Episode Thumbnails Action
// ============================================================================

/**
 * Get all thumbnails for an episode
 */
export const getEpisodeThumbnailsAction = enhanceAction(
    async (data): Promise<{ success: boolean; thumbnails?: EpisodeThumbnail[]; error?: string }> => {
        const logger = await getLogger();
        const ctx = {
            name: 'thumbnail.getAll',
            episodeId: data.episodeId,
        };

        logger.info(ctx, 'Fetching episode thumbnails');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized thumbnail fetch attempt');
            throw new Error('Authentication required');
        }

        try {
            const { data: thumbnails, error: fetchError } = await client
                .from('episode_thumbnails')
                .select('*')
                .eq('episode_id', data.episodeId)
                .order('language', { ascending: true });

            if (fetchError) {
                throw new Error(`Failed to fetch thumbnails: ${fetchError.message}`);
            }

            logger.info({ ...ctx, count: thumbnails?.length ?? 0 }, 'Episode thumbnails fetched');

            return {
                success: true,
                thumbnails: (thumbnails ?? []).map((t) => ({
                    id: t.id,
                    episodeId: t.episode_id,
                    language: t.language,
                    languageLabel: t.language_label,
                    thumbnailUrl: t.thumbnail_url,
                    fileName: t.file_name,
                    fileSizeBytes: t.file_size_bytes,
                    mimeType: t.mime_type,
                    width: t.width,
                    height: t.height,
                    isDefault: t.is_default ?? false,
                    createdAt: t.created_at ?? '',
                    updatedAt: t.updated_at ?? '',
                })),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Thumbnail fetch failed');
            return { success: false, error: message };
        }
    },
    {
        schema: GetEpisodeThumbnailsSchema,
    },
);

// ============================================================================
// Set Default Thumbnail Action
// ============================================================================

/**
 * Set a thumbnail as the default for an episode
 */
export const setDefaultThumbnailAction = enhanceAction(
    async (data): Promise<{ success: boolean; error?: string }> => {
        const logger = await getLogger();
        const ctx = {
            name: 'thumbnail.setDefault',
            thumbnailId: data.thumbnailId,
            episodeId: data.episodeId,
        };

        logger.info(ctx, 'Setting default thumbnail');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized default thumbnail attempt');
            throw new Error('Authentication required');
        }

        // Verify episode edit permission
        const canEdit = await canEditEpisode(data.episodeId);
        if (!canEdit) {
            logger.warn(ctx, 'Insufficient permissions for setting default');
            throw new Error('Insufficient permissions');
        }

        try {
            // Unset all other defaults for this episode
            await client
                .from('episode_thumbnails')
                .update({ is_default: false })
                .eq('episode_id', data.episodeId)
                .eq('is_default', true);

            // Set the new default
            const { error: updateError } = await client
                .from('episode_thumbnails')
                .update({ is_default: true })
                .eq('id', data.thumbnailId)
                .eq('episode_id', data.episodeId);

            if (updateError) {
                throw new Error(`Failed to set default: ${updateError.message}`);
            }

            logger.info(ctx, 'Default thumbnail set successfully');

            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Set default failed');
            return { success: false, error: message };
        }
    },
    {
        schema: SetDefaultThumbnailSchema,
    },
);

// ============================================================================
// Get Thumbnail for Language (For Publishing)
// ============================================================================

/**
 * Get the thumbnail URL for a specific episode and language
 * Falls back to: language-specific → default → episode.thumbnail_url
 * Used internally by the publishing flow
 */
export async function getThumbnailForLanguage(
    episodeId: string,
    language: string,
): Promise<string | null> {
    const client = getSupabaseServerClient();

    // Try exact language match first
    const { data: langThumbnail } = await client
        .from('episode_thumbnails')
        .select('thumbnail_url')
        .eq('episode_id', episodeId)
        .eq('language', language)
        .single();

    if (langThumbnail?.thumbnail_url) {
        return langThumbnail.thumbnail_url;
    }

    // Try default thumbnail
    const { data: defaultThumbnail } = await client
        .from('episode_thumbnails')
        .select('thumbnail_url')
        .eq('episode_id', episodeId)
        .eq('is_default', true)
        .single();

    if (defaultThumbnail?.thumbnail_url) {
        return defaultThumbnail.thumbnail_url;
    }

    // Fallback to episode's main thumbnail
    const { data: episode } = await client
        .from('episodes')
        .select('thumbnail_url')
        .eq('id', episodeId)
        .single();

    return episode?.thumbnail_url ?? null;
}
