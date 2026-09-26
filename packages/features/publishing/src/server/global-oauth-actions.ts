'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { encrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SAVED_CREDENTIAL_APPS, type SavedCredentialApp } from '../oauth/apps';

export interface GlobalOAuthApp {
  id: string;
  platform: SavedCredentialApp;
  clientId: string;
  createdAt: string;
  updatedAt: string;
}

const SaveGlobalOAuthAppSchema = z.object({
  platform: z.enum(SAVED_CREDENTIAL_APPS),
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

    const { error } = await client.from('oauth_app_credentials').upsert(
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
  platform: z.enum(SAVED_CREDENTIAL_APPS),
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
