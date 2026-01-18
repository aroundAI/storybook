'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { decrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from '../../lib/database-types';
import { TIKTOK_OAUTH_CONFIG } from './config';

const DisconnectTikTokSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Disconnects a TikTok account by revoking the token and removing the connection
 */
export const disconnectTikTokAction = enhanceAction(
  async ({ connectionId }) => {
    const client = getSupabaseServerClient();

    // Get connection
    // Note: Type assertion needed until database types are regenerated
    const { data: connection, error: fetchError } = (await client
      .from('platform_connections' as 'accounts')
      .select(
        `
        id, account_id, platform, platform_account_id, platform_account_name,
        access_token_encrypted, refresh_token_encrypted, is_active,
        token_expires_at, scopes, metadata, created_at, updated_at
      `,
      )
      .eq('id', connectionId)
      .eq('platform', 'tiktok')
      .single()) as { data: PlatformConnection | null; error: unknown };

    if (fetchError || !connection) {
      throw new Error('Connection not found');
    }

    // Revoke token at TikTok
    if (connection.access_token_encrypted) {
      try {
        const accessToken = await decrypt(connection.access_token_encrypted);
        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

        if (clientKey && clientSecret) {
          await fetch(TIKTOK_OAUTH_CONFIG.revokeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_key: clientKey,
              client_secret: clientSecret,
              token: accessToken,
            }),
          });
        }
      } catch (revokeError) {
        // Continue even if revocation fails - token may already be invalid
        // Log for observability but don't block deletion
        const logger = await getLogger();
        logger.warn(
          { name: 'oauth.tiktok.disconnect', error: revokeError },
          'Token revocation failed (continuing with deletion)',
        );
      }
    }

    // Delete connection
    const { error: deleteError } = await client
      .from('platform_connections' as 'accounts')
      .delete()
      .eq('id', connectionId);

    if (deleteError) {
      throw new Error('Failed to delete connection');
    }

    return { success: true };
  },
  {
    schema: DisconnectTikTokSchema,
    auth: true,
  },
);
