import 'server-only';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export const MONITORING_WINDOWS = [1, 7, 30] as const;

export type MonitoringWindow = (typeof MONITORING_WINDOWS)[number];

export function parseMonitoringWindow(value: unknown): MonitoringWindow {
  const days = Number(value);

  return MONITORING_WINDOWS.find((window) => window === days) ?? 7;
}

export type Panel<Row> = { rows: Row[] } | { error: string };

function panel<Row>(result: {
  data: Row[] | null;
  error: { message: string } | null;
}): Panel<Row> {
  return result.error
    ? { error: result.error.message }
    : { rows: result.data ?? [] };
}

/**
 * The MCP connector's panels (FILM-1911). Read with the signed-in user's
 * client: each function refuses anyone but a super admin at aal2, so the
 * database is the check and AdminGuard is the second one. The guard-failure
 * count is the service role's alone (external_run_model_calls), read with
 * the admin client only after AdminGuard has passed.
 */
export async function loadMcpMonitoring(days: MonitoringWindow) {
  const client = getSupabaseServerClient();
  const admin = getSupabaseServerAdminClient();

  const [tools, errorCodes, runs, expiredLeases, guard, studio] =
    await Promise.all([
      client.rpc('admin_mcp_tool_stats', { p_days: days }),
      client.rpc('admin_mcp_error_codes', { p_days: days }),
      client.rpc('admin_generation_run_stats', { p_days: days }),
      client.rpc('admin_expired_leases_per_day', { p_days: days }),
      admin.rpc('external_run_model_calls', { p_limit: 1 }),
      // StorybookStudio deliveries (FILM-2006), super admin only like the rest
      client.rpc('admin_studio_delivery_stats', { p_days: days }),
    ]);

  return {
    tools: panel(tools),
    errorCodes: panel(errorCodes),
    runs: panel(runs),
    expiredLeases: panel(expiredLeases),
    studio: panel(studio),
    guard: guard.error
      ? { error: guard.error.message }
      : { violations: guard.data?.[0]?.total ?? 0 },
  };
}
