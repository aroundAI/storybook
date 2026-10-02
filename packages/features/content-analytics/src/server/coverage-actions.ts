'use server';

import {
  CAPABILITY_MATRIX,
  coverageAsOf,
  foldObservedCoverage,
} from '@kit/clickhouse';
import { queryObservedCoverage } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { CoverageMatrixResult } from '../lib/coverage';
import { isSelected } from '../lib/platform-selection';
import { CoverageMatrixSchema } from '../lib/schemas/coverage.schema';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';

/**
 * Coverage for every card on the analytics page, in one call (FILM-1704).
 *
 * Two halves, folded by `foldObservedCoverage`:
 *
 * - **connected** — the scope's account's channels from Postgres, narrowed
 *   by the scope's channel and platform filters. Only an active connection
 *   counts as connected.
 * - **observed** — one `queryObservedCoverage` statement over the five fact
 *   tables for the scope and window.
 *
 * With no connection in scope there is nothing to observe, so ClickHouse is
 * not asked: every capable cell is `not_connected`, which is the sentence a
 * project with no channels should read — not fifteen error states.
 */
export const getCoverageMatrixAction = enhanceAction(
  async ({ scope, from, to }): Promise<CoverageMatrixResult> => {
    const accountId = (await assertScopeAccess(scope)) ?? scope.accountId!;

    const channels = (
      await listAccountChannels(accountId, getSupabaseServerClient())
    ).filter(
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
  },
  {
    schema: CoverageMatrixSchema,
    auth: true,
  },
);
