import { NextResponse } from 'next/server';

import {
  getRateLimiter,
  runAnalyticsSyncJob,
} from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * POST /api/analytics/sync
 *
 * Cron endpoint for syncing analytics from YouTube, TikTok, and Instagram.
 * Should be called hourly by cron scheduler (AWS EventBridge, Vercel Cron, etc.)
 *
 * Security:
 * - Protected by CRON_SECRET bearer token
 * - Returns minimal error information
 *
 * Response:
 * - success: boolean
 * - totalProcessed: number of publishes processed
 * - successful: number of successful syncs
 * - failed: number of failed syncs
 * - skipped: number skipped due to rate limiting
 * - byPlatform: breakdown by platform
 * - durationMs: execution time
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'api.analytics.sync' };

    // Verify cron secret
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
      const result = await runAnalyticsSyncJob();

      logger.info(
        { ...ctx, ...result },
        `Analytics sync completed in ${result.durationMs}ms`,
      );

      return NextResponse.json(result);
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
        },
        'Analytics sync job failed',
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Internal error',
        },
        { status: 500 },
      );
    }
  },
  {
    auth: false, // Cron auth handled manually
  },
);

/**
 * GET /api/analytics/sync
 *
 * Returns sync job status and rate limit info.
 * Useful for monitoring dashboards.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return basic status info
    const rateLimiter = getRateLimiter();

    return NextResponse.json({
      status: 'ready',
      rateLimits: {
        youtube: rateLimiter.getRemainingRequests('youtube'),
        tiktok: rateLimiter.getRemainingRequests('tiktok'),
        instagram: rateLimiter.getRemainingRequests('instagram'),
      },
    });
  },
  {
    auth: false,
  },
);
