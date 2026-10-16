import { NextResponse } from 'next/server';

import {
  labelCommentsOnServer,
  serverCommentLabellingEnabled,
} from '@kit/content-analytics/server/comment-labelling';
import {
  COMMENT_FETCHERS,
  runCommentSync,
} from '@kit/content-analytics/server/comment-sync';
import { enhanceRouteHandler } from '@kit/next/routes';
import { ensureValidToken } from '@kit/publishing/token-refresh';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/**
 * Hourly audience comment sync (FILM-1733).
 *
 * Deletes YouTube comments not refreshed for 30 days, reads the comments of
 * the videos that are due, and, only when SERVER_COMMENT_LABELS_ENABLED is
 * set, opens the server's labelling run for each project with unlabelled
 * comments. Otherwise they wait for the team's own AI over MCP.
 *
 * Security: `auth: false` plus an explicit bearer check, as the sibling cron
 * routes do — `auth: true` would redirect a session-less caller, and the
 * sync would silently never run.
 */
export const GET = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'cron.comment-sync' };

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
      const client = getSupabaseServerAdminClient();
      const result = await runCommentSync({
        client,
        now: new Date(),
        fetchers: COMMENT_FETCHERS,
        ensureValidToken,
        // Off unless SERVER_COMMENT_LABELS_ENABLED: comments then wait for
        // the team's own AI over MCP, and no model is called here
        labelComments: async (projects) => {
          if (serverCommentLabellingEnabled()) {
            await labelCommentsOnServer(client, projects);
          }
        },
      });

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      logger.error({ ...ctx, error }, 'Comment sync run failed');

      return NextResponse.json(
        { error: 'Comment sync failed' },
        { status: 500 },
      );
    }
  },
  { auth: false },
);
