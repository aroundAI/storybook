'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { decrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from '../../lib/database-types';
import { TWITTER_OAUTH_CONFIG } from './config';

const DisconnectTwitterSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Disconnects a Twitter/X account by revoking the token and removing the connection
 */
export const disconnectTwitterAction = enhanceAction(
  async ({ connectionId }) => {
    const client = getSupabaseServerClient();

    // Get connection
    // Note: Type assertion needed until database types are regenerated
    const { data: connection, error: fetchError } = (await client
      .from('platform_connections' as 'accounts')
      .select(`
        id, account_id, platform, platform_account_id, platform_account_name,
        access_token_encrypted, refresh_token_encrypted, is_active,
        token_expires_at, scopes, metadata, created_at, updated_at
      `)
      .eq('id', connectionId)
      .eq('platform', 'twitter')
      .single()) as { data: PlatformConnection | null; error: unknown };

    if (fetchError || !connection) {
      throw new Error('Connection not found');
    }

    // Revoke token at Twitter
    if (connection.access_token_encrypted) {
      try {
        const accessToken = await decrypt(connection.access_token_encrypted);
        const clientId = process.env.TWITTER_CLIENT_ID;
        const clientSecret = process.env.TWITTER_CLIENT_SECRET;

        if (clientId && clientSecret) {
          // Twitter requires Basic auth for token revocation
          const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
            'base64',
          );

          await fetch(TWITTER_OAUTH_CONFIG.revokeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${basicAuth}`,
            },
            body: new URLSearchParams({
              token: accessToken,
              token_type_hint: 'access_token',
            }),
          });
        }
      } catch (revokeError) {
        // Continue even if revocation fails - token may already be invalid
        // Log for observability but don't block deletion
        const logger = await getLogger();
        logger.warn(
          { name: 'oauth.twitter.disconnect', error: revokeError },
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
    schema: DisconnectTwitterSchema,
    auth: true,
  },
);
