'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { decrypt, encrypt } from '@kit/shared/crypto';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * OAuth App credential for an account
 */
export interface AccountOAuthApp {
    id: string;
    accountId: string;
    platform: 'youtube' | 'tiktok' | 'meta';
    clientId: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Get OAuth app credentials for an account and platform
 */
export async function getAccountOAuthApp(
    accountId: string,
    platform: 'youtube' | 'tiktok' | 'meta',
): Promise<{ clientId: string; clientSecret: string } | null> {
    // Use admin client to bypass RLS (API routes may not have user context)
    const client = getSupabaseServerAdminClient();

    console.log('[getAccountOAuthApp] Looking up credentials:', { accountId, platform });

    const { data, error } = await client
        .from('account_oauth_apps')
        .select('client_id, client_secret_encrypted')
        .eq('account_id', accountId)
        .eq('platform', platform)
        .single();

    console.log('[getAccountOAuthApp] Query result:', { found: !!data, error: error?.message });

    if (error || !data) {
        return null;
    }

    const clientSecret = await decrypt(data.client_secret_encrypted);

    return {
        clientId: data.client_id,
        clientSecret,
    };
}

/**
 * Get all OAuth apps for an account
 */
export async function getAccountOAuthApps(
    accountId: string,
): Promise<AccountOAuthApp[]> {
    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('account_oauth_apps')
        .select('id, account_id, platform, client_id, created_at, updated_at')
        .eq('account_id', accountId);

    if (error || !data) {
        return [];
    }

    return data.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        platform: row.platform as 'youtube' | 'tiktok' | 'meta',
        clientId: row.client_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

/**
 * Save OAuth app credentials for an account
 */
const SaveOAuthAppSchema = z.object({
    accountId: z.string().uuid(),
    platform: z.enum(['youtube', 'tiktok', 'meta']),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
});

export const saveAccountOAuthAppAction = enhanceAction(
    async ({ accountId, platform, clientId, clientSecret }) => {
        const client = getSupabaseServerClient();

        // Encrypt the secret before storing
        const encryptedSecret = await encrypt(clientSecret);

        const { error } = await client
            .from('account_oauth_apps')
            .upsert(
                {
                    account_id: accountId,
                    platform,
                    client_id: clientId,
                    client_secret_encrypted: encryptedSecret,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: 'account_id,platform',
                },
            );

        if (error) {
            throw new Error('Failed to save OAuth app credentials');
        }

        return { success: true };
    },
    {
        schema: SaveOAuthAppSchema,
        auth: true,
    },
);

/**
 * Delete OAuth app credentials for an account
 */
const DeleteOAuthAppSchema = z.object({
    accountId: z.string().uuid(),
    platform: z.enum(['youtube', 'tiktok', 'meta']),
});

export const deleteAccountOAuthAppAction = enhanceAction(
    async ({ accountId, platform }) => {
        const client = getSupabaseServerClient();

        const { error } = await client
            .from('account_oauth_apps')
            .delete()
            .eq('account_id', accountId)
            .eq('platform', platform);

        if (error) {
            throw new Error('Failed to delete OAuth app credentials');
        }

        return { success: true };
    },
    {
        schema: DeleteOAuthAppSchema,
        auth: true,
    },
);
