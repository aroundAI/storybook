import 'server-only';

import {
  isClickHouseEnabled,
  purgeConnectionFromClickHouse,
  queryConnectionVideoIds,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/**
 * Deletes connections' vendor data from the `vendor_data_purges` queue
 * (KB-20 item 3 / KB-22 part B). Run hourly by the vendor-data-purge cron.
 *
 * Each purge: the Postgres half in one transaction
 * (`purge_connection_vendor_rows` — synced revenue, report jobs, collection
 * markers, the vendor's pictures), then the ClickHouse half
 * (`purgeConnectionFromClickHouse`, every table, counted to zero). Both are
 * idempotent, so a purge that fails anywhere is simply run again next hour.
 *
 * Manual entries are out of reach by construction: nothing here touches a
 * `revenue_records` row whose source is not 'api', or any table a person
 * writes.
 */

/** Per run; a backlog drains over successive hours. */
const BATCH = 20;

export interface VendorDataPurgeRunResult {
  processed: number;
  completed: number;
  failed: number;
  /** Not done and past `due_by`: a breach of the stated window. */
  overdue: number;
}

interface PurgeRow {
  id: string;
  connection_id: string;
  platform: string;
  reason: string;
  due_by: string;
  attempts: number;
}

export async function runVendorDataPurges(
  options: { now?: Date; limit?: number } = {},
): Promise<VendorDataPurgeRunResult> {
  const now = (options.now ?? new Date()).toISOString();
  const logger = await getLogger();
  const client = getSupabaseServerAdminClient();
  const ctx = { name: 'vendor-data-purge' };

  const { data: due, error } = await client
    .from('vendor_data_purges')
    .select('id, connection_id, platform, reason, due_by, attempts')
    .is('completed_at', null)
    .lte('run_after', now)
    .order('due_by', { ascending: true })
    .limit(options.limit ?? BATCH);

  if (error) {
    throw new Error(`Failed to read the purge queue: ${error.message}`);
  }

  let completed = 0;
  let failed = 0;

  for (const purge of (due ?? []) as PurgeRow[]) {
    const purgeCtx = {
      ...ctx,
      purgeId: purge.id,
      connectionId: purge.connection_id,
      platform: purge.platform,
      reason: purge.reason,
    };

    await client
      .from('vendor_data_purges')
      .update({ started_at: now, attempts: purge.attempts + 1 })
      .eq('id', purge.id);

    try {
      const result = await purgeConnection(purge.connection_id);

      const { error: doneError } = await client
        .from('vendor_data_purges')
        .update({
          completed_at: new Date().toISOString(),
          last_error: null,
          result,
        })
        .eq('id', purge.id);

      if (doneError) throw new Error(doneError.message);

      completed++;
      logger.info({ ...purgeCtx, result }, 'Vendor data purged');
    } catch (purgeError) {
      failed++;

      const message =
        purgeError instanceof Error ? purgeError.message : String(purgeError);

      await client
        .from('vendor_data_purges')
        .update({ last_error: message.slice(0, 2000) })
        .eq('id', purge.id);

      logger.warn(
        { ...purgeCtx, error: message },
        'Vendor data purge failed; it will be retried',
      );
    }
  }

  const { data: late, error: lateError } = await client
    .from('vendor_data_purges')
    .select('id, connection_id, platform, reason, due_by')
    .is('completed_at', null)
    .lt('due_by', now);

  if (lateError) {
    throw new Error(`Failed to read overdue purges: ${lateError.message}`);
  }

  for (const purge of late ?? []) {
    logger.error(
      {
        name: 'vendor-data-purge.overdue',
        purgeId: purge.id,
        connectionId: purge.connection_id,
        platform: purge.platform,
        reason: purge.reason,
        dueBy: purge.due_by,
      },
      'A vendor data purge is past its deadline',
    );
  }

  return {
    processed: (due ?? []).length,
    completed,
    failed,
    overdue: (late ?? []).length,
  };
}

/**
 * Both halves of one connection's purge. The video ids are the union of
 * Postgres's publishes for the connection and whatever `video_dim` still
 * attributes to it — after an account deletion only the second exists.
 */
async function purgeConnection(connectionId: string) {
  const client = getSupabaseServerAdminClient();

  const { data: postgres, error } = await client.rpc(
    'purge_connection_vendor_rows',
    { p_connection_id: connectionId },
  );

  if (error) {
    throw new Error(`Postgres purge failed: ${error.message}`);
  }

  if (!isClickHouseEnabled()) {
    // Nothing was written to ClickHouse while it was off, so there is
    // nothing to delete — recorded as such, not as a deletion.
    return { postgres, clickhouse: 'disabled' as const };
  }

  const publishes = await fetchAllRows<{ id: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id')
        .eq('platform_connection_id', connectionId)
        .order('id')
        .range(from, to),
    'purge publishes',
  );

  const videoIds = [
    ...publishes.map((publish) => publish.id),
    ...(await queryConnectionVideoIds(connectionId)),
  ];

  const clickhouse = await purgeConnectionFromClickHouse({
    connectionId,
    videoIds,
  });

  return {
    postgres,
    clickhouse: { status: 'deleted' as const, ...clickhouse },
  };
}
