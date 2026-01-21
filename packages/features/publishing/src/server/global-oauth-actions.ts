'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { encrypt, decrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { z } from 'zod';

export interface GlobalOAuthApp {
    id: string;
    platform: 'youtube' | 'tiktok' | 'meta';
    clientId: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Get all global OAuth app credentials (for super admin UI)
 * Returns apps without secrets (secrets are never exposed to client)
 */
export async function getGlobalOAuthApps(): Promise<GlobalOAuthApp[]> {
    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('oauth_app_credentials')
        .select('id, platform, client_id, created_at, updated_at')
        .order('platform');

    if (error) {
        console.error('Error fetching global OAuth apps:', error);
        return [];
    }

    return (data ?? []).map((app) => ({
        id: app.id,
        platform: app.platform as GlobalOAuthApp['platform'],
        clientId: app.client_id,
        createdAt: app.created_at,
        updatedAt: app.updated_at,
    }));
}

/**
 * Get OAuth credentials for a platform (for OAuth flow - server-side only)
 * Uses admin client to bypass RLS for OAuth callback handling
 */
export async function getGlobalOAuthCredentials(
    platform: 'youtube' | 'tiktok' | 'meta',
): Promise<{ clientId: string; clientSecret: string } | null> {
    const client = getSupabaseServerAdminClient();

    const { data, error } = await client
        .from('oauth_app_credentials')
        .select('client_id, client_secret_encrypted')
        .eq('platform', platform)
        .single();

    if (error || !data) {
        console.error(`Error fetching ${platform} OAuth credentials:`, error);
        return null;
    }

    try {
        const clientSecret = await decrypt(data.client_secret_encrypted);
        return {
            clientId: data.client_id,
            clientSecret,
        };
    } catch (e) {
        console.error(`Error decrypting ${platform} client secret:`, e);
        return null;
    }
}

const SaveGlobalOAuthAppSchema = z.object({
    platform: z.enum(['youtube', 'tiktok', 'meta']),
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client Secret is required'),
});

/**
 * Save global OAuth app credentials (super admin only)
 * Upserts credentials for a platform
 */
export const saveGlobalOAuthAppAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();
        const encryptedSecret = await encrypt(data.clientSecret);

        const { error } = await client
            .from('oauth_app_credentials')
            .upsert(
                {
                    platform: data.platform,
                    client_id: data.clientId,
                    client_secret_encrypted: encryptedSecret,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: 'platform',
                },
            );

        if (error) {
            console.error('Error saving global OAuth app:', error);
            throw new Error('Failed to save OAuth credentials');
        }

        revalidatePath('/admin/platforms');
        return { success: true };
    },
    {
        schema: SaveGlobalOAuthAppSchema,
    },
);

const DeleteGlobalOAuthAppSchema = z.object({
    platform: z.enum(['youtube', 'tiktok', 'meta']),
});

/**
 * Delete global OAuth app credentials (super admin only)
 */
export const deleteGlobalOAuthAppAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        const { error } = await client
            .from('oauth_app_credentials')
            .delete()
            .eq('platform', data.platform);

        if (error) {
            console.error('Error deleting global OAuth app:', error);
            throw new Error('Failed to delete OAuth credentials');
        }

        revalidatePath('/admin/platforms');
        return { success: true };
    },
    {
        schema: DeleteGlobalOAuthAppSchema,
    },
);
