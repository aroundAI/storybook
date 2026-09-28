import { NextResponse } from 'next/server';

import { captureChannelReachWindows } from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * Nightly unique reach per channel and window (migration 016): Meta keeps
 * about 90 days of account insights, so each window is recorded while it
 * still can be. Scheduled at 02:30 UTC.
 *
 * Security: `auth: false` plus an explicit bearer check, as
 * api/cron/subscriber-snapshot and api/cron/refresh-tokens do: a session-less
 * cron caller would otherwise be redirected, and the capture would never run.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.channel-reach' };

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
      const result = await captureChannelReachWindows();

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      logger.error({ ...ctx, error }, 'Channel reach capture failed');

      return NextResponse.json(
        { error: 'Subscriber snapshot failed' },
        { status: 500 },
      );
    }
  },
  { auth: false },
);
