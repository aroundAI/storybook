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
 * The same hourly run trims `mcp_tool_calls` rows older than 90 days
 * (FILM-1904) with `trim_mcp_tool_calls()`, a bounded batch per statement
 * and a bounded number of batches per run, so a large backlog is worked off
 * over a few hours rather than in one long delete.
 *
 * Security: `auth: false` plus an explicit bearer check, as the sibling cron
 * routes do: `auth: true` would redirect a session-less caller, and the
 * expiry would silently never run.
 */
const TRIM_BATCH_SIZE = 5000;
const TRIM_MAX_BATCHES = 20;

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

    let trimmed = 0;

    for (let batch = 0; batch < TRIM_MAX_BATCHES; batch++) {
      const { data: deleted, error: trimError } = await admin.rpc(
        'trim_mcp_tool_calls',
        { p_batch: TRIM_BATCH_SIZE },
      );

      if (trimError) {
        logger.error({ ...ctx, error: trimError }, 'MCP tool-call trim failed');

        return NextResponse.json(
          { error: 'MCP tool-call trim failed', expired, trimmed },
          { status: 500 },
        );
      }

      trimmed += deleted;

      if (deleted < TRIM_BATCH_SIZE) break;
    }

    if (trimmed > 0) {
      logger.info({ ...ctx, trimmed }, 'Trimmed MCP tool calls past 90 days');
    }

    return NextResponse.json({ success: true, expired, trimmed });
  },
  { auth: false },
);
