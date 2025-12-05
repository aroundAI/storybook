'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { decrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from '../../lib/database-types';
import { YOUTUBE_OAUTH_CONFIG } from './config';

const DisconnectYouTubeSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Disconnects a YouTube account by revoking the token and removing the connection
 */
export const disconnectYouTubeAction = enhanceAction(
  async ({ connectionId }) => {
    const client = getSupabaseServerClient();

    // Get connection
    // Note: Type assertion needed until database types are regenerated
    const { data: connection, error: fetchError } = (await client
      .from('platform_connections' as 'accounts')
      .select('*')
      .eq('id', connectionId)
      .eq('platform', 'youtube')
      .single()) as { data: PlatformConnection | null; error: unknown };

    if (fetchError || !connection) {
      throw new Error('Connection not found');
    }

    // Revoke token at Google
    if (connection.access_token_encrypted) {
      try {
        const accessToken = await decrypt(connection.access_token_encrypted);
        await fetch(`${YOUTUBE_OAUTH_CONFIG.revokeUrl}?token=${accessToken}`, {
          method: 'POST',
        });
      } catch {
        // Continue even if revocation fails - token may already be invalid
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
    schema: DisconnectYouTubeSchema,
    auth: true,
  },
);
