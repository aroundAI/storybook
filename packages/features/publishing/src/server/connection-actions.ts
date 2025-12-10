'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection as DBPlatformConnection } from '../lib/database-types';
import { ensureValidToken } from '../lib/token-refresh';
import { disconnectMetaAction } from '../oauth/meta/disconnect';
import { disconnectTikTokAction } from '../oauth/tiktok/disconnect';
import { disconnectYouTubeAction } from '../oauth/youtube/disconnect';
import type { ConnectionStatus, PlatformType } from '../types';

/**
 * Fetches all platform connections for the current user's account
 */
export const getConnectionsAction = enhanceAction(
  async (data: { accountId: string }) => {
    const client = getSupabaseServerClient();

    const { data: connections, error } = (await client
      .from('platform_connections' as 'accounts')
      .select('*')
      .eq('account_id', data.accountId)
      .order('created_at', { ascending: false })) as {
      data: DBPlatformConnection[] | null;
      error: unknown;
    };

    if (error) {
      throw new Error('Failed to fetch connections');
    }

    return (
      connections?.map((conn) => ({
        id: conn.id,
        platform: conn.platform as PlatformType,
        platformAccountId: conn.platform_account_id ?? '',
        accountName: conn.platform_account_name ?? 'Unknown Account',
        profileImageUrl:
          conn.metadata && typeof conn.metadata === 'object'
            ? (conn.metadata as Record<string, unknown>).profile_image_url as
                | string
                | undefined
            : undefined,
        status: determineStatus(conn),
        errorMessage:
          conn.metadata && typeof conn.metadata === 'object'
            ? ((conn.metadata as Record<string, unknown>).last_error as
                | string
                | undefined)
            : undefined,
        scopes: conn.scopes ?? [],
        tokenExpiresAt: conn.token_expires_at,
        createdAt: conn.created_at,
        updatedAt: conn.updated_at,
        accountSlug: '', // Will be set by the caller
      })) ?? []
    );
  },
  {
    schema: z.object({ accountId: z.string().uuid() }),
    auth: true,
  },
);

const DisconnectSchema = z.object({
  connectionId: z.string().uuid(),
  platform: z.enum([
    'youtube',
    'tiktok',
    'instagram',
    'facebook',
    'twitter',
    'linkedin',
  ]),
});

/**
 * Disconnects a platform connection by routing to the appropriate platform-specific action
 */
export const disconnectPlatformAction = enhanceAction(
  async ({ connectionId, platform }) => {
    switch (platform) {
      case 'youtube':
        return disconnectYouTubeAction({ connectionId });
      case 'tiktok':
        return disconnectTikTokAction({ connectionId });
      case 'instagram':
      case 'facebook':
        return disconnectMetaAction({ connectionId });
      case 'twitter':
      case 'linkedin':
        // For platforms without specific disconnect logic, just delete the connection
        return deleteConnection(connectionId);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  },
  {
    schema: DisconnectSchema,
    auth: true,
  },
);

const RefreshSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Refreshes a platform connection token
 */
export const refreshConnectionAction = enhanceAction(
  async ({ connectionId }) => {
    const result = await ensureValidToken(connectionId);

    if (!result.valid) {
      throw new Error(result.error ?? 'Failed to refresh token');
    }

    return { success: true };
  },
  {
    schema: RefreshSchema,
    auth: true,
  },
);

/**
 * Determines the status of a connection based on its state
 */
function determineStatus(connection: DBPlatformConnection): ConnectionStatus {
  // Check for error in metadata
  if (
    connection.metadata &&
    typeof connection.metadata === 'object' &&
    (connection.metadata as Record<string, unknown>).last_error
  ) {
    return 'error';
  }

  // Check if token is expired
  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at);
    if (expiresAt < new Date()) {
      return 'expired';
    }
  }

  // Check if connection is inactive
  if (!connection.is_active) {
    return 'expired';
  }

  return 'active';
}

/**
 * Simple connection deletion for platforms without revocation endpoints
 */
async function deleteConnection(connectionId: string) {
  const client = getSupabaseServerClient();

  const { error } = await client
    .from('platform_connections' as 'accounts')
    .delete()
    .eq('id', connectionId);

  if (error) {
    throw new Error('Failed to delete connection');
  }

  return { success: true };
}
