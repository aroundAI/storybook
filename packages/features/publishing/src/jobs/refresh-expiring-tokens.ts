import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ensureValidToken } from '../lib/token-refresh';

/**
 * Result of the token refresh job
 */
export interface RefreshJobResult {
  checked: number;
  refreshed: number;
  failed: number;
}

/**
 * Expiring connection summary type
 */
interface ExpiringConnection {
  id: string;
  platform: string;
  account_id: string;
}

/**
 * Proactively refreshes tokens that are expiring within 1 hour.
 * This job should run every 30 minutes via cron.
 *
 * Benefits:
 * - Prevents publish failures due to expired tokens
 * - Reduces user-facing token refresh latency
 * - Allows graceful handling of refresh failures before scheduled posts
 *
 * @returns Statistics about the refresh job execution
 */
export async function refreshExpiringTokens(): Promise<RefreshJobResult> {
  const client = getSupabaseServerClient();
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

  // Find active connections expiring soon using untyped query
  // Until platform_connections table is created per FILM-101j
  const untypedClient = client as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: boolean,
        ) => {
          lt: (
            col: string,
            val: string,
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => Promise<{
              data: ExpiringConnection[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };

  const { data: expiringConnections, error } = await untypedClient
    .from('platform_connections')
    .select('id, platform, account_id')
    .eq('is_active', true)
    .lt('token_expires_at', oneHourFromNow.toISOString())
    .order('token_expires_at', { ascending: true });

  if (error) {
    console.error(
      '[TokenRefresh] Failed to query expiring connections:',
      error.message,
    );
    return { checked: 0, refreshed: 0, failed: 0 };
  }

  if (!expiringConnections || expiringConnections.length === 0) {
    console.log('[TokenRefresh] No expiring connections found');
    return { checked: 0, refreshed: 0, failed: 0 };
  }

  const results: RefreshJobResult = {
    checked: expiringConnections.length,
    refreshed: 0,
    failed: 0,
  };

  // Process connections sequentially to avoid rate limiting
  for (const conn of expiringConnections) {
    try {
      const result = await ensureValidToken(conn.id);

      if (result.valid) {
        results.refreshed++;
        console.log(
          `[TokenRefresh] Refreshed ${conn.platform} for account ${conn.account_id}`,
        );
      } else {
        results.failed++;
        console.error(
          `[TokenRefresh] Failed ${conn.platform} for account ${conn.account_id}:`,
          result.error,
        );
      }
    } catch (error) {
      results.failed++;
      console.error(
        `[TokenRefresh] Error refreshing ${conn.platform} for account ${conn.account_id}:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Small delay between refreshes to avoid rate limiting
    await sleep(100);
  }

  console.log(
    `[TokenRefresh] Complete: ${results.refreshed}/${results.checked} refreshed, ${results.failed} failed`,
  );

  return results;
}

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connection status for UI display
 */
interface ConnectionStatus {
  id: string;
  platform: string;
  is_active: boolean;
  token_expires_at: string;
}

/**
 * Checks the health of all platform connections for an account.
 * Useful for displaying connection status in the UI.
 *
 * @param accountId The account to check
 * @returns Map of platform to connection status
 */
export async function checkAccountConnections(accountId: string): Promise<
  Map<
    string,
    {
      id: string;
      isActive: boolean;
      expiresAt: Date;
      isExpiringSoon: boolean;
    }
  >
> {
  const client = getSupabaseServerClient();
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

  // Use untyped query until platform_connections table exists in schema
  const untypedClient = client as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{
          data: ConnectionStatus[] | null;
          error: unknown;
        }>;
      };
    };
  };

  const { data: connections, error } = await untypedClient
    .from('platform_connections')
    .select('id, platform, is_active, token_expires_at')
    .eq('account_id', accountId);

  if (error || !connections) {
    return new Map();
  }

  const result = new Map<
    string,
    {
      id: string;
      isActive: boolean;
      expiresAt: Date;
      isExpiringSoon: boolean;
    }
  >();

  for (const conn of connections) {
    const expiresAt = new Date(conn.token_expires_at);
    result.set(conn.platform, {
      id: conn.id,
      isActive: conn.is_active,
      expiresAt,
      isExpiringSoon: expiresAt < oneHourFromNow,
    });
  }

  return result;
}
