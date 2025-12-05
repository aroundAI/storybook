import { NextRequest, NextResponse } from 'next/server';

import {
  cleanupExpiredOAuthStates,
  refreshExpiringTokens,
} from '@kit/publishing/jobs';

/**
 * Cron API Route for Token Refresh
 * Proactively refreshes OAuth tokens expiring within 1 hour
 *
 * Should be called every 30 minutes via a cron job:
 * - AWS EventBridge
 * - Vercel Cron
 * - External service like cron-job.org
 *
 * Protected by CRON_SECRET environment variable
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Refresh expiring tokens
    const refreshResults = await refreshExpiringTokens();

    // Cleanup expired OAuth states
    const cleanedStates = await cleanupExpiredOAuthStates();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      tokenRefresh: {
        checked: refreshResults.checked,
        refreshed: refreshResults.refreshed,
        failed: refreshResults.failed,
        failedConnections: refreshResults.failedConnections.map(
          (c: { platform: string; error: string }) => ({
            platform: c.platform,
            error: c.error,
          }),
        ),
      },
      oauthStates: {
        cleaned: cleanedStates,
      },
    });
  } catch (error) {
    console.error('[Cron] Token refresh failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
