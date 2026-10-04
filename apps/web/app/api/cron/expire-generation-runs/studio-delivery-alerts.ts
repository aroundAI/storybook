import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

import type { Database } from '~/lib/database.types';

/**
 * FILM-2006: the alerts behind the super admin's StorybookStudio panel.
 * Run by the hourly cron right after FILM-2003's sweep, they raise:
 *
 * - `studio.alert.stale_render_uploads` when the sweep just failed renders
 *   left uploading for 24 hours (the Studio never finalized them);
 * - `studio.alert.target_changed` when deliveries were refused with
 *   TARGET_CHANGED in the last hour (the episode changed in StoryBook
 *   while it was being edited).
 *
 * As FILM-1911's guard does: a log line tagged with the alert's name, and
 * a capture in the monitoring service (Sentry when MONITORING_PROVIDER is
 * set). Unlike the guard, the cron does not fail for these, so the run's
 * own work (expiry, trimming, stale sessions) still reads as done.
 */
export const STUDIO_DELIVERY_ALERTS = {
  staleRenderUploads: 'studio.alert.stale_render_uploads',
  targetChanged: 'studio.alert.target_changed',
} as const;

type Alert =
  (typeof STUDIO_DELIVERY_ALERTS)[keyof typeof STUDIO_DELIVERY_ALERTS];

const HOUR_MS = 3_600_000;

/** Loaded only when an alert fires, so a quiet hour never initialises it. */
async function capture(message: string, extra: Record<string, unknown>) {
  const { getServerMonitoringService } = await import('@kit/monitoring/server');
  const monitoring = await getServerMonitoringService();

  await monitoring.ready();
  await monitoring.captureException(new Error(message), extra);
}

export async function raiseStudioDeliveryAlerts(
  admin: SupabaseClient<Database>,
  input: { failedRenders: number; now?: Date },
): Promise<{ targetChanged: number | null; alerts: Alert[] }> {
  const logger = await getLogger();
  const ctx = { name: 'cron.studio-delivery-alerts' };
  const now = input.now ?? new Date();
  const alerts: Alert[] = [];

  if (input.failedRenders > 0) {
    const alert = STUDIO_DELIVERY_ALERTS.staleRenderUploads;
    const message = `${input.failedRenders} Studio renders were left uploading for 24 hours and failed`;

    logger.warn({ ...ctx, alert, failedRenders: input.failedRenders }, message);
    await capture(message, { alert, failedRenders: input.failedRenders });
    alerts.push(alert);
  }

  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const { count, error } = await admin
    .from('mcp_tool_calls')
    .select('id', { count: 'exact', head: true })
    .eq('error_code', 'TARGET_CHANGED')
    .gte('created_at', since);

  if (error || count === null) {
    const alert = STUDIO_DELIVERY_ALERTS.targetChanged;
    const message = `TARGET_CHANGED refusals could not be counted: ${error?.message ?? 'no count'}`;

    logger.error({ ...ctx, alert, error }, message);
    await capture(message, { alert });

    return { targetChanged: null, alerts };
  }

  if (count > 0) {
    const alert = STUDIO_DELIVERY_ALERTS.targetChanged;
    const message = `${count} TARGET_CHANGED delivery refusals in the last hour`;

    logger.warn({ ...ctx, alert, refusals: count, since }, message);
    await capture(message, { alert, refusals: count, since });
    alerts.push(alert);
  }

  return { targetChanged: count, alerts };
}
