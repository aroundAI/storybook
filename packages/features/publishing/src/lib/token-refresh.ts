import 'server-only';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

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
    | 'NO_REFRESH_TOKEN';
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
 * @returns TokenValidationResult with valid access token or error
 */
export async function ensureValidToken(
  connectionId: string,
): Promise<TokenValidationResult> {
  // Check if a refresh is already in progress for this connection
  const inFlight = inFlightRefreshes.get(connectionId);
  if (inFlight) {
    // Wait for the existing refresh to complete
    return inFlight;
  }

  // Start the refresh and track it
  const refreshPromise = doEnsureValidToken(connectionId);
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

  // 2. Check if token is still valid with buffer
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;
  const now = new Date();
  const needsRefresh =
    !expiresAt || expiresAt.getTime() - now.getTime() < EXPIRY_BUFFER_MS;

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

  // 4. Attempt refresh
  try {
    const refreshToken = await decrypt(connection.refresh_token_encrypted);
    const refreshed = await refreshTokenForPlatform(
      connection.platform as Platform,
      refreshToken,
      connection.account_id,
    );

    // 5. Update stored tokens
    const updateData: Record<string, string | boolean> = {
      access_token_encrypted: await encrypt(refreshed.accessToken),
      token_expires_at: refreshed.expiresAt.toISOString(),
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
    logger.error(
      {
        name: 'token-refresh',
        platform: connection.platform,
        error: refreshError,
      },
      `Failed to refresh ${connection.platform}`,
    );

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
 * Marks a connection as inactive
 */
async function markConnectionInactive(connectionId: string): Promise<void> {
  const client = getSupabaseServerAdminClient();
  await client
    .from('platform_connections' as 'accounts')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', connectionId);
}

/**
 * Platform-specific token refresh implementations
 */
async function refreshTokenForPlatform(
  platform: Platform,
  refreshToken: string,
  accountId: string,
): Promise<TokenRefreshResult> {
  switch (platform) {
    case 'youtube':
      return refreshYouTubeToken(refreshToken, accountId);
    case 'tiktok':
      return refreshTikTokToken(refreshToken, accountId);
    case 'instagram':
    case 'facebook':
      return refreshMetaToken(refreshToken, platform, accountId);
    case 'linkedin':
      return refreshLinkedInToken(refreshToken, accountId);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Refreshes a YouTube OAuth token
 */
async function refreshYouTubeToken(
  refreshToken: string,
  accountId: string,
): Promise<TokenRefreshResult> {
  // Fetch credentials from database (using admin client for background jobs)
  const { getAccountOAuthAppAdmin } = await import(
    '../server/account-oauth-actions'
  );
  const oauthApp = await getAccountOAuthAppAdmin(accountId, 'youtube');

  if (!oauthApp) {
    throw new Error(
      'YouTube OAuth credentials not configured for this account',
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
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
  accountId: string,
): Promise<TokenRefreshResult> {
  // Fetch credentials from database (using admin client for background jobs)
  const { getAccountOAuthAppAdmin } = await import(
    '../server/account-oauth-actions'
  );
  const oauthApp = await getAccountOAuthAppAdmin(accountId, 'tiktok');

  if (!oauthApp) {
    throw new Error('TikTok OAuth credentials not configured for this account');
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
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
 * Meta uses long-lived tokens that need to be exchanged before expiry
 */
async function refreshMetaToken(
  accessToken: string,
  _platform: 'instagram' | 'facebook',
  accountId: string,
): Promise<TokenRefreshResult> {
  // Fetch credentials from database (using admin client for background jobs)
  const { getAccountOAuthAppAdmin } = await import(
    '../server/account-oauth-actions'
  );
  const oauthApp = await getAccountOAuthAppAdmin(accountId, 'meta');

  if (!oauthApp) {
    throw new Error('Meta OAuth credentials not configured for this account');
  }

  const url = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', oauthApp.clientId);
  url.searchParams.set('client_secret', oauthApp.clientSecret);
  url.searchParams.set('fb_exchange_token', accessToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Meta refresh failed');
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    // Meta tokens are long-lived, expires_in is in seconds
    // Default 60 days if not specified
    expiresAt: new Date(Date.now() + (data.expires_in ?? 5184000) * 1000),
  };
}

/**
 * Refreshes a LinkedIn OAuth token
 */
async function refreshLinkedInToken(
  refreshToken: string,
  accountId: string,
): Promise<TokenRefreshResult> {
  // Fetch credentials from database (using admin client for background jobs)
  // LinkedIn uses 'meta' credentials as fallback (or add linkedin to platform type)
  const { getAccountOAuthAppAdmin } = await import(
    '../server/account-oauth-actions'
  );
  // @ts-expect-error linkedin not in type yet
  const oauthApp = await getAccountOAuthAppAdmin(accountId, 'linkedin');

  if (!oauthApp) {
    throw new Error(
      'LinkedIn OAuth credentials not configured for this account',
    );
  }

  const response = await fetch(
    'https://www.linkedin.com/oauth/v2/accessToken',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: oauthApp.clientId,
        client_secret: oauthApp.clientSecret,
      }),
    },
  );

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
 * Gets the expiry buffer in milliseconds
 */
export function getExpiryBuffer(): number {
  return EXPIRY_BUFFER_MS;
}
