import 'server-only';

import type { z } from 'zod';

import {
  CAPABILITY_MATRIX,
  coverageAsOf,
  foldObservedCoverage,
} from '@kit/clickhouse';
import { queryObservedCoverage } from '@kit/clickhouse/server';

import type { CoverageMatrixResult } from '../lib/coverage';
import { isSelected } from '../lib/platform-selection';
import type { CoverageMatrixSchema } from '../lib/schemas/coverage.schema';
import type { AnalyticsClient } from './analytics-client';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';

export type CoverageMatrixInput = z.infer<typeof CoverageMatrixSchema>;

/**
 * Coverage for every card on the analytics page, in one call (FILM-1704),
 * as a service over the caller's client (FILM-1906).
 *
 * Two halves, folded by `foldObservedCoverage`:
 *
 * - **connected** — the scope's account's channels from Postgres, narrowed
 *   by the scope's channel and platform filters. Only an active connection
 *   counts as connected.
 * - **observed** — one `queryObservedCoverage` statement over the six fact
 *   tables for the scope and window.
 *
 * With no connection in scope there is nothing to observe, so ClickHouse is
 * not asked: every capable cell is `not_connected`, which is the sentence a
 * project with no channels should read — not fifteen error states. With
 * ClickHouse off, `observed` is false and the cells say so.
 */
export async function getCoverageMatrixService(
  client: AnalyticsClient,
  { scope, from, to }: CoverageMatrixInput,
): Promise<CoverageMatrixResult> {
  const accountId =
    (await assertScopeAccess(client, scope)) ?? scope.accountId!;

  const channels = (await listAccountChannels(accountId, client)).filter(
    (channel) =>
      (!scope.connectionId || channel.connectionId === scope.connectionId) &&
      (!scope.platforms || isSelected(scope.platforms, channel.platform)),
  );

  const connectedPlatforms = channels
    .filter((channel) => channel.isActive)
    .map((channel) => channel.platform);

  const rows =
    channels.length === 0 ? [] : await queryObservedCoverage(scope, from, to);

  const today = new Date().toISOString().slice(0, 10);

  return {
    window: { from, to },
    matrix: foldObservedCoverage(rows, CAPABILITY_MATRIX, {
      connectedPlatforms,
      asOf: coverageAsOf(to, today),
    }),
    channels,
    observed: rows !== null,
  };
}
