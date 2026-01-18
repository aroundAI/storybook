'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { decrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from '../../lib/database-types';
import { META_OAUTH_CONFIG } from './config';

const DisconnectMetaSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Disconnects a Meta (Facebook/Instagram) account by revoking permissions
 * and removing the connection. Also handles linked Instagram-Page cleanup.
 */
export const disconnectMetaAction = enhanceAction(
  async ({ connectionId }) => {
    const logger = await getLogger();
    const ctx = { name: 'oauth.meta.disconnect', connectionId };

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
      .single()) as { data: PlatformConnection | null; error: unknown };

    if (fetchError || !connection) {
      throw new Error('Connection not found');
    }

    // Verify it's a Meta platform
    if (
      connection.platform !== 'facebook' &&
      connection.platform !== 'instagram'
    ) {
      throw new Error('Invalid platform for Meta disconnect');
    }

    // Revoke permissions at Meta
    if (connection.access_token_encrypted) {
      try {
        const accessToken = await decrypt(connection.access_token_encrypted);
        await fetch(
          `${META_OAUTH_CONFIG.graphUrl}/me/permissions?access_token=${accessToken}`,
          { method: 'DELETE' },
        );
      } catch (revokeError) {
        // Continue even if revocation fails - token may already be invalid
        logger.warn(
          { ...ctx, error: revokeError },
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

    // If Instagram, also delete related Facebook connection if same page
    if (
      connection.platform === 'instagram' &&
      connection.metadata &&
      typeof connection.metadata === 'object' &&
      'linked_page_id' in connection.metadata
    ) {
      const linkedPageId = connection.metadata.linked_page_id as string;
      await client
        .from('platform_connections' as 'accounts')
        .delete()
        .eq('account_id', connection.account_id)
        .eq('platform', 'facebook')
        .eq('platform_account_id', linkedPageId);
    }

    // If Facebook, also delete related Instagram connection linked to this page
    if (connection.platform === 'facebook') {
      // Delete Instagram connections that are linked to this Facebook page
      const { data: linkedInstagram } = (await client
        .from('platform_connections' as 'accounts')
        .select('id')
        .eq('account_id', connection.account_id)
        .eq('platform', 'instagram')) as {
        data: Array<{ id: string; metadata?: Record<string, unknown> }> | null;
      };

      if (linkedInstagram) {
        for (const ig of linkedInstagram) {
          // We can't filter by metadata in the query, so check manually
          // This is a limitation - in production you might want a proper JSONB query
          const { data: igConnection } = (await client
            .from('platform_connections' as 'accounts')
            .select(
              `
              id, account_id, platform, platform_account_id, platform_account_name,
              access_token_encrypted, is_active, metadata, created_at, updated_at
            `,
            )
            .eq('id', ig.id)
            .single()) as { data: PlatformConnection | null };

          if (
            igConnection?.metadata &&
            typeof igConnection.metadata === 'object' &&
            'linked_page_id' in igConnection.metadata &&
            igConnection.metadata.linked_page_id ===
              connection.platform_account_id
          ) {
            await client
              .from('platform_connections' as 'accounts')
              .delete()
              .eq('id', ig.id);
          }
        }
      }
    }

    logger.info(ctx, 'Meta connection disconnected successfully');
    return { success: true };
  },
  {
    schema: DisconnectMetaSchema,
    auth: true,
  },
);
