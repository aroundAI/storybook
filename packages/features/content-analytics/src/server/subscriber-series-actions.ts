'use server';

import { z } from 'zod';

import {
  type SubscriberPoint,
  querySubscriberAnchors,
  querySubscriberDeltas,
  reconstructSeries,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { assertScopeAccess } from './scope-access';

/**
 * The reconstructed subscriber curve (FILM-1607).
 *
 * The only thing that returns a complete series: the two queries return raw
 * anchors and raw deltas, and `reconstructSeries` is pure.
 */

const ScopeSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    connectionId: z.string().uuid().optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

const SubscriberSeriesSchema = z.object({
  scope: ScopeSchema,
  from: z.string().date(),
  to: z.string().date(),
});

export interface ConnectionSubscriberSeries {
  connectionId: string;
  points: SubscriberPoint[];
}

/** Days of lookback for the anchor that levels the start of the window. */
const ANCHOR_LOOKBACK_DAYS = 400;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const getSubscriberSeriesAction = enhanceAction(
  async ({ scope, from, to }) => {
    // Not optional. querySubscriberAnchors and querySubscriberDeltas take
    // connection ids and carry no tenant predicate of their own, so this is
    // the only thing standing between a caller-supplied scope and another
    // account's subscriber curve. FILM-1613 shipped in this phase for
    // exactly that bug class.
    await assertScopeAccess(scope);

    const client = getSupabaseServerAdminClient();

    const connections = await fetchAllRows<{ id: string }>(
      (rangeFrom, rangeTo) => {
        let query = client
          .from('platform_connections')
          .select('id')
          .eq('is_active', true);

        if (scope.accountId) {
          query = query.eq('account_id', scope.accountId);
        }

        if (scope.connectionId) {
          query = query.eq('id', scope.connectionId);
        }

        return query.order('id').range(rangeFrom, rangeTo);
      },
      'subscriber series connections',
    );

    const connectionIds = connections.map((c) => c.id);

    if (connectionIds.length === 0) {
      return [] as ConnectionSubscriberSeries[];
    }

    // Both reads reach back past `from`. An anchor dated before the window
    // still levels it, and the walk from that anchor needs the deltas
    // between it and `from` — without the same reach-back on the deltas, a
    // window opening inside a capture gap renders a hole at its left edge,
    // indistinguishable from "no data yet".
    const lookbackFrom = shiftDate(from, -ANCHOR_LOOKBACK_DAYS);

    const [anchors, deltas] = await Promise.all([
      querySubscriberAnchors({ connectionIds, from: lookbackFrom, to }),
      querySubscriberDeltas({ connectionIds, from: lookbackFrom, to }),
    ]);

    // Per connection, never summed. Channels connected at different times
    // have different first-anchor dates, so a naive sum steps up by a whole
    // channel's level the day its first snapshot lands — indistinguishable
    // from real growth. FILM-1611 owns any summed view.
    return connectionIds.map((connectionId) => ({
      connectionId,
      points: reconstructSeries(
        anchors
          .filter((a) => a.connectionId === connectionId)
          .map((a) => ({
            snapshotDate: a.snapshotDate,
            subscriberCount: a.subscriberCount,
            roundingStep: a.roundingStep,
          })),
        deltas
          .filter((d) => d.connectionId === connectionId)
          .map((d) => ({ metricDate: d.metricDate, net: d.net })),
        { from, to },
      ),
    })) satisfies ConnectionSubscriberSeries[];
  },
  { schema: SubscriberSeriesSchema },
);
