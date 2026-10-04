import 'server-only';

import type { z } from 'zod';

import {
  isClickHouseEnabled,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryRetentionCurveFetchedAt,
  queryRetentionCurves,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';

import { ActionRefusal } from '../lib/action-result';
import { resolveAssetDuration } from '../lib/asset-duration';
import { type EditStyle, deriveEditStyle } from '../lib/edit-style';
import { detectRetentionCliff } from '../lib/retention';
import {
  type EpisodeAnalyticsSchema,
  MAX_DIAGNOSTIC_VIDEOS,
  type RetentionCurveSchema,
  type WeeklyDiagnosticsSchema,
} from '../lib/schemas/diagnostics.schema';
import { getEpisodeAnalytics } from './aggregation-queries';
import type { AnalyticsClient } from './analytics-client';
import { assertScopeAccess } from './scope-access';

/**
 * The diagnostics reads as services (FILM-1906): each takes the caller's
 * client and the action's parsed input; `diagnostics-actions.ts` is the
 * `'use server'` wrapper. A refusal is thrown as an `ActionRefusal`, as the
 * actions always have; the wrapper's `withRefusals` turns it into a value.
 */

export interface DiagnosticRow {
  publishId: string;
  title: string;
  platform: string;
  publishedAt: string;
  views: number;
  impressions: number;
  ctr: number;
  /** Null when the platform does not measure it (KB-111). */
  avgViewDurationSeconds: number | null;
  cliff?: { position: number; drop: number; seconds?: number } | null;
}

export type WeeklyDiagnosticsInput = z.infer<typeof WeeklyDiagnosticsSchema>;

/**
 * Recently published videos with the numbers that say whether something
 * broke this week (FILM-1616).
 *
 * A breakage check, not a strategy input: a 2% CTR means the packaging
 * failed on that video and a sharp early retention drop means its intro
 * did. The deep-dive cards answer "what should we make next"; this answers
 * "did something break", and the two must not be read as the same kind of
 * claim.
 *
 * Bounded three ways, and it needs all three: a date window, a hard video
 * cap, and — before the query was batched — a concurrency limit. The first
 * two bound the work; the batch is what bounds the load.
 */
export async function getWeeklyDiagnosticsService(
  client: AnalyticsClient,
  { scope, sinceDays, limit }: WeeklyDiagnosticsInput,
): Promise<DiagnosticRow[]> {
  // Before any query. ClickHouse is outside Postgres RLS, so this is
  // what makes the publish list below the caller's own.
  await assertScopeAccess(client, scope);

  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Paged. FILM-1612 exists because an unbounded `.select()` returns a
  // short body with HTTP 200 and `error: null`, so a truncated read is
  // indistinguishable from a complete one.
  const publishes = await fetchAllRows<{
    id: string;
    title: string | null;
    platform: string;
    published_at: string | null;
  }>((from, to) => {
    let query = client
      .from('publishes')
      .select(
        'id, title, platform, published_at, episodes!inner(project_id, projects!inner(account_id))',
      )
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .gte('published_at', since);

    if (scope.projectId) {
      query = query.eq('episodes.project_id', scope.projectId);
    } else {
      query = query.eq('episodes.projects.account_id', scope.accountId!);
    }

    // The channel filter, honoured rather than accepted and dropped.
    // `assertScopeAccess` validates a `connectionId` belongs to the
    // caller, so without this a scoped read passed the check and then
    // silently answered for every channel.
    if (scope.connectionId) {
      query = query.eq('platform_connection_id', scope.connectionId);
    }

    // The page's platform filter (FILM-1709), honoured the same way.
    if (scope.platforms) {
      query = query.in('platform', scope.platforms);
    }

    return query.order('published_at', { ascending: false }).range(from, to);
  }, 'weekly diagnostics publishes');

  if (publishes.length === 0) return [];

  const projectIds = scope.projectId ? [scope.projectId] : undefined;
  const recent = publishes.slice(0, Math.min(limit, MAX_DIAGNOSTIC_VIDEOS));

  if (publishes.length > recent.length) {
    const logger = await getLogger();

    logger.warn(
      {
        name: 'analytics.weekly-diagnostics',
        published: publishes.length,
        shown: recent.length,
      },
      'Diagnostics capped; the window held more videos than the limit',
    );
  }

  const videoIds = recent.map((publish) => publish.id);

  // Views live in the daily metrics, not the quality read — that one
  // carries impressions, CTR and the duration averages.
  //
  // `totals` is also the gate on which videos appear at all. A publish
  // with no daily rows has not been measured, and every number on its
  // row would be a zero standing in for "not known" — `views` renders
  // as "0", which reads as nobody watched. §3 forbids exactly that for
  // the curve; it is no better for the row. The scheduled report
  // narrows the same way (`analyticsMap.has(id)`), and it is why §8
  // says the table renders no rows with ClickHouse off.
  const [quality, curves, totals] = await Promise.all([
    queryQualityMetricsForVideos({
      videoIds,
      ...(projectIds && { projectIds }),
    }),
    queryRetentionCurves({ videoIds, ...(projectIds && { projectIds }) }),
    queryTotalsByVideoIds(videoIds, { ...(projectIds && { projectIds }) }),
  ]);

  return recent
    .filter((publish) => totals.has(publish.id))
    .map((publish) => {
      const metrics = quality.get(publish.id);
      const points = curves.get(publish.id);

      return {
        publishId: publish.id,
        title: publish.title ?? 'Untitled',
        platform: publish.platform,
        // Never null in practice — the query filters it out — but the
        // column is nullable and the row type says so.
        publishedAt: publish.published_at ?? '',
        views: totals.get(publish.id)?.views ?? 0,
        impressions: metrics?.impressions ?? 0,
        ctr: metrics?.impressionsCtr ?? 0,
        avgViewDurationSeconds: metrics?.avgViewDurationSeconds ?? null,
        // Detected, never stored: nothing writes a `has_cliff` column
        // that could go stale against a re-fetched curve. A video with
        // no curve is `null` — not a flat zero, which would render as a
        // video nobody watched.
        cliff: points ? detectRetentionCliff(points) : null,
      };
    });
}

export type RetentionCurveInput = z.infer<typeof RetentionCurveSchema>;

/**
 * One video's retention curve, for the drill-down (FILM-1616 §2).
 *
 * The only read in this package that takes a bare resource id rather than
 * a scope object, which is what makes the check below the whole of the
 * defence. `queryRetentionCurve` carries no tenant predicate of its own and
 * ClickHouse is outside Postgres RLS, so handing it a caller-supplied
 * `publishId` unchecked returns any tenant's curve to anyone who can guess
 * a uuid. KB-9 removed the Hook Lab for exactly that, on this table.
 *
 * The publish is resolved on the **user-scoped** client so RLS answers the
 * question, and no row means not-found. Never the admin client, and never a
 * membership comparison against an account id the caller also supplied —
 * both would answer "does this row exist", not "may this caller see it".
 *
 * `duration` is the published asset's own (FILM-1710), read from the row RLS
 * just let through — never the episode's, which is what would label a
 * Short's cliff past the end of the clip. It is an `AssetDuration`, not a
 * number: where the platform has not reported one (every Instagram publish,
 * and anything not yet backfilled) the caller gets `duration_unknown` and the
 * cliff keeps its position without a timestamp.
 */
export async function getRetentionCurveService(
  client: AnalyticsClient,
  { publishId }: RetentionCurveInput,
) {
  const { data: publish } = await client
    .from('publishes')
    .select('id, duration_seconds, episodes!inner(project_id)')
    .eq('id', publishId)
    .maybeSingle();

  if (!publish) {
    // Logged, not only refused. §9 names the risk as "a cross-tenant
    // disclosure with no error and no log line": the disclosure is
    // prevented above, but `withRefusals` returns a refusal as a value
    // without logging it, so a caller walking publish ids would be
    // refused silently and indefinitely. Logged here rather than in
    // `withRefusals`, where most refusals are ordinary user outcomes.
    const logger = await getLogger();

    logger.warn(
      { name: 'analytics.retention-curve', publishId },
      'Refused a retention curve for a publish the caller cannot see',
    );

    throw new ActionRefusal('That video is not in your library.');
  }

  const episode = publish.episodes as { project_id: string } | null;

  const points = await queryRetentionCurve({
    videoId: publishId,
    // The read-volume bound from #274, not the check above. Safe to
    // pass only because the project came from a row RLS already let
    // through.
    ...(episode?.project_id && { projectIds: [episode.project_id] }),
  });

  return {
    points,
    duration: resolveAssetDuration(publish.duration_seconds),
  };
}

export type EpisodeAnalyticsInput = z.infer<typeof EpisodeAnalyticsSchema>;

/**
 * One episode's analytics, for the episode page (FILM-1616).
 *
 * No `assertScopeAccess` here, and none is missing: it takes an episode id,
 * not a scope, and resolves it on the user-scoped client — the same shape as
 * the retention curve above, with RLS as the gate. Its ClickHouse read is
 * keyed on publish ids that RLS already filtered.
 */
export async function getEpisodeAnalyticsService(
  client: AnalyticsClient,
  { episodeId }: EpisodeAnalyticsInput,
) {
  const analytics = await getEpisodeAnalytics(episodeId, undefined, client);

  if (!analytics) {
    throw new ActionRefusal('That episode is not in your library.');
  }

  return analytics;
}

/**
 * The episode's YouTube publish, if it has one — the id the retention
 * drill-down needs.
 *
 * `video_retention_curves` is fed only by the YouTube path, so an episode
 * published elsewhere legitimately has no curve and the chart renders its
 * empty state rather than a flat zero line.
 */
export async function getEpisodeRetentionPublishService(
  client: AnalyticsClient,
  { episodeId }: EpisodeAnalyticsInput,
) {
  // Not `maybeSingle()`: it errors when the query matches more than
  // one row, and an episode published to two YouTube channels is
  // ordinary — `publishes.episode_id` is a plain index with no
  // (episode_id, platform) constraint. Asserting one row turned that
  // into a discarded error and a retention section that silently did
  // not render.
  const { data: publishes, error } = await client
    .from('publishes')
    .select('id, published_at')
    .eq('episode_id', episodeId)
    .eq('platform', 'youtube')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1);

  // A failed lookup is not "this episode has no video". Saying so lets
  // the page report a failure instead of an absence.
  if (error) {
    throw new Error(`Failed to resolve the episode's video: ${error.message}`);
  }

  return { publishId: publishes?.[0]?.id ?? null };
}

