import { NextRequest, NextResponse } from 'next/server';

import { refreshExpiringTokens } from '@kit/publishing/jobs';

/**
 * Cron endpoint for proactively refreshing OAuth tokens.
 *
 * This endpoint should be called every 30 minutes by your cron scheduler
 * (e.g., AWS EventBridge, Vercel Cron, or external service like cron-job.org).
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
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[TokenRefresh] CRON_SECRET not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[TokenRefresh] Unauthorized cron request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const results = await refreshExpiringTokens();
    const duration = Date.now() - startTime;

    console.log(`[TokenRefresh] Job completed in ${duration}ms`, results);

    return NextResponse.json({
      success: true,
      ...results,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('[TokenRefresh] Job failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal error',
        durationMs: duration,
      },
      { status: 500 },
    );
  }
}

/**
 * POST endpoint for manual refresh trigger.
 * Can be called from admin panel to force refresh all expiring tokens.
 */
export async function POST(request: NextRequest) {
  // Same authorization as GET
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const results = await refreshExpiringTokens();
    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      ...results,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('[TokenRefresh] Manual refresh failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal error',
        durationMs: duration,
      },
      { status: 500 },
    );
  }
}
