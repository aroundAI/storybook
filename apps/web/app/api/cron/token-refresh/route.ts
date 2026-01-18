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

  // In production, verify the secret
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
