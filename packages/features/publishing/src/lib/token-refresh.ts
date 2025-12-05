'use server';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from './database-types';

interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

interface TokenValidationResult {
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
 * Buffer time before expiry to trigger refresh (5 minutes)
 */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensures a valid access token is available for the connection.
 * Refreshes if needed, marks inactive if refresh fails.
 */
export async function ensureValidToken(
  connectionId: string,
): Promise<TokenValidationResult> {
  const client = getSupabaseServerClient();

  // 1. Fetch connection
  // Note: Type assertion needed until database types are regenerated
  const { data: connection, error } = (await client
    .from('platform_connections' as 'accounts')
    .select('*')
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
      connection.platform,
      refreshToken,
    );

    // 5. Update stored tokens
    await client
      .from('platform_connections' as 'accounts')
      .update({
        access_token_encrypted: await encrypt(refreshed.accessToken),
        refresh_token_encrypted: refreshed.refreshToken
          ? await encrypt(refreshed.refreshToken)
          : connection.refresh_token_encrypted,
        token_expires_at: refreshed.expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', connectionId);

    return { valid: true, accessToken: refreshed.accessToken };
  } catch (refreshError) {
    console.error(
      `[TokenRefresh] Failed to refresh ${connection.platform}:`,
      refreshError,
    );

    // 6. Mark connection as inactive
    await markConnectionInactive(connectionId);

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
  const client = getSupabaseServerClient();
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
  platform: string,
  refreshToken: string,
): Promise<TokenRefreshResult> {
  switch (platform) {
    case 'youtube':
      return refreshYouTubeToken(refreshToken);
    case 'tiktok':
      return refreshTikTokToken(refreshToken);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

async function refreshYouTubeToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth not configured');
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
    const error = await response.json();
    throw new Error(
      `YouTube refresh failed: ${error.error_description || error.error}`,
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // YouTube may return new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

async function refreshTikTokToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok OAuth not configured');
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
 * Gets the platform display name
 */
export function formatPlatformName(platform: string): string {
  const names: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
  };
  return names[platform] || platform;
}
