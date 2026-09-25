'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection as DBPlatformConnection } from '../lib/database-types';
import { GetConnectedPlatformsSchema } from '../lib/schemas/publish.schema';
import { UpdateYouTubeChannelSettingsSchema } from '../lib/schemas/youtube-declaration.schema';
import { ensureValidToken } from '../lib/token-refresh';
import type { Platform } from '../lib/types';
import { resolveAnalyticsAccess } from '../oauth/analytics-scopes';
import { isRevokeConfirmed } from '../oauth/revoke-request';
import { revokeAtVendor } from '../oauth/revokers';
import type { ConnectionStatus, PlatformType } from '../types';
import { analyticsScopesEnabled } from './analytics-scope-switch';
import { resolveFollowerCounts } from './follower-counts';

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
        youtube_made_for_kids, youtube_category_id,
        disconnected_at, created_at, updated_at
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

    const followerCounts = await resolveFollowerCounts(connections ?? []);
    const purges = await latestVendorDataPurges(
      (connections ?? [])
        .filter((conn) => conn.disconnected_at)
        .map((conn) => conn.id),
    );

    const scopesEnabled = analyticsScopesEnabled();

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
          analyticsAccess: resolveAnalyticsAccess({
            platform: conn.platform,
            grantedScopes: conn.scopes,
            metadata: conn.metadata,
            scopesEnabled,
          }),
          tokenExpiresAt: conn.token_expires_at,
          disconnectedAt: conn.disconnected_at ?? null,
          vendorDataPurge: purges.get(conn.id),
          linkedAccountName: linkedMetaAccountName(conn, connections ?? []),
          createdAt: conn.created_at,
          updatedAt: conn.updated_at,
          accountSlug: '', // Will be set by the caller
          language: connWithLanguage.language ?? 'en',
          youtubeMadeForKids: conn.youtube_made_for_kids ?? null,
          youtubeCategoryId: conn.youtube_category_id ?? null,
          // Unified fields for Publish Page compatibility
          isActive: conn.is_active,
          tokenValid: status === 'active',
          avatarUrl: profileImageUrl, // Alias for avatarUrl
          ...followerCounts.get(conn.id),
        };
      }) ?? []
    );
  },
  {
    schema: z.object({ accountId: z.string().uuid() }),
    auth: true,
  },
);

const ConnectionIdSchema = z.object({
  connectionId: z.string().uuid(),
});

const CONNECTION_NOT_FOUND =
  'That connection no longer exists, or you do not have access to it.';

/**
 * The stored tokens, for the vendor revoke. Members may not read token
 * columns (KB-43), so this uses the admin client — call it only after the
 * member's own client has found the row, which is the access check. Both
 * tokens: X's revoke takes the 180-day refresh token as well as the access
 * token (KB-25).
 */
