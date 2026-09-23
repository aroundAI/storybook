import 'server-only';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { META_GRAPH_BASE, META_OAUTH_TOKEN_URL } from '@kit/shared/vendors';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import type { OAuthApp } from '../oauth/apps';
import { LINKEDIN_OAUTH_CONFIG } from '../oauth/linkedin/config';
import { TIKTOK_OAUTH_CONFIG } from '../oauth/tiktok/config';
import { YOUTUBE_OAUTH_CONFIG } from '../oauth/youtube/config';
import {
  AppNotConfiguredError,
  type OAuthAppCredentials,
  describeCredentialSource,
  getOAuthAppCredentials,
} from '../server/oauth-app-credentials';
import type { PlatformConnection } from './database-types';

/**
 * Result of a token refresh operation
 */
export interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

/**
 * Result of token validation/refresh attempt
 */
export interface TokenValidationResult {
  valid: boolean;
  accessToken?: string;
  error?:
    | 'EXPIRED'
    | 'REFRESH_FAILED'
    | 'CONNECTION_INACTIVE'
    | 'NOT_FOUND'
    | 'NO_REFRESH_TOKEN'
    /** An operator fault: the connection is left active (KB-29). */
    | 'APP_NOT_CONFIGURED';
  requiresReauth?: boolean;
}

/**
 * Supported publishing platforms
 */
export type Platform =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'linkedin';

/**
 * The OAuth app each platform's tokens were minted by. Exhaustive, so a
 * platform added to `Platform` does not compile until it is mapped (KB-15).
 */
const PLATFORM_APP: Record<Platform, OAuthApp> = {
  youtube: 'youtube',
  tiktok: 'tiktok',
  instagram: 'meta',
  facebook: 'meta',
  linkedin: 'linkedin',
};

/**
 * Buffer time before expiry to trigger refresh (5 minutes)
 */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * In-memory map to track in-flight token refresh operations.
 * Prevents race conditions when multiple concurrent requests try to refresh the same token.
 */
const inFlightRefreshes = new Map<string, Promise<TokenValidationResult>>();

/**
 * Ensures a valid access token is available for the connection.
 * Refreshes if needed, marks inactive if refresh fails.
 * Uses deduplication to prevent race conditions on concurrent refresh attempts.
 *
 * @param connectionId The platform connection ID
 * @param force Force a refresh even if the token is not expired (default: false)
 * @returns TokenValidationResult with valid access token or error
 */
export async function ensureValidToken(
  connectionId: string,
  force: boolean = false,
): Promise<TokenValidationResult> {
  // Check if a refresh is already in progress for this connection
  const inFlight = inFlightRefreshes.get(connectionId);
  if (inFlight) {
    // Wait for the existing refresh to complete
    return inFlight;
  }

  // Start the refresh and track it
  const refreshPromise = doEnsureValidToken(connectionId, force);
  inFlightRefreshes.set(connectionId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    // Clean up after refresh completes (success or failure)
    inFlightRefreshes.delete(connectionId);
  }
}

/**
 * Internal implementation of token validation/refresh.
 * Separated to allow deduplication wrapper.
 */
