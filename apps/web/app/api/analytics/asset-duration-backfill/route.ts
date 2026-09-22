import { NextResponse } from 'next/server';

import { runAssetDurationBackfillBatch } from '@kit/content-analytics/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';

/**
 * POST /api/analytics/asset-duration-backfill
 *
 * Fills `publishes.duration_seconds` for YouTube and TikTok assets published
 * before the column existed (FILM-1710), then re-upserts them into
 * `video_dim`. The hourly sync only fills publishes it still visits.
 *
 * Invoke repeatedly, passing the previous response's `nextAfterId` as
 * `afterId`, until `nextAfterId` is null. `remaining: 0` alone is not the
 * signal: a publish whose provider cannot report a duration stays a candidate.
 *
 * Query params:
 * - dryRun=true       count candidates without calling a provider or writing
 * - maxPublishes=N    cap publishes examined this invocation (default 500)
 * - afterId=<uuid>    resume after this publish id
 *
 * TikTok rows come back under `gaps.scope_missing` until FILM-1711 adds the
 * `video.list` scope; they are left null, not guessed.
 *
 * Security: protected by CRON_SECRET bearer token.
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'api.analytics.asset-duration-backfill' };

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
      logger.warn(ctx, 'Unauthorized asset duration backfill request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const afterId = url.searchParams.get('afterId');

    if (afterId && !UUID.test(afterId)) {
      return NextResponse.json(
        { error: 'afterId must be a publish id' },
        { status: 400 },
      );
    }

    try {
      const batch = await runAssetDurationBackfillBatch({
        dryRun: url.searchParams.get('dryRun') === 'true',
        maxPublishes: parsePositiveInt(url.searchParams.get('maxPublishes')),
        afterId: afterId ?? undefined,
      });

      // The counts, not the id list: `written` already says how many.
      const result = { ...batch, writtenIds: undefined };

      logger.info({ ...ctx, ...result }, 'Asset duration backfill batch');

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      logger.error(
        {
          ...ctx,
          error: error instanceof Error ? error.message : String(error),
        },
        'Asset duration backfill batch failed',
      );

      return NextResponse.json(
        { success: false, error: 'Internal error' },
        { status: 500 },
      );
    }
  },
  {
    auth: false, // Cron auth handled manually
  },
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