/**
 * One episode's retention curve as the edit package needs it (FILM-2001),
 * with "no curve" told apart by its reason:
 *
 * - `unmeasured`: ClickHouse is off, so nothing was measured
 * - `no_published_video`: no published YouTube video to have a curve
 * - `no_curve`: the video exists and no curve has been fetched yet
 *
 * The episode is resolved on the caller's client, as the retention curve
 * above is: RLS is the gate, and the ClickHouse reads are keyed on a
 * publish RLS let through.
 */
export type EpisodeRetentionCurveResult =
  | { state: 'unmeasured' }
  | { state: 'no_published_video' }
  | { state: 'no_curve'; publishId: string }
  | {
      state: 'curve';
      publishId: string;
      platform: string;
      asOf: string;
      durationSeconds: number | null;
      points: Array<{ elapsedRatio: number; audienceWatchRatio: number }>;
    };

export async function getEpisodeRetentionCurveService(
  client: AnalyticsClient,
  { episodeId }: EpisodeAnalyticsInput,
): Promise<EpisodeRetentionCurveResult> {
  if (!isClickHouseEnabled()) return { state: 'unmeasured' };

  const { publishId } = await getEpisodeRetentionPublishService(client, {
    episodeId,
  });

  if (!publishId) return { state: 'no_published_video' };

  const curve = await getRetentionCurveService(client, { publishId });
  const { data: episode } = await client
    .from('episodes')
    .select('project_id')
    .eq('id', episodeId)
    .maybeSingle();
  const fetched = await queryRetentionCurveFetchedAt({
    videoId: publishId,
    ...(episode?.project_id && { projectIds: [episode.project_id] }),
  });

  if (curve.points.length === 0 || !fetched) {
    return { state: 'no_curve', publishId };
  }

  return {
    state: 'curve',
    publishId,
    platform: fetched.platform,
    asOf: fetched.asOf,
    durationSeconds: curve.duration.known ? curve.duration.seconds : null,
    points: curve.points,

 * The episode's latest delivered StorybookStudio edit, as the Edit style
 * card shows it (FILM-2006). Read on the caller's client, so RLS decides
 * whether they may see the session. `none` is "never delivered from the
 * Studio" — the card does not render — and `style: null` is a delivery
 * whose report could not be read, which the page says rather than hides.
 */
export type EpisodeEditStyleResult =
  | { status: 'none' }
  | {
      status: 'delivered';
      sessionId: string;
      deliveredAt: string;
      style: EditStyle | null;
    };

export async function getEpisodeEditStyleService(
  client: AnalyticsClient,
  { episodeId }: EpisodeAnalyticsInput,
): Promise<EpisodeEditStyleResult> {
  const [sessions, episode] = await Promise.all([
    client
      .from('edit_sessions')
      .select('id, delivered_at, summary')
      .eq('episode_id', episodeId)
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
    client
      .from('episodes')
      .select('target_duration_seconds')
      .eq('id', episodeId)
      .maybeSingle(),
  ]);

  if (sessions.error) {
    throw new Error(
      `Failed to read the episode's edit sessions: ${sessions.error.message}`,
    );
  }

  if (episode.error) {
    throw new Error(`Failed to read the episode: ${episode.error.message}`);
  }

  const session = sessions.data?.[0];

  if (!session?.delivered_at) return { status: 'none' };

  return {
    status: 'delivered',
    sessionId: session.id,
    deliveredAt: session.delivered_at,
    style: deriveEditStyle({
      summary: session.summary,
      episodeTargetDurationSeconds:
        episode.data?.target_duration_seconds ?? null,
    }),
  };
}
