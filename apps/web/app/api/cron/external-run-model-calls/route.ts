import { NextResponse } from 'next/server';

import { getServerMonitoringService } from '@kit/monitoring/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

const ALERT = 'mcp.guard.external_run_model_call';

/**
 * Hourly guard check (FILM-1911).
 *
 * A model-usage row whose run is external means Gemini ran for work an MCP
 * client owns. llm_usage_analytics_server_run_only (FILM-1903) refuses that
 * insert, so `external_run_model_calls()` should always come back empty; this
 * route proves it stays so. A finding, or a check that could not run, goes to
 * the monitoring service (Sentry when MONITORING_PROVIDER is set) and to an
 * error log line tagged `mcp.guard.external_run_model_call`.
 *
 * Security: `auth: false` plus the CRON_SECRET bearer check, as the sibling
 * cron routes do.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.external-run-model-calls' };

    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.error(ctx, 'CRON_SECRET not configured');

      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn(ctx, 'Unauthorized cron request');

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseServerAdminClient();
    const { data, error } = await admin.rpc('external_run_model_calls', {
      p_limit: 20,
    });

    if (error) {
      const message = `MCP guard check could not run: ${error.message}`;

      logger.error({ ...ctx, alert: ALERT, error }, message);
      await raise(new Error(message), { alert: ALERT });

      return NextResponse.json(
        { error: 'Guard check failed' },
        { status: 500 },
      );
    }

    const violations = data[0]?.total ?? 0;

    if (violations > 0) {
      const message = `MCP guard failed: ${violations} model-usage rows belong to external runs`;
      const extra = {
        alert: ALERT,
        violations,
        usageIds: data.map((row) => row.usage_id),
        runIds: data.map((row) => row.run_id),
      };

      logger.error({ ...ctx, ...extra }, message);
      await raise(new Error(message), extra);
    }

    return NextResponse.json({ success: true, violations });
  },
  { auth: false },
);

async function raise(error: Error, extra: Record<string, unknown>) {
  const monitoring = await getServerMonitoringService();

  await monitoring.ready();
  await monitoring.captureException(error, extra);
}
