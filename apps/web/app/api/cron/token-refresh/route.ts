import { NextResponse } from 'next/server';

/**
 * Cron endpoint to refresh expiring OAuth tokens
 *
 * This should be called every 30 minutes to refresh tokens before they expire.
 * Tokens are refreshed 5 minutes before their actual expiry.
 */
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Fail closed. The previous `if (cronSecret && …)` skipped the check
  // entirely when the variable was unset, so any environment without a
  // CRON_SECRET served OAuth token refresh for every connection to
  // anonymous callers. Production does set it, but staging and preview
  // deployments are not guaranteed to.
  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Import dynamically to avoid issues
    const { refreshExpiringTokens } = await import('@kit/publishing/jobs');
    const result = await refreshExpiringTokens();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Cron] Failed to refresh tokens:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

// Disable caching for cron endpoints
export const dynamic = 'force-dynamic';
export const revalidate = 0;
