import { NextResponse } from 'next/server';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/**
 * Hourly generation-run expiry (FILM-1903).
 *
 * A run holds its target and stage (generation_runs_one_open) while it is
 * briefed or in progress. An external agent that never comes back would hold
 * it for ever, so `expire_generation_runs()` marks every run past its lease
 * expired, which frees the target for the next run.
 *
 * Security: `auth: false` plus an explicit bearer check, as the sibling cron
 * routes do: `auth: true` would redirect a session-less caller, and the
 * expiry would silently never run.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.expire-generation-runs' };

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

    const admin = getSupabaseServerAdminClient();
    const { data: expired, error } = await admin.rpc('expire_generation_runs');

    if (error) {
      logger.error({ ...ctx, error }, 'Generation run expiry failed');

      return NextResponse.json(
        { error: 'Generation run expiry failed' },
        { status: 500 },
      );
    }

    if (expired > 0) {
      logger.info({ ...ctx, expired }, 'Expired generation runs past lease');
    }

    return NextResponse.json({ success: true, expired });
  },
  { auth: false },
);
