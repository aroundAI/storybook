import { NextResponse } from 'next/server';

import { processScheduledPublishes } from '@kit/publishing/jobs';

/**
 * Cron endpoint to process scheduled publishes
 *
 * This should be called every minute via Vercel Cron or similar scheduler.
 *
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/publish-scheduled",
 *     "schedule": "* * * * *"
 *   }]
 * }
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
    const result = await processScheduledPublishes();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Cron] Failed to process scheduled publishes:', error);

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
