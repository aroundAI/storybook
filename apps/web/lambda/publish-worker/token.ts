import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from './crypto';

/**
 * Ensure we have a valid access token for the platform
 * Note: Token refresh is handled by a cron job (every 30 min).
 * This just decrypts and returns the token.
 */
export async function checkConnectionToken(
  connectionId: string,
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<{
  valid: boolean;
  accessToken?: string;
  platformAccountId?: string;
  error?: string;
}> {
  // Get platform connection
  const { data: connection, error } = await client
    .from('platform_connections')
    .select(
      `
            id, platform, platform_account_id, platform_account_name,
            access_token_encrypted, token_expires_at, is_active
        `,
    )
    .eq('id', connectionId)
    .single();

  if (error || !connection) {
    return { valid: false, error: 'Platform connection not found' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'Platform connection is inactive' };
  }

  if (!connection.access_token_encrypted) {
    return { valid: false, error: 'No access token available' };
  }

  // Check if token is expired
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;

  if (expiresAt && expiresAt <= now) {
    return {
      valid: false,
      error:
        'Token expired - please reconnect your account or wait for refresh',
    };
  }

  // Decrypt and return the token
  try {
    const accessToken = await decrypt(connection.access_token_encrypted);
    return {
      valid: true,
      accessToken,
      platformAccountId: connection.platform_account_id,
    };
  } catch (decryptError) {
    console.error(
      `[Publish Worker] Failed to decrypt access token:`,
      decryptError,
    );
    return { valid: false, error: 'Failed to decrypt access token' };
  }
}
