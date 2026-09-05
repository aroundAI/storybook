'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection as DBPlatformConnection } from '../lib/database-types';
import { GetConnectedPlatformsSchema } from '../lib/schemas/publish.schema';
import { ensureValidToken } from '../lib/token-refresh';
import type { Platform } from '../lib/types';
import { disconnectMetaAction } from '../oauth/meta/disconnect';
import { disconnectTikTokAction } from '../oauth/tiktok/disconnect';
import { disconnectYouTubeAction } from '../oauth/youtube/disconnect';
import type { ConnectionStatus, PlatformType } from '../types';

// ============================================================================
// FILM-906: Platform Connections Settings Actions
// ============================================================================

/**
 * Fetches all platform connections for the current user's account
 * Used by the Platform Connections settings page
 */
export const getConnectionsAction = enhanceAction(
  async (data: { accountId: string }) => {
    const client = getSupabaseServerClient();

    const { data: connections, error } = (await client
      .from('platform_connections' as 'accounts')
      .select(
        `
        id, account_id, platform, platform_account_id, platform_account_name,
        is_active, token_expires_at, scopes, metadata, language,
        created_at, updated_at
      `,
      )
      .eq('account_id', data.accountId)
      .order('created_at', { ascending: false })) as {
      data: DBPlatformConnection[] | null;
      error: unknown;
    };

    if (error) {
      throw new Error('Failed to fetch connections');
    }

    return (
      connections?.map((conn) => {
        const connWithLanguage = conn as typeof conn & { language?: string };
        const status = determineStatus(conn);
        const profileImageUrl =
          conn.metadata && typeof conn.metadata === 'object'
            ? ((conn.metadata as Record<string, unknown>).profile_image_url as
                | string
                | undefined)
            : undefined;

        return {
          id: conn.id,
          platform: conn.platform as PlatformType,
          platformAccountId: conn.platform_account_id ?? '',
          accountName: conn.platform_account_name ?? 'Unknown Account',
          profileImageUrl,
          status,
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
          language: connWithLanguage.language ?? 'en',
          // Unified fields for Publish Page compatibility
          isActive: conn.is_active,
          tokenValid: status === 'active',
          avatarUrl: profileImageUrl, // Alias for avatarUrl
          followerCount:
            conn.metadata && typeof conn.metadata === 'object'
              ? ((conn.metadata as Record<string, unknown>).followers_count as
                  | number
                  | undefined)
              : 0,
        };
      }) ?? []
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
    let result;

    switch (platform) {
      case 'youtube':
        result = await disconnectYouTubeAction({ connectionId });
        break;
      case 'tiktok':
        result = await disconnectTikTokAction({ connectionId });
        break;
      case 'instagram':
      case 'facebook':
        result = await disconnectMetaAction({ connectionId });
        break;
      case 'twitter':
      case 'linkedin':
        result = await deleteConnection(connectionId);
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    revalidatePath(`/home/[account]/settings`, 'page');

    return result;
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
    // Force refresh to handle cases where token is valid in DB but revoked on provider
    const result = await ensureValidToken(connectionId, true);

    if (!result.valid) {
      throw new Error(result.error ?? 'Failed to refresh token');
    }

    revalidatePath(`/home/[account]/settings`, 'page');

    return { success: true };
  },
  {
    schema: RefreshSchema,
    auth: true,
  },
);

const UpdateLanguageSchema = z.object({
  connectionId: z.string().uuid(),
  language: z.string().min(2).max(5),
});

/**
 * Updates the target language for a platform connection
 * Used for automatic routing of multi-language content to language-specific channels
 */
export const updateConnectionLanguageAction = enhanceAction(
  async ({ connectionId, language }) => {
    const client = getSupabaseServerClient();

    // Type cast until migration is applied and types regenerated
    const { error } = await (
      client as unknown as {
        from: (table: string) => {
          update: (data: { language: string }) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      }
    )
      .from('platform_connections')
      .update({ language })
      .eq('id', connectionId);

    if (error) {
      throw new Error('Failed to update connection language');
    }

    revalidatePath(`/home/[account]/settings`, 'page');

    return { success: true, language };
  },
  {
    schema: UpdateLanguageSchema,
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

// ============================================================================
// FILM-708: Publish Hub Actions
// ============================================================================

/**
 * Get all connected platforms for an account
 * Used by the Publish Hub
 */
export const getConnectedPlatformsAction = enhanceAction(
  async ({ accountId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.getConnectedPlatforms', accountId };

    logger.info(ctx, 'Fetching connected platforms');

    const client = getSupabaseServerClient();

    const { data: connections, error } = await client
      .from('platform_connections')
      .select(
        `
        id, account_id, platform, platform_account_id, platform_account_name,
        is_active, token_expires_at, scopes, metadata, language,
        created_at, updated_at
      `,
      )
      .eq('account_id', accountId)
      .order('platform', { ascending: true });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch platform connections');
      throw new Error(`Failed to fetch platform connections: ${error.message}`);
    }

    // Transform to PlatformConnection type
    // Note: metadata column exists in schema but may not be in generated types yet
    // We cast to access it safely
    // We return a unified structure compatible with both Publish Page and Settings Page
    const platformConnections = (connections ?? []).map((conn) => {
      const connWithMetadata = conn as typeof conn & {
        metadata?: Record<string, unknown> | null;
        language?: string;
      };
      const metadata = connWithMetadata.metadata;
      const status = determineStatus(conn as unknown as DBPlatformConnection);

      return {
        id: conn.id,
        platform: conn.platform as Platform,
        platformAccountId: conn.platform_account_id,
        platformAccountName: conn.platform_account_name ?? '',
        avatarUrl: (metadata?.avatar_url as string) ?? null,
        isActive: conn.is_active ?? true,
        tokenValid: conn.is_active && isTokenValid(conn.token_expires_at),
        tokenExpiresAt: conn.token_expires_at ?? null,
        followerCount: (metadata?.followers_count as number) ?? null,
        scopes: conn.scopes ?? null,
        language: connWithMetadata.language ?? 'en', // Target language for this channel
        // Unified fields for Settings Page compatibility
        status,
        errorMessage: metadata?.last_error as string | undefined,
        profileImageUrl: (metadata?.avatar_url as string) ?? undefined, // Alias for avatarUrl
        accountName: conn.platform_account_name ?? '', // Alias for platformAccountName
      };
    });

    logger.info(
      { ...ctx, count: platformConnections.length },
      'Connected platforms fetched',
    );

    return platformConnections;
  },
  {
    schema: GetConnectedPlatformsSchema,
    auth: true,
  },
);

/**
 * Check if token is still valid (not expired)
 */
function isTokenValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  // Add 5 minute buffer
  const now = new Date(Date.now() + 5 * 60 * 1000);
  return expiry > now;
}

/**
 * Validate and optionally refresh a platform token
 * Returns the access token if valid, or an error
 */
export async function validatePlatformToken(connectionId: string) {
  return ensureValidToken(connectionId);
}

/**
 * Get a decrypted access token for a connection
 * Used by publish actions
 */
export async function getAccessToken(
  connectionId: string,
): Promise<
  | { accessToken: string; error?: never }
  | { accessToken?: never; error: string }
> {
  const result = await ensureValidToken(connectionId);

  if (!result.valid || !result.accessToken) {
    return {
      error: result.error ?? 'Token validation failed',
    };
  }

  return { accessToken: result.accessToken };
}
