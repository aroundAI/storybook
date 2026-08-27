import { NextResponse } from 'next/server';

import { runYouTubeBackfillBatch } from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * POST /api/analytics/backfill
 *
 * Re-populates per-day YouTube history after the ClickHouse v2 cutover
 * (FILM-1503). Quota-capped and resumable — invoke repeatedly until the
 * response reports remaining: 0.
 *
 * Query params:
 * - dryRun=true    log planned queries without writing
 * - maxVideos=N    cap publishes processed this invocation
 * - maxQueries=N   cap Analytics API queries this invocation
 *
 * Security: protected by CRON_SECRET bearer token.
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'api.analytics.backfill' };

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
      logger.warn(ctx, 'Unauthorized backfill request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const maxVideos = parsePositiveInt(url.searchParams.get('maxVideos'));
    const maxQueries = parsePositiveInt(url.searchParams.get('maxQueries'));

    try {
      const result = await runYouTubeBackfillBatch({
        dryRun,
        maxVideos,
        maxQueries,
      });

      logger.info({ ...ctx, ...result, errors: undefined }, 'Backfill batch');

      return NextResponse.json(result);
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
        },
        'Backfill batch failed',
      );

      return NextResponse.json(
        { success: false, error: 'Internal error' },
        { status: 500 },
      );
    }
  },
  {
    auth: false, // Cron auth handled manually
  },
);

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
