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

import type { VideoDim } from '@kit/clickhouse/server';

import { buildLocalAnalyticsFixture } from './local-analytics-fixture';

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
  getClickHouseClient,
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

/** The project `supabase/seeds/analytics-mock-data.sql` creates. */
const SEEDED_PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const WEEKS = 52;

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

/**
 * Removes what an earlier run of this script wrote, and nothing else: the
 * metric rows are matched on the two `metric_source` values the fixture
 * uses, so rows a real sync wrote for the project survive a re-seed. Traffic
 * rows carry no source column; the seeded project's are all this script's.
 */
async function clearSeededProject() {
  const clickhouse = getClickHouseClient();

  const deletions = [
    'ALTER TABLE video_traffic_sources DELETE WHERE project_id = {projectId: UUID}',
    `ALTER TABLE video_metrics DELETE WHERE project_id = {projectId: UUID}
       AND metric_source IN ('backfill', 'snapshot_delta')`,
  ];

  for (const query of deletions) {
    await clickhouse.command({
      query,
      query_params: { projectId: SEEDED_PROJECT_ID },
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
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
  duration_seconds: number | null;
  episodes: {
    project_id: string;
    duration_seconds: number | null;
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
          'id, episode_id, platform, content_type, language, title, published_at, platform_connection_id, duration_seconds, episodes!inner(project_id, duration_seconds, projects!inner(account_id))',
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
        episode_duration_seconds: row.episodes?.duration_seconds ?? 0,
        // Null stays null: an unmeasured asset is `duration_unknown`, and a
        // 0 here is what FILM-1710 removed.
        asset_duration_seconds:
          row.duration_seconds && row.duration_seconds > 0
            ? row.duration_seconds
            : null,
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

  // Dimension rows are written for every publish, as sync does. The metric
  // and traffic fixture belongs to the seeded project alone: on a shared
  // local database the other publishes are other people's E2E fixtures, and
  // a year of invented views landing on them is not a favour.
  const seeded = dims.filter((dim) => dim.project_id === SEEDED_PROJECT_ID);

  if (seeded.length === 0) {
    throw new Error(
      `No published publishes in the seeded project (${SEEDED_PROJECT_ID}). ` +
        `Run \`pnpm supabase:web:reset\` to load analytics-mock-data.sql.`,
    );
  }

  const { from } = trafficWindow();
  const { traffic, metrics } = buildLocalAnalyticsFixture({
    dims: seeded,
    from,
    weeks: WEEKS,
  });

  // Both tables sort by (project_id, platform, video_id, …), so a row
  // re-seeded under its true platform does not replace the copy an earlier
  // run wrote under 'youtube' — it sits beside it. Clear the project first,
  // and wait for the mutation: an ALTER … DELETE is asynchronous by default.
  await clearSeededProject();

  await insertVideoTrafficSources(traffic);
  await insertVideoMetrics(metrics);

  const byPlatform = (rows: Array<{ platform: string }>) =>
    ['youtube', 'tiktok', 'instagram']
      .map(
        (platform) =>
          `${platform} ${rows.filter((row) => row.platform === platform).length}`,
      )
      .join(', ');

  console.log(
    [
      `Seeded local ClickHouse:`,
      `  video_dim              ${dims.length} rows`,
      `  video_traffic_sources  ${traffic.length} rows (${byPlatform(traffic)})`,
      `  video_metrics          ${metrics.length} rows (${byPlatform(metrics)})`,
      `  project                ${SEEDED_PROJECT_ID}`,
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
