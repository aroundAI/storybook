import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { decrypt, encrypt } from './crypto';

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
  error?: 'EXPIRED' | 'REFRESH_FAILED' | 'CONNECTION_INACTIVE' | 'NOT_FOUND';
  requiresReauth?: boolean;
}

/**
 * Supported publishing platforms
 */
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

/**
 * Platform connection row type (from platform_connections table)
 * This type should match the database schema in FILM-101j
 */
export interface PlatformConnection {
  id: string;
  account_id: string;
  platform: string;
  platform_account_id: string;
  platform_account_name: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  scopes: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Buffer time before expiry to trigger refresh (5 minutes)
 */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensures a valid access token is available for the connection.
 * Refreshes if needed, marks inactive if refresh fails.
 *
 * @param connectionId The platform connection ID
 * @returns TokenValidationResult with valid access token or error
 */
export async function ensureValidToken(
  connectionId: string,
): Promise<TokenValidationResult> {
  // 1. Fetch connection using untyped query (table may not exist in schema yet)
  // Once platform_connections table is created per FILM-101j, update to typed query
  const { data: connection, error } =
    await queryPlatformConnection(connectionId);

  if (error || !connection) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'CONNECTION_INACTIVE', requiresReauth: true };
  }

  // 2. Check if token is still valid with buffer
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const needsRefresh = expiresAt.getTime() - now.getTime() < EXPIRY_BUFFER_MS;

  if (!needsRefresh) {
    // Token still valid
    const accessToken = await decrypt(connection.access_token_encrypted);
    return { valid: true, accessToken };
  }

  // 3. Attempt refresh
  try {
    const refreshToken = await decrypt(connection.refresh_token_encrypted);
    const refreshed = await refreshTokenForPlatform(
      connection.platform as Platform,
      refreshToken,
    );

    // 4. Update stored tokens
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

    await updatePlatformConnection(connectionId, updateData);

    return { valid: true, accessToken: refreshed.accessToken };
  } catch {
    // 5. Mark connection as inactive
    await updatePlatformConnection(connectionId, {
      is_active: false,
      updated_at: new Date().toISOString(),
    });

    // 6. Send notification to user (if notification system available)
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
 * Queries a platform connection by ID.
 * Uses untyped query until platform_connections table is in schema.
 */
async function queryPlatformConnection(
  connectionId: string,
): Promise<{ data: PlatformConnection | null; error: unknown }> {
  const client = getSupabaseServerClient();

  // Cast to unknown first to bypass strict type checking
  // This allows querying tables not yet in the schema
  const result = await (
    client as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: string,
          ) => {
            single: () => Promise<{
              data: PlatformConnection | null;
              error: unknown;
            }>;
          };
        };
      };
    }
  )
    .from('platform_connections')
    .select('*')
    .eq('id', connectionId)
    .single();

  return result;
}

/**
 * Updates a platform connection record.
 * Uses untyped query until platform_connections table is in schema.
 */
async function updatePlatformConnection(
  connectionId: string,
  data: Record<string, string | boolean>,
): Promise<void> {
  const client = getSupabaseServerClient();

  // Use untyped query pattern until table exists in schema
  await (
    client as unknown as {
      from: (table: string) => {
        update: (data: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    }
  )
    .from('platform_connections')
    .update(data)
    .eq('id', connectionId);
}

/**
 * Platform-specific token refresh implementations
 */
async function refreshTokenForPlatform(
  platform: Platform,
  refreshToken: string,
): Promise<TokenRefreshResult> {
  switch (platform) {
    case 'youtube':
      return refreshYouTubeToken(refreshToken);
    case 'tiktok':
      return refreshTikTokToken(refreshToken);
    case 'instagram':
    case 'facebook':
      return refreshMetaToken(refreshToken, platform);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Refreshes a YouTube OAuth token
 */
async function refreshYouTubeToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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
): Promise<TokenRefreshResult> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok OAuth credentials not configured');
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('TikTok refresh failed');
  }

  const data = await response.json();
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
): Promise<TokenRefreshResult> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('Meta OAuth credentials not configured');
  }

  const url = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
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
 * Formats platform name for display
 */
export function formatPlatformName(platform: Platform): string {
  const names: Record<Platform, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
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
  // Log for now - integrate with @kit/notifications when available
  console.log(
    `[TokenRefresh] Re-auth required for account ${accountId}, platform ${platform}`,
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
