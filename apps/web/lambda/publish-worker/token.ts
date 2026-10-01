import type { SupabaseClient } from '@supabase/supabase-js';

import type { TokenErrorCode } from '@kit/publishing/lib/token-errors';
import { isWithinRefreshWindow } from '@kit/publishing/lib/token-expiry';
import { readFailed, whyNoRow } from '@kit/shared/rows';
import type { Database } from '@kit/supabase/database';

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
  client: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<{
  valid: boolean;
  accessToken?: string;
  platformAccountId?: string | null;
  /** A code; the job's failure is worded by `TokenRefusal` (KB-157). */
  error?: TokenErrorCode;
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

  if (readFailed(error)) {
    throw new Error(whyNoRow(error, 'Platform connection not found'));
  }

  if (error || !connection) {
    return { valid: false, error: 'NOT_FOUND' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'CONNECTION_INACTIVE' };
  }

  if (!connection.access_token_encrypted) {
    return { valid: false, error: 'NO_ACCESS_TOKEN' };
  }

  // Check if token is expired
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;

  if (expiresAt && isWithinRefreshWindow(expiresAt, now)) {
    // The log line carries what an operator needs to tell a lagging cron
    // from a long-dead token.
    const minutesLeft = Math.round(
      (expiresAt.getTime() - now.getTime()) / 60_000,
    );
    console.warn(
      `[Publish Worker] ${connection.platform} token for connection ${connectionId} not refreshed yet (minutesLeft=${minutesLeft})`,
    );
    return { valid: false, error: 'EXPIRED' };
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
    return { valid: false, error: 'TOKEN_UNREADABLE' };
  }
}
