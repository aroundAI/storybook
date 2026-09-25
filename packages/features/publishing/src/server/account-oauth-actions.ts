'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { encrypt } from '@kit/shared/crypto';
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

    const { error } = await client.from('account_oauth_apps').upsert(
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

const deleteAccountOAuthApp = enhanceAction(
  async ({ accountId, platform }) => {
    const client = getSupabaseServerClient();

    const { data: deleted, error } = await client
      .from('account_oauth_apps')
      .delete()
      .eq('account_id', accountId)
      .eq('platform', platform)
      .select('id');

    if (error) {
      throw new Error('Failed to delete OAuth app credentials');
    }

    // RLS filters a refused delete to no rows, without an error (KB-61)
    requireAffectedRows(
      deleted,
      "The app credentials weren't deleted: they're already gone, or you can't delete them. Reload the page.",
    );

    return { success: true };
  },
  {
    schema: DeleteOAuthAppSchema,
    auth: true,
  },
);

export const deleteAccountOAuthAppAction = returnRefusals(
  deleteAccountOAuthApp,
);
