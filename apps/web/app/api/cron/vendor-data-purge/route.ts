import { NextResponse } from 'next/server';

import { runVendorDataPurges } from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * Hourly vendor-data purge (KB-20 item 3 / KB-22 part B).
 *
 * Works through `vendor_data_purges`: a YouTube disconnect (due within 7
 * days), a connection deleted with its account, or a request the operator
 * queued. Overdue purges are logged at error by the job.
 *
 * Security: `auth: false` plus an explicit bearer check, as the sibling cron
 * routes do — `auth: true` would redirect a session-less caller, and the
 * purge would silently never run.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.vendor-data-purge' };

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
      const result = await runVendorDataPurges();

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      logger.error({ ...ctx, error }, 'Vendor data purge run failed');

      return NextResponse.json(
        { error: 'Vendor data purge failed' },
        { status: 500 },
      );
    }
  },
  { auth: false },
);
