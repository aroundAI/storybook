'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetConnectedPlatformsSchema } from '../lib/schemas/publish.schema';
import { ensureValidToken } from '../lib/token-refresh';
import type { Platform, PlatformConnection } from '../lib/types';

/**
 * Get all connected platforms for an account
 */
export const getConnectedPlatformsAction = enhanceAction(
  async ({ accountId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.getConnectedPlatforms', accountId };

    logger.info(ctx, 'Fetching connected platforms');

    const client = getSupabaseServerClient();

    const { data: connections, error } = await client
      .from('platform_connections')
      .select('*')
      .eq('account_id', accountId)
      .order('platform', { ascending: true });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch platform connections');
      throw new Error(`Failed to fetch platform connections: ${error.message}`);
    }

    // Transform to PlatformConnection type
    // Note: metadata column exists in schema but may not be in generated types yet
    // We cast to access it safely
    const platformConnections: PlatformConnection[] = (connections ?? []).map(
      (conn) => {
        const connWithMetadata = conn as typeof conn & {
          metadata?: Record<string, unknown> | null;
        };
        const metadata = connWithMetadata.metadata;
        return {
          id: conn.id,
          platform: conn.platform as Platform,
          platformAccountId: conn.platform_account_id,
          platformAccountName: conn.platform_account_name ?? '',
          avatarUrl: (metadata?.avatar_url as string) ?? null,
          isActive: conn.is_active ?? true,
          tokenValid: conn.is_active && isTokenValid(conn.token_expires_at),
          tokenExpiresAt: conn.token_expires_at ?? null,
          followerCount: (metadata?.follower_count as number) ?? null,
          scopes: conn.scopes ?? null,
        };
      },
    );

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
