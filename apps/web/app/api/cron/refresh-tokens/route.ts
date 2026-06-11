import { NextResponse } from 'next/server';

import { enhanceRouteHandler } from '@kit/next/routes';
import {
  cleanupExpiredOAuthStates,
  refreshExpiringTokens,
} from '@kit/publishing/jobs';
import { getLogger } from '@kit/shared/logger';

/**
 * Cron endpoint for proactively refreshing OAuth tokens.
 *
 * This endpoint should be called every 30 minutes by your cron scheduler
 * (e.g., AWS EventBridge or external service like cron-job.org).
 *
 * Tokens expiring within 1 hour will be refreshed. Failed refreshes will
 * mark connections as inactive and notify users to re-authenticate.
 *
 * Security:
 * - Protected by CRON_SECRET bearer token
 * - Returns minimal error information to prevent information disclosure
 *
 * Example cron schedule: `* /30 * * * *` (every 30 minutes)
 *
 * @returns JSON with refresh statistics
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.refresh-tokens' };

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

    const startTime = Date.now();

    try {
      const results = await refreshExpiringTokens();
      const cleanedStates = await cleanupExpiredOAuthStates();
      const duration = Date.now() - startTime;

      logger.info(
        { ...ctx, ...results, cleanedStates, durationMs: duration },
        `Job completed in ${duration}ms`,
      );

      return NextResponse.json({
        success: true,
        ...results,
        oauthStates: { cleaned: cleanedStates },
        durationMs: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
          durationMs: duration,
        },
        'Job failed',
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Internal error',
          durationMs: duration,
        },
        { status: 500 },
      );
    }
  },
  {
    auth: false,
  },
);

/**
 * POST endpoint for manual refresh trigger.
 * Can be called from admin panel to force refresh all expiring tokens.
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.refresh-tokens.manual' };

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
      logger.warn(ctx, 'Unauthorized manual refresh request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();

    try {
      const results = await refreshExpiringTokens();
      const duration = Date.now() - startTime;

      logger.info(
        { ...ctx, ...results, durationMs: duration },
        `Manual refresh completed in ${duration}ms`,
      );

      return NextResponse.json({
        success: true,
        ...results,
        durationMs: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
          durationMs: duration,
        },
        'Manual refresh failed',
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Internal error',
          durationMs: duration,
        },
        { status: 500 },
      );
    }
  },
  {
    auth: false,
  },
);
