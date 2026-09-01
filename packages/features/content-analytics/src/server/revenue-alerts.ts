import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

import { forEachAccountRevenueRow } from './revenue-queries';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** A day this many times above the trailing average is worth surfacing. */
const SPIKE_MULTIPLIER = 3;

/** Days of history the spike comparison averages over. */
const TRAILING_DAYS = 28;

/** Monthly revenue milestones, in cents. */
const MONTHLY_MILESTONES_CENTS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

export interface RevenueAlertResult {
  created: number;
}

interface AlertInsert {
  account_id: string;
  alert_type: 'threshold_reached' | 'significant_change';
  title: string;
  message: string;
  severity: 'info' | 'warning';
  related_data: Record<string, unknown>;
}

/**
 * Evaluates revenue alert rules for an account and records anything new.
 *
 * Runs at the end of the sync job. Alerts are deduplicated against the
 * last 24 hours so a rule that stays true does not post every hour.
 */
export async function evaluateRevenueAlerts(
  client: Client,
  accountId: string,
): Promise<RevenueAlertResult> {
  const logger = await getLogger();
  const ctx = { name: 'revenue-alerts', accountId };

  try {
    const since = new Date(Date.now() - TRAILING_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);

    // Scoped to the account explicitly. This runs on the admin client, which
    // bypasses RLS, so an unscoped read would aggregate every tenant's
    // revenue into this account's alerts. Scoping cannot be a plain
    // `.eq('account_id', ...)` either — that column is NULL on per-video
    // rows, which would drop most revenue instead — hence the shared helper
    // that unions the channel- and publish-scoped halves.
    // Streamed, not collected: only the per-date fold is needed, so the
    // rows never have to exist all at once.
    const byDate = new Map<string, number>();

    await forEachAccountRevenueRow(client, accountId, since, today, (row) => {
      byDate.set(
        row.record_date,
        (byDate.get(row.record_date) ?? 0) + (row.revenue_cents ?? 0),
      );
    });

    const alerts: AlertInsert[] = [];

    const todayCents = byDate.get(today) ?? 0;

    const priorDays = Array.from(byDate.entries()).filter(
      ([date]) => date !== today,
    );
    const priorTotal = priorDays.reduce((sum, [, cents]) => sum + cents, 0);
    const priorAverage =
      priorDays.length > 0 ? priorTotal / priorDays.length : 0;

    if (priorAverage > 0 && todayCents > priorAverage * SPIKE_MULTIPLIER) {
      alerts.push({
        account_id: accountId,
        alert_type: 'significant_change',
        title: 'Revenue spike today',
        message: `Today's revenue is ${(todayCents / priorAverage).toFixed(1)}x the ${TRAILING_DAYS}-day average.`,
        severity: 'info',
        related_data: {
          todayCents,
          trailingAverageCents: Math.round(priorAverage),
          trailingDays: TRAILING_DAYS,
        },
      });
    }

    // Month-to-date milestones
    const monthPrefix = today.slice(0, 7);
    const monthToDateCents = Array.from(byDate.entries())
      .filter(([date]) => date.startsWith(monthPrefix))
      .reduce((sum, [, cents]) => sum + cents, 0);

    const crossed = MONTHLY_MILESTONES_CENTS.filter(
      (milestone) =>
        monthToDateCents >= milestone &&
        monthToDateCents - todayCents < milestone,
    );

    for (const milestone of crossed) {
      alerts.push({
        account_id: accountId,
        alert_type: 'threshold_reached',
        title: `Passed $${(milestone / 100).toLocaleString()} this month`,
        message: `Month-to-date revenue reached $${(monthToDateCents / 100).toLocaleString()}.`,
        severity: 'info',
        related_data: { milestoneCents: milestone, monthToDateCents },
      });
    }

    if (alerts.length === 0) {
      return { created: 0 };
    }

    const created = await insertNewAlerts(client, accountId, alerts);

    logger.info({ ...ctx, created }, 'Revenue alerts evaluated');

    return { created };
  } catch (error) {
    logger.error(
      {
        ...ctx,
        error: error instanceof Error ? error.message : String(error),
      },
      'Revenue alert evaluation failed',
    );
    return { created: 0 };
  }
}

/**
 * Inserts alerts whose (type, title) has not already fired in the last
 * 24 hours, so a persistent condition does not spam the account.
 */
async function insertNewAlerts(
  client: Client,
  accountId: string,
  alerts: AlertInsert[],
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recent } = await client
    .from('revenue_alerts')
    .select('alert_type, title')
    .eq('account_id', accountId)
    .gte('created_at', cutoff);

  const seen = new Set(
    (recent ?? []).map(
      (row: { alert_type: string; title: string }) =>
        `${row.alert_type}:${row.title}`,
    ),
  );

  const fresh = alerts.filter(
    (alert) => !seen.has(`${alert.alert_type}:${alert.title}`),
  );

  if (fresh.length === 0) return 0;

  const { error } = await client.from('revenue_alerts').insert(fresh);

  return error ? 0 : fresh.length;
}
