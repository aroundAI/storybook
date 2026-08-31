import { NextResponse } from 'next/server';

import { runReportingIngestJob } from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * POST /api/analytics/reports-ingest
 *
 * Cron endpoint for the YouTube Reporting API bulk ingest (FILM-1504).
 * Ensures report jobs exist per YouTube connection, downloads reports past
 * each job's watermark, and lands rows in ClickHouse. Called every 6 hours
 * by EventBridge — reports are generated daily with ~48h latency, and
 * re-delivery is idempotent.
 *
 * Security: protected by CRON_SECRET bearer token.
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'api.analytics.reports-ingest' };

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

    try {
      const result = await runReportingIngestJob();

      logger.info(
        { ...ctx, ...result, errors: undefined },
        `Report ingest completed in ${result.durationMs}ms`,
      );

      return NextResponse.json(result);
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
        },
        'Report ingest job failed',
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
