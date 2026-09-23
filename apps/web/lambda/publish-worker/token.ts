import type { SupabaseClient } from '@supabase/supabase-js';

import { isWithinRefreshWindow } from '@kit/publishing/lib/token-expiry';

import { decrypt } from './crypto';

/**
 * Ensure we have a valid access token for the platform.
 *
 * The worker never refreshes: the web app's cron job does, every 30 minutes,
 * and a second refresher would race it for refresh tokens that X and TikTok
 * rotate on use. So the worker refuses exactly what the app would refresh
 * before use - the same rule, `isWithinRefreshWindow` - and SQS redelivers
 * the job once the cron has renewed the token (KB-15).
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

  if (expiresAt && isWithinRefreshWindow(expiresAt, now)) {
    // The text below reaches the publish screen, so it stays as it was; the
    // log line carries what an operator needs to tell a lagging cron from a
    // long-dead token.
    const minutesLeft = Math.round(
      (expiresAt.getTime() - now.getTime()) / 60_000,
    );
    console.warn(
      `[Publish Worker] ${connection.platform} token for connection ${connectionId} not refreshed yet (minutesLeft=${minutesLeft})`,
    );
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
