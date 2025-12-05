'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ensureValidToken, formatPlatformName } from '../lib/token-refresh';

interface RefreshResult {
  checked: number;
  refreshed: number;
  failed: number;
  failedConnections: Array<{
    id: string;
    platform: string;
    accountId: string;
    error: string;
  }>;
}

interface ExpiringConnection {
  id: string;
  platform: string;
  account_id: string;
}

/**
 * Cron job to proactively refresh tokens expiring within 1 hour.
 * Should run every 30 minutes via cron.
 */
export async function refreshExpiringTokens(): Promise<RefreshResult> {
  const client = getSupabaseServerClient();
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

  // Find active connections expiring soon
  // Note: Type assertion needed until database types are regenerated
  const { data: expiringConnections, error } = (await client
    .from('platform_connections' as 'accounts')
    .select('id, platform, account_id')
    .eq('is_active', true)
    .not('token_expires_at', 'is', null)
    .lt('token_expires_at', oneHourFromNow.toISOString())
    .order('token_expires_at', { ascending: true })) as {
    data: ExpiringConnection[] | null;
    error: unknown;
  };

  if (error) {
    console.error(
      '[TokenRefresh] Failed to query expiring connections:',
      error,
    );
    return { checked: 0, refreshed: 0, failed: 0, failedConnections: [] };
  }

  const results: RefreshResult = {
    checked: expiringConnections?.length ?? 0,
    refreshed: 0,
    failed: 0,
    failedConnections: [],
  };

  if (!expiringConnections || expiringConnections.length === 0) {
    console.log('[TokenRefresh] No connections need refreshing');
    return results;
  }

  console.log(
    `[TokenRefresh] Found ${expiringConnections.length} connections expiring soon`,
  );

  for (const conn of expiringConnections) {
    try {
      const result = await ensureValidToken(conn.id);

      if (result.valid) {
        results.refreshed++;
        console.log(
          `[TokenRefresh] Refreshed ${formatPlatformName(conn.platform)} for account ${conn.account_id}`,
        );
      } else {
        results.failed++;
        results.failedConnections.push({
          id: conn.id,
          platform: conn.platform,
          accountId: conn.account_id,
          error: result.error || 'Unknown error',
        });
        console.error(
          `[TokenRefresh] Failed ${formatPlatformName(conn.platform)} for account ${conn.account_id}:`,
          result.error,
        );
      }
    } catch (e) {
      results.failed++;
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      results.failedConnections.push({
        id: conn.id,
        platform: conn.platform,
        accountId: conn.account_id,
        error: errorMessage,
      });
      console.error(
        `[TokenRefresh] Exception for ${conn.platform} account ${conn.account_id}:`,
        e,
      );
    }
  }

  console.log(
    `[TokenRefresh] Complete: ${results.refreshed}/${results.checked} refreshed, ${results.failed} failed`,
  );

  return results;
}

/**
 * Cleans up expired OAuth states
 * Should run periodically to remove stale state entries
 */
export async function cleanupExpiredOAuthStates(): Promise<number> {
  const client = getSupabaseServerClient();

  // Note: Type assertion needed until database types are regenerated
  const { data, error } = (await client.rpc(
    'cleanup_expired_oauth_states' as 'get_config',
  )) as { data: number | null; error: unknown };

  if (error) {
    console.error('[TokenRefresh] Failed to cleanup OAuth states:', error);
    return 0;
  }

  const deletedCount = data ?? 0;

  if (deletedCount > 0) {
    console.log(
      `[TokenRefresh] Cleaned up ${deletedCount} expired OAuth states`,
    );
  }

  return deletedCount;
}
