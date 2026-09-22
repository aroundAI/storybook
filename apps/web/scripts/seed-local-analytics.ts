/**
 * Seed the local ClickHouse with a year of analytics for the seeded project,
 * so the Deep Dive tab renders real numbers instead of empty states.
 *
 * Why this exists: production ClickHouse holds nothing, and traffic-source
 * rows are the slowest kind to arrive — they come only from YouTube's bulk
 * report jobs, which lag 1-3 days and backfill ~30 days from job creation.
 * The Deep Dive cards are 52-week charts whose interesting behaviour (quiet
 * weeks, zero-view weeks, sub-pixel slices, the 60% threshold, horizontal
 * scroll) needs a year of shaped data. Waiting for that to occur naturally
 * means shipping the UI unlooked-at for months.
 *
 * Postgres is *not* touched: `supabase/seeds/analytics-mock-data.sql`
 * already provides the account, project and publishes. This only fills the
 * ClickHouse side, which is the half that is missing.
 *
 *   set -a && . deployment/config/local.env && set +a
 *   pnpm --filter web seed:local-analytics
 */
import { createClient } from '@supabase/supabase-js';

import type {
  VideoDim,
  VideoMetric,
  VideoTrafficSource,
} from '@kit/clickhouse/server';

/**
 * Loaded dynamically, not with a static named import.
 *
 * `apps/web` is `"type": "module"` and `@kit/clickhouse` is not, so under tsx
 * the barrel transpiles to CJS while this file stays ESM. Node then resolves
 * its named exports with cjs-module-lexer, which cannot see through the
 * barrel's `export { … } from '../queries-advanced'` chain and fails the
 * static link with "does not provide an export named". A dynamic import gets
 * the real module object instead, and the type-only import above is erased,
 * so nothing else here touches that boundary.
 *
 * Next's bundler has no such problem, which is why app code imports this
 * package normally.
 */
const {
  insertVideoDims,
  insertVideoMetrics,
  insertVideoTrafficSources,
  isClickHouseEnabled,
} = await import('@kit/clickhouse/server');

const { fetchAllRows } = await import('@kit/shared/pagination');

// Its own statement so it does not contend with edits to the list above.
const { LANGUAGE_NOT_SET, toDimLanguage } = await import(
  '@kit/clickhouse/server'
);

/**
 * Mirrors `dim-sync.ts:21`. Redeclared rather than imported because that
 * module is `server-only`, which throws outside a Next runtime.
 */
const UNATTRIBUTED_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

const WEEKS = 52;
const DAY_MS = 86_400_000;

/**
 * Deterministic, so re-running does not move the numbers under a screenshot
 * that was already reviewed. A seeded LCG rather than Math.random.
 */
function makeRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
}

/** Mirrors `dim-sync.ts:228` so the fixture cannot drift from real sync. */
function toClickHouseDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The window the Deep Dive tab actually asks for: both edges snapped to the
 * Sunday `toStartOfWeek` buckets on, ending at the last complete week. Rows
 * outside it are invisible, so the fixture is generated against the same
 * arithmetic rather than a guess.
 */
function trafficWindow() {
  const currentWeekStart = new Date(`${isoDate(new Date())}T00:00:00.000Z`);

  currentWeekStart.setUTCDate(
    currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay(),
  );

  const from = new Date(currentWeekStart);

  from.setUTCDate(from.getUTCDate() - WEEKS * 7);

  return { from, currentWeekStart };
}

interface PublishRow {
  id: string;
  episode_id: string;
  platform: string;
  content_type: string | null;
  language: string | null;
  title: string | null;
  published_at: string;
  platform_connection_id: string | null;
  episodes: {
    project_id: string;
    duration_seconds: number | null;
    target_duration_seconds: number | null;
    projects: { account_id: string } | null;
  } | null;
}

