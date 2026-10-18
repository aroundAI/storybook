import { NextResponse } from 'next/server';

import {
  captureChannelLifetimeTotals,
  captureSubscriberSnapshots,
} from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * Daily absolute subscriber capture (FILM-1607), and each YouTube channel's
 * lifetime statistics beside it (FILM-1734).
 *
 * Scheduled at 02:00 UTC, well clear of midnight, so an ordinary retry cannot
 * straddle the boundary and land two rows on two dates for one reading.
 *
 * Security: `auth: false` plus an explicit bearer check, matching
 * api/cron/refresh-tokens. enhanceRouteHandler defaults to `auth: true`,
 * which would make requireUser fail for a session-less cron caller and return
 * a redirect — the capture would silently never run. `auth: false` on its own
 * would leave the endpoint anonymously callable. A missing secret is a
 * configuration error, not a reason to skip the check.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.subscriber-snapshot' };

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
      const result = await captureSubscriberSnapshots();
      // Each YouTube channel's lifetime views, subscribers and videos
      // (FILM-1734), from the same `channels.list`. Never throws.
      const channelTotals = await captureChannelLifetimeTotals();

      return NextResponse.json({ success: true, ...result, channelTotals });
    } catch (error) {
      logger.error({ ...ctx, error }, 'Subscriber snapshot batch failed');

      return NextResponse.json(
        { error: 'Subscriber snapshot failed' },
        { status: 500 },
      );
    }
  },
  { auth: false },
);
