'use server';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from '../../lib/database-types';
import { TIKTOK_OAUTH_CONFIG } from './config';

interface TikTokRefreshResult {
  accessToken: string;
  expiresAt: Date;
}

/**
 * Refreshes TikTok tokens for a connection
 * TikTok rotates refresh tokens on each use, so both tokens are updated
 */
export async function refreshTikTokToken(
  connectionId: string,
): Promise<TikTokRefreshResult> {
  const client = getSupabaseServerClient();

  // Note: Type assertion needed until database types are regenerated
  const { data: connection, error: fetchError } = (await client
    .from('platform_connections' as 'accounts')
    .select('*')
    .eq('id', connectionId)
    .eq('platform', 'tiktok')
    .single()) as { data: PlatformConnection | null; error: unknown };

  if (fetchError || !connection) {
    throw new Error('Connection not found');
  }

  if (!connection.refresh_token_encrypted) {
    throw new Error('No refresh token available');
  }

  const refreshToken = await decrypt(connection.refresh_token_encrypted);

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok OAuth not configured');
  }

  const response = await fetch(TIKTOK_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokens = await response.json();

  if (tokens.error || !tokens.access_token) {
    throw new Error(
      `TikTok refresh failed: ${tokens.error_description || tokens.error || 'Unknown error'}`,
    );
  }

  // Validate expiry fields before date calculations
  if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
    throw new Error('Invalid expires_in in token refresh response');
  }

  if (
    typeof tokens.refresh_expires_in !== 'number' ||
    tokens.refresh_expires_in <= 0
  ) {
    throw new Error('Invalid refresh_expires_in in token refresh response');
  }

  const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshTokenExpiresAt = new Date(
    Date.now() + tokens.refresh_expires_in * 1000,
  );

  // TikTok rotates refresh tokens - must store new one
  const encryptedAccessToken = await encrypt(tokens.access_token);
  const encryptedRefreshToken = await encrypt(tokens.refresh_token);

  const { error: updateError } = await client
    .from('platform_connections' as 'accounts')
    .update({
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      token_expires_at: accessTokenExpiresAt.toISOString(),
      metadata: {
        ...((connection.metadata as object) || {}),
        refresh_expires_at: refreshTokenExpiresAt.toISOString(),
      },
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', connectionId);

  if (updateError) {
    throw new Error('Failed to update connection');
  }

  return {
    accessToken: tokens.access_token,
    expiresAt: accessTokenExpiresAt,
  };
}