async function main() {
  const host = process.env.CLICKHOUSE_HOST ?? '';

  // A seeding script that can reach production is a foot-gun, and production
  // ClickHouse is about to be configured. Refuse anything but localhost.
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(host)) {
    throw new Error(
      `Refusing to seed: CLICKHOUSE_HOST is "${host || '(unset)'}", not localhost. ` +
        `Run: set -a && . deployment/config/local.env && set +a`,
    );
  }

  if (!isClickHouseEnabled()) {
    throw new Error(
      'CLICKHOUSE_ENABLED is not "true" — inserts would silently no-op.',
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset.',
    );
  }

  const client = createClient(supabaseUrl, serviceKey);

  // Paged, and ordered by `id` rather than `published_at`. PostgREST caps a
  // read at max_rows and signals it with a short body, HTTP 200 and
  // `error: null` — so an unpaged read of a large local database would build
  // video_dim from the first 1000 publishes and then print a row count that
  // looks complete. Range pagination also needs a *unique* order, which
  // `published_at` is not: two publishes sharing a timestamp can be skipped
  // or repeated across page boundaries.
  const publishes = await fetchAllRows<PublishRow>(
    (from, to) =>
      client
        .from('publishes')
        .select(
          'id, episode_id, platform, content_type, language, title, published_at, platform_connection_id, episodes!inner(project_id, duration_seconds, target_duration_seconds, projects!inner(account_id))',
        )
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: PublishRow[] | null;
        error: { message: string } | null;
      }>,
    'publishes',
  );

  if (publishes.length === 0) {
    throw new Error(
      'No published publishes found. Run `pnpm --filter web supabase db reset` first.',
    );
  }

  // Built exactly as dim-sync.ts:143-166 builds them, so what the cards read
  // here is shaped like what production sync writes.
  const dims: VideoDim[] = publishes.flatMap((row) => {
    const projectId = row.episodes?.project_id;
    const accountId = row.episodes?.projects?.account_id;

    if (!projectId || !accountId) return [];

    return [
      {
        video_id: row.id,
        project_id: projectId,
        account_id: accountId,
        episode_id: row.episode_id,
        connection_id: row.platform_connection_id ?? UNATTRIBUTED_CONNECTION_ID,
        platform: row.platform,
        content_type: row.content_type ?? 'full',
        language: toDimLanguage(row.language),
        // The seeded publishes have no channel, so there is no target to
        // read; dim-sync resolves it through the connection where one exists.
        channel_language: LANGUAGE_NOT_SET,
        title: row.title ?? '',
        published_at: toClickHouseDateTime(row.published_at),
        duration_seconds:
          row.episodes?.duration_seconds ??
          row.episodes?.target_duration_seconds ??
          0,
        tags: [],
      },
    ];
  });

  // Every other precondition here fails with something actionable; without
  // this one an empty `dims` would not. The rows are read through `!inner`
  // joins so the flatMap should never drop all of them — but `data` is cast
  // to PublishRow[] rather than checked, so the nullability is unverified,
  // and `week % 0` is NaN, which indexes to undefined and surfaces three
  // lines later as "Cannot read properties of undefined (reading
  // 'project_id')".
  if (dims.length === 0) {
    throw new Error(
      `Read ${publishes.length} publishes but none carried an episode and project. ` +
        `Check that episodes.project_id and projects.account_id are populated.`,
    );
  }

  await insertVideoDims(dims);

  const { from } = trafficWindow();
  const random = makeRandom(1605);

  const traffic: VideoTrafficSource[] = [];
  const metrics: VideoMetric[] = [];

  for (let week = 0; week < WEEKS; week++) {
    const date = new Date(from.getTime() + week * 7 * DAY_MS);
    const metricDate = isoDate(date);

    // Weeks 9-12 are left with no rows at all, so the tab's gap-fill has
    // something real to fill and a reviewer can see quiet weeks rendered in
    // place rather than as a shorter chart.
    if (week >= 9 && week <= 12) continue;

    const dim = dims[week % dims.length]!;

    // Week 20 gets rows that sum to zero views — distinct from a missing
    // week, and the case both cards label "no views".
    const zeroWeek = week === 20;

    // Browse+Suggested climbs across the year and crosses 60% near the end,
    // so the threshold line has a real crossing to sit against rather than a
    // flat series on one side of it.
    const browseShare = zeroWeek ? 0 : 0.28 + (week / WEEKS) * 0.45;
    const total = zeroWeek ? 0 : 1_200 + Math.round(random() * 2_400);

    const split: Array<[string, number]> = [
      ['RELATED_VIDEO', browseShare * 0.62],
      ['SUBSCRIBER', browseShare * 0.26],
      ['NOTIFICATION', browseShare * 0.12],
      ['YT_SEARCH', (1 - browseShare) * 0.44],
      ['EXTERNAL_URL', (1 - browseShare) * 0.16],
      ['SHORTS', (1 - browseShare) * 0.14],
      ['PLAYLIST', (1 - browseShare) * 0.12],
      ['CHANNEL_PAGE', (1 - browseShare) * 0.09],
      ['DIRECT_OR_UNKNOWN', (1 - browseShare) * 0.04],
      // Deliberately under 1% of the week, to exercise the minimum slice
      // height that three review rounds went back and forth over.
      ['END_SCREEN', (1 - browseShare) * 0.01],
    ];

    for (const [source, share] of split) {
      const views = Math.round(total * share);

      if (views === 0 && !zeroWeek) continue;

      traffic.push({
        project_id: dim.project_id,
        video_id: dim.video_id,
        platform: 'youtube',
        metric_date: metricDate,
        source,
        views,
        watch_time_minutes: Math.round(views * 2.4),
      });
    }

    // So the sibling Deep Dive cards are not empty beside the traffic ones.
    metrics.push({
      project_id: dim.project_id,
      video_id: dim.video_id,
      platform: 'youtube',
      metric_date: metricDate,
      views: total,
      likes: Math.round(total * 0.04),
      comments: Math.round(total * 0.006),
      shares: Math.round(total * 0.003),
      saves: 0,
      watch_time_seconds: Math.round(total * 144),
      revenue_cents: 0,
      subscribers_gained: Math.round(total * 0.01),
      subscribers_lost: Math.round(total * 0.002),
      metric_source: 'backfill',
      extra_metrics: '{}',
    });
  }

  await insertVideoTrafficSources(traffic);
  await insertVideoMetrics(metrics);

  const project = dims[0]?.project_id;

  console.log(
    [
      `Seeded local ClickHouse:`,
      `  video_dim              ${dims.length} rows`,
      `  video_traffic_sources  ${traffic.length} rows`,
      `  video_metrics          ${metrics.length} rows`,
      `  project                ${project}`,
      `  window                 ${isoDate(from)} .. (last complete week)`,
      `  weeks with no rows     9-12 (gap-fill)`,
      `  week with zero views   20`,
      ``,
      `  pnpm --filter web dev`,
      `  http://localhost:3000/home/storybook/studio/the-chronicles/analytics`,
    ].join('\n'),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