async function readConnectionTokens(connectionId: string) {
  const { data, error } = await getSupabaseServerAdminClient()
    .from('platform_connections')
    .select('access_token_encrypted, refresh_token_encrypted')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read connection token: ${error.message}`);
  }

  return {
    access_token_encrypted: data?.access_token_encrypted ?? null,
    refresh_token_encrypted: data?.refresh_token_encrypted ?? null,
  };
}

/**
 * Disconnects a platform connection (KB-22).
 *
 * Asks the platform to revoke our access, then disconnects the row with
 * `disconnect_platform_connection`: tokens wiped, row kept. Returns whether
 * the platform confirmed the revoke, so the dialog can tell the creator to
 * check at the platform when it did not (KB-45). It never deletes
 * the row — that used to cascade into the channel's publishes and everything
 * a person had attached to them. The platform is the stored one, not one the
 * caller names.
 */
export const disconnectPlatformAction = returnRefusals(
  enhanceAction(
    async ({ connectionId }) => {
      const logger = await getLogger();
      const client = getSupabaseServerClient();

      const { data: connection, error: readError } = await client
        .from('platform_connections')
        .select('id, platform, disconnected_at')
        .eq('id', connectionId)
        .maybeSingle();

      if (readError) {
        throw new Error(`Failed to read connection: ${readError.message}`);
      }

      if (!connection) {
        throw new ActionRefusal(CONNECTION_NOT_FOUND);
      }

      const platform = connection.platform as PlatformType;

      const revoke = connection.disconnected_at
        ? ({ status: 'no_token' } as const)
        : await revokeAtVendor({
            platform,
            ...(await readConnectionTokens(connection.id)),
          });

      const { data: rows, error } = await client.rpc(
        'disconnect_platform_connection',
        { p_connection_id: connectionId },
      );

      if (error) {
        throw new Error(`Failed to disconnect connection: ${error.message}`);
      }

      if (!rows || rows.length === 0) {
        throw new ActionRefusal(CONNECTION_NOT_FOUND);
      }

      const disconnected = rows
        .filter((row) => !row.already_disconnected)
        .map((row) => row.id);

      const confirmed = isRevokeConfirmed(revoke.status);

      // A revoke the platform did not confirm is a warning: the creator is
      // told to check at the platform, and an operator can find it (KB-45).
      logger[confirmed ? 'info' : 'warn'](
        {
          name: 'oauth.disconnect',
          connectionId,
          platform,
          revoke: revoke.status,
          httpStatus: 'httpStatus' in revoke ? revoke.httpStatus : undefined,
          disconnected,
        },
        confirmed
          ? 'Platform connection disconnected'
          : 'Platform connection disconnected; revoke not confirmed by the platform',
      );

      revalidatePath(`/home/[account]/settings`, 'page');

      return {
        disconnected,
        alreadyDisconnected: disconnected.length === 0,
        revoke: { status: revoke.status, confirmed },
      };
    },
    {
      schema: ConnectionIdSchema,
      auth: true,
    },
  ),
);

/**
 * How many scheduled posts are waiting on a connection, for the disconnect
 * dialog. They are not cancelled: they go out if the channel is reconnected
 * before their time, and fail if it is not.
 */
export const countScheduledPublishesAction = returnRefusals(
  enhanceAction(
    async ({ connectionId }) => {
      const client = getSupabaseServerClient();

      const { count, error } = await client
        .from('publishes')
        .select('id', { count: 'exact', head: true })
        .eq('platform_connection_id', connectionId)
        .eq('status', 'scheduled');

      if (error) {
        throw new Error(
          `Failed to count scheduled publishes: ${error.message}`,
        );
      }

      return { count: count ?? 0 };
    },
    {
      schema: ConnectionIdSchema,
      auth: true,
    },
  ),
);

const RefreshSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Force-refreshes a platform connection's token (the Refresh button).
 *
 * `ensureValidToken` reads and writes the connection with the admin client,
 * and a refresh the vendor refuses deactivates it (an X refresh also rotates
 * its refresh token). So the caller's own client must find the row first,
 * which is the access check (RLS `has_account_access`), as for disconnect
 * (KB-127).
 */
export const refreshConnectionAction = returnRefusals(
  enhanceAction(
    async ({ connectionId }) => {
      const { data: connection, error: readError } =
        await getSupabaseServerClient()
          .from('platform_connections')
          .select('id')
          .eq('id', connectionId)
          .maybeSingle();

      if (readError) {
        throw new Error(`Failed to read connection: ${readError.message}`);
      }

      if (!connection) {
        throw new ActionRefusal(CONNECTION_NOT_FOUND);
      }

      // Force refresh to handle cases where token is valid in DB but revoked on provider
      const result = await ensureValidToken(connection.id, true);

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
  ),
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
 * Records a YouTube channel's audience and category (KB-30): the creator's
 * declaration, sent with every upload to that channel. Written through the
 * user's client, so the account's own policy decides who may set it.
 */
const updateYouTubeChannelSettings = enhanceAction(
  async ({ connectionId, madeForKids, categoryId }) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('platform_connections')
      .update({
        youtube_made_for_kids: madeForKids,
        youtube_category_id: categoryId,
      })
      .eq('id', connectionId)
      .eq('platform', 'youtube')
      .select('id');

    if (error) {
      throw new Error(`Failed to update the YouTube channel: ${error.message}`);
    }

    // No row means it is not a YouTube channel this user can change; an
    // update RLS filtered out is otherwise indistinguishable from a success.
    if (!data?.length) {
      throw new ActionRefusal(
        'This YouTube channel could not be updated. Reload the page and try again.',
      );
    }

    revalidatePath(`/home/[account]/settings`, 'page');

    return { connectionId, madeForKids, categoryId };
  },
  {
    schema: UpdateYouTubeChannelSettingsSchema,
    auth: true,
  },
);

export const updateYouTubeChannelSettingsAction = returnRefusals(
  updateYouTubeChannelSettings,
);

/**
 * Determines the status of a connection based on its state
 */
function determineStatus(connection: DBPlatformConnection): ConnectionStatus {
  if (connection.disconnected_at) {
    return 'disconnected';
  }

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
 * The latest vendor-data purge of each disconnected connection (KB-22 part
 * B), for the Settings row: when the platform's statistics were, or will be,
 * deleted. Read through the user's client — members may read their own
 * account's purges.
 */
async function latestVendorDataPurges(connectionIds: string[]) {
  const latest = new Map<
    string,
    { completedAt: string | null; dueBy: string }
  >();

  if (connectionIds.length === 0) return latest;

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('vendor_data_purges')
    .select('connection_id, completed_at, due_by, requested_at')
    .in('connection_id', connectionIds)
    .order('requested_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch vendor data purges');
  }

  for (const purge of data ?? []) {
    if (!latest.has(purge.connection_id)) {
      latest.set(purge.connection_id, {
        completedAt: purge.completed_at,
        dueBy: purge.due_by,
      });
    }
  }

  return latest;
}

/**
 * The Instagram account or Facebook Page that shares this connection's
 * Facebook login, and is disconnected with it — the same pairing
 * `disconnect_platform_connection` applies.
 */
function linkedMetaAccountName(
  connection: DBPlatformConnection,
  connections: DBPlatformConnection[],
): string | undefined {
  const linkedPageId = (connection: DBPlatformConnection) =>
    connection.metadata && typeof connection.metadata === 'object'
      ? (connection.metadata as { linked_page_id?: unknown }).linked_page_id
      : undefined;

  const linked = connections.filter((other) => {
    if (other.id === connection.id || other.disconnected_at) return false;

    if (connection.platform === 'instagram') {
      return (
        other.platform === 'facebook' &&
        other.platform_account_id === linkedPageId(connection)
      );
    }

    if (connection.platform === 'facebook') {
      return (
        other.platform === 'instagram' &&
        linkedPageId(other) === connection.platform_account_id
      );
    }

    return false;
  });

  const names = linked
    .map((other) => other.platform_account_name)
    .filter((name): name is string => Boolean(name));

  return names.length > 0 ? names.join(', ') : undefined;
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
        youtube_made_for_kids, youtube_category_id,
        created_at, updated_at
      `,
      )
      .eq('account_id', accountId)
      // A disconnected channel is history, not somewhere to publish (KB-22).
      .is('disconnected_at', null)
      .order('platform', { ascending: true });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch platform connections');
      throw new Error(`Failed to fetch platform connections: ${error.message}`);
    }

    // Transform to PlatformConnection type
    // Note: metadata column exists in schema but may not be in generated types yet
    // We cast to access it safely
    // We return a unified structure compatible with both Publish Page and Settings Page
    const followerCounts = await resolveFollowerCounts(
      (connections ?? []) as Array<{
        id: string;
        created_at: string | null;
        metadata?: Record<string, unknown> | null;
      }>,
    );

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
        ...followerCounts.get(conn.id),
        scopes: conn.scopes ?? null,
        language: connWithMetadata.language ?? 'en', // Target language for this channel
        youtubeMadeForKids: conn.youtube_made_for_kids,
        youtubeCategoryId: conn.youtube_category_id,
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