async function doEnsureValidToken(
  connectionId: string,
  force: boolean,
): Promise<TokenValidationResult> {
  const client = getSupabaseServerAdminClient();

  // 1. Fetch connection
  // Note: Type assertion needed until database types are regenerated
  const { data: connection, error } = (await client
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

  if (error || !connection) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'CONNECTION_INACTIVE', requiresReauth: true };
  }

  // Check for distributed lock via metadata
  const metadata = (connection.metadata as Record<string, unknown>) || {};
  const isRefreshing = metadata.is_refreshing === true;
  const refreshStartedAt = metadata.refresh_started_at
    ? new Date(metadata.refresh_started_at as string)
    : null;
  const now = new Date();

  // If locked and less than 2 minutes old, wait and retry
  if (
    isRefreshing &&
    refreshStartedAt &&
    now.getTime() - refreshStartedAt.getTime() < 2 * 60 * 1000
  ) {
    await sleep(2000); // Wait 2s
    return ensureValidToken(connectionId, force); // Recurse/Retry
  }

  // 2. Check if token is still valid with buffer (unless forced)
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;

  const needsRefresh =
    force ||
    !expiresAt ||
    expiresAt.getTime() - now.getTime() < EXPIRY_BUFFER_MS;

  if (!needsRefresh && connection.access_token_encrypted) {
    // Token still valid
    const accessToken = await decrypt(connection.access_token_encrypted);
    return { valid: true, accessToken };
  }

  // 3. Check if we have a refresh token
  if (!connection.refresh_token_encrypted) {
    await markConnectionInactive(connectionId);
    return { valid: false, error: 'NO_REFRESH_TOKEN', requiresReauth: true };
  }

  // 3b. Acquire Optimistic Lock
  // Attempt to set is_refreshing=true, relying on updated_at to ensure we are the only one
  const lockMetadata = {
    ...metadata,
    is_refreshing: true,
    refresh_started_at: new Date().toISOString(),
  };

  const { data: lockResult, error: lockError } = await client
    .from('platform_connections' as 'accounts')
    .update({
      metadata: lockMetadata,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', connectionId)
    .eq('updated_at', connection.updated_at) // Optimistic Lock
    .select();

  // If lock failed (race condition), retry
  if (lockError || !lockResult || lockResult.length === 0) {
    await sleep(1000);
    return ensureValidToken(connectionId, force);
  }

  // 4. Attempt refresh
  try {
    const refreshToken = await decrypt(connection.refresh_token_encrypted);
    const refreshed = await refreshTokenForPlatform(
      connection.platform as Platform,
      refreshToken,
      {
        accountId: connection.account_id,
        platformAccountId: connection.platform_account_id ?? '',
        metadata: connection.metadata as Record<string, unknown>,
      },
    );

    // 5. Update stored tokens & Release Lock & Clear Errors
    const cleanMetadata = { ...metadata };
    delete cleanMetadata.is_refreshing;
    delete cleanMetadata.refresh_started_at;
    delete cleanMetadata.last_error; // Fix: Clear stale errors

    const updateData: Record<string, string | boolean | object> = {
      access_token_encrypted: await encrypt(refreshed.accessToken),
      token_expires_at: refreshed.expiresAt.toISOString(),
      metadata: cleanMetadata,
      updated_at: new Date().toISOString(),
    };

    // Only update refresh token if a new one was provided
    if (refreshed.refreshToken) {
      updateData.refresh_token_encrypted = await encrypt(
        refreshed.refreshToken,
      );
    }

    await client
      .from('platform_connections' as 'accounts')
      .update(updateData as Record<string, unknown>)
      .eq('id', connectionId);

    return { valid: true, accessToken: refreshed.accessToken };
  } catch (refreshError) {
    const logger = await getLogger();

    // Missing app credentials are the operator's to fix, and fixing them
    // should restore every connection - so none is torn down over it.
    if (refreshError instanceof AppNotConfiguredError) {
      await releaseRefreshLock(connectionId);
      logger.error(
        {
          name: 'token-refresh',
          platform: connection.platform,
          accountId: connection.account_id,
          app: refreshError.app,
          credentialSource: describeCredentialSource(refreshError.app),
        },
        `${refreshError.message}; ${connection.platform} connection left active`,
      );

      return {
        valid: false,
        error: 'APP_NOT_CONFIGURED',
        requiresReauth: false,
      };
    }

    const app = PLATFORM_APP[connection.platform as Platform];
    logger.error(
      {
        name: 'token-refresh',
        platform: connection.platform,
        ...(app && { app, credentialSource: describeCredentialSource(app) }),
        error: refreshError,
      },
      `Failed to refresh ${connection.platform}`,
    );

    // Release lock even on error (but keep is_active=false marking logic)
    // We could clear is_refreshing here before marking inactive, but markConnectionInactive overwrites updated_at anyway.
    // However, markConnectionInactive doesn't clear metadata.is_refreshing.
    // We should clear it to avoid stuck locks if we ever reactivate it manually without full auth.

    // 6. Mark connection as inactive
    await markConnectionInactive(connectionId);

    // 7. Send notification to user
    await sendReauthNotification(
      connection.account_id,
      connection.platform as Platform,
    );

    return {
      valid: false,
      error: 'REFRESH_FAILED',
      requiresReauth: true,
    };
  }
}

/**
 * Marks a connection as inactive and clears lock
 */
async function markConnectionInactive(connectionId: string): Promise<void> {
  await releaseRefreshLock(connectionId, { is_active: false });
}

/**
 * Clears the refresh lock from a connection's metadata, applying `changes`
 * in the same update.
 */
async function releaseRefreshLock(
  connectionId: string,
  changes: Record<string, unknown> = {},
): Promise<void> {
  const client = getSupabaseServerAdminClient();

  // First fetch current metadata to remove lock flags
  const { data: current } = (await client
    .from('platform_connections' as 'accounts')
    .select('metadata')
    .eq('id', connectionId)
    .single()) as {
    data: { metadata: Record<string, unknown> } | null;
    error: unknown;
  };

  const metadata = current?.metadata || {};
  const cleanMetadata = { ...metadata };
  delete cleanMetadata.is_refreshing;
  delete cleanMetadata.refresh_started_at;

  await client
    .from('platform_connections' as 'accounts')
    .update({
      ...changes,
      metadata: cleanMetadata,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', connectionId);
}

/**
 * Context for platform token refresh (needed for Meta to fetch Page tokens)
 */
interface RefreshContext {
  accountId: string;
  platformAccountId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Platform-specific token refresh implementations. The app credentials come
 * from the same lookup connect and the callback use (KB-29).
 */
async function refreshTokenForPlatform(
  platform: Platform,
  refreshToken: string,
  context: RefreshContext,
): Promise<TokenRefreshResult> {
  const app = PLATFORM_APP[platform];

  if (!app) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const credentials = await getOAuthAppCredentials(app);

  if (!credentials) {
    throw new AppNotConfiguredError(app);
  }

  switch (platform) {
    case 'youtube':
      return refreshYouTubeToken(refreshToken, credentials);
    case 'tiktok':
      return refreshTikTokToken(refreshToken, credentials);
    case 'instagram':
    case 'facebook':
      return refreshMetaToken(refreshToken, platform, credentials, context);
    case 'linkedin':
      return refreshLinkedInToken(refreshToken, credentials);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Refreshes a YouTube OAuth token
 */
async function refreshYouTubeToken(
  refreshToken: string,
  oauthApp: OAuthAppCredentials,
): Promise<TokenRefreshResult> {
  const response = await fetch(YOUTUBE_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthApp.clientId,
      client_secret: oauthApp.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `YouTube refresh failed: ${error.error_description ?? error.error ?? 'Unknown error'}`,
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // YouTube may return new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Refreshes a TikTok OAuth token
 */
async function refreshTikTokToken(
  refreshToken: string,
  oauthApp: OAuthAppCredentials,
): Promise<TokenRefreshResult> {
  const response = await fetch(TIKTOK_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: oauthApp.clientId,
      client_secret: oauthApp.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('TikTok refresh failed');
  }

  const data = await response.json();

  if (data.error || !data.access_token) {
    throw new Error(
      `TikTok refresh failed: ${data.error_description || data.error}`,
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // TikTok always returns new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Refreshes a Meta (Instagram/Facebook) OAuth token
 * Meta uses long-lived User tokens that need to be exchanged before expiry.
 * After refreshing the User token, we fetch a fresh Page Access Token.
 */
async function refreshMetaToken(
  userAccessToken: string,
  platform: 'instagram' | 'facebook',
  oauthApp: OAuthAppCredentials,
  context: RefreshContext,
): Promise<TokenRefreshResult> {
  // Step 1: Refresh the User Access Token
  const refreshUrl = new URL(META_OAUTH_TOKEN_URL);
  refreshUrl.searchParams.set('grant_type', 'fb_exchange_token');
  refreshUrl.searchParams.set('client_id', oauthApp.clientId);
  refreshUrl.searchParams.set('client_secret', oauthApp.clientSecret);
  refreshUrl.searchParams.set('fb_exchange_token', userAccessToken);

  const refreshResponse = await fetch(refreshUrl.toString());
  const refreshData = await refreshResponse.json();

  if (refreshData.error || !refreshData.access_token) {
    throw new Error(
      `Meta user token refresh failed: ${refreshData.error?.message || 'Unknown error'}`,
    );
  }

  const newUserToken = refreshData.access_token;
  const expiresAt = new Date(
    Date.now() + (refreshData.expires_in ?? 5184000) * 1000,
  );

  // Step 2: Fetch fresh Page Access Token using the refreshed User token
  // For Instagram, use linked_page_id from metadata; for Facebook, use platformAccountId
  const pageId =
    platform === 'instagram'
      ? (context.metadata?.linked_page_id as string) ||
        context.platformAccountId
      : context.platformAccountId;

  if (!pageId) {
    // Fallback: If no page ID, return user token (will likely fail on publish)
    const logger = await getLogger();
    logger.warn(
      { name: 'token-refresh.meta', platform, accountId: context.accountId },
      'No page ID found in context, returning user token (may lack publish permissions)',
    );
    return {
      accessToken: newUserToken,
      expiresAt,
    };
  }

  // Fetch pages to get fresh Page Access Token
  const pagesUrl = new URL(`${META_GRAPH_BASE}/me/accounts`);
  pagesUrl.searchParams.set('access_token', newUserToken);
  pagesUrl.searchParams.set('fields', 'id,access_token');

  const pagesResponse = await fetch(pagesUrl.toString());
  const pagesData = await pagesResponse.json();

  if (pagesData.error) {
    throw new Error(`Failed to fetch pages: ${pagesData.error.message}`);
  }

  const pages = pagesData.data || [];
  const page = pages.find(
    (p: { id: string; access_token: string }) => p.id === pageId,
  );

  if (!page?.access_token) {
    throw new Error(
      `Page ${pageId} not found or no access token. User may need to re-authorize.`,
    );
  }

  // Return Page Access Token (for API calls) and new User Token (for next refresh)
  return {
    accessToken: page.access_token,
    refreshToken: newUserToken, // Store refreshed user token for next cycle
    expiresAt,
  };
}

/**
 * Refreshes a LinkedIn OAuth token
 */
async function refreshLinkedInToken(
  refreshToken: string,
  oauthApp: OAuthAppCredentials,
): Promise<TokenRefreshResult> {
  const response = await fetch(LINKEDIN_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauthApp.clientId,
      client_secret: oauthApp.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `LinkedIn refresh failed: ${error.error_description ?? error.error ?? 'Unknown error'}`,
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('LinkedIn refresh failed: No access token returned');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // LinkedIn may return new refresh token
    // LinkedIn access tokens expire in 60 days (5184000 seconds)
    expiresAt: new Date(Date.now() + (data.expires_in ?? 5184000) * 1000),
  };
}

/**
 * Formats platform name for display
 */
export function formatPlatformName(platform: Platform | string): string {
  const names: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
  };
  return names[platform] ?? platform;
}

/**
 * Sends a notification to the user when re-authentication is required.
 * This is a stub - integrate with your notification system.
 */
async function sendReauthNotification(
  accountId: string,
  platform: Platform,
): Promise<void> {
  const logger = await getLogger();
  const ctx = { name: 'token-refresh.reauth', accountId, platform };

  // Log for now - integrate with @kit/notifications when available
  logger.info(
    ctx,
    `Re-auth required for account ${accountId}, platform ${platform}`,
  );

  // TODO: Integrate with notification system
  // await sendNotification(accountId, {
  //   type: 'platform_reauth_required',
  //   title: `${formatPlatformName(platform)} connection expired`,
  //   body: 'Please reconnect your account to continue publishing.',
  //   action: {
  //     label: 'Reconnect',
  //     url: `/settings/platforms?reconnect=${platform}`,
  //   },
  // });
}

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gets the expiry buffer in milliseconds
 */
export function getExpiryBuffer(): number {
  return EXPIRY_BUFFER_MS;
}
