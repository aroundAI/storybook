/**
 * Writing rows to ClickHouse from a spec.
 *
 * ClickHouse holds the metrics the analytics surfaces read, and no seed
 * helper in `seed.ts` reaches it: it is a separate store with its own
 * connection and no row-level security. Specs that need figures on screen —
 * rather than the empty states everything shows with ClickHouse off — seed
 * them here.
 *
 * Only for specs gated behind an env flag: the 🧬 E2E job runs a ClickHouse
 * container, and the ⚫️ Test job does not.
 */
const HOST = () => process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123';

function authHeader() {
  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function run(query: string, body?: string, settings?: string) {
  const url = `${HOST()}/?query=${encodeURIComponent(query)}${settings ?? ''}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `ClickHouse rejected \`${query.slice(0, 80)}\`: ${await response.text()}`,
    );
  }

  return response.text();
}

export async function insertClickHouse(table: string, rows: object[]) {
  if (rows.length === 0) return;

  await run(
    `INSERT INTO ${table} FORMAT JSONEachRow`,
    rows.map((row) => JSON.stringify(row)).join('\n'),
  );
}

/**
 * Removes rows, and waits for the removal to take effect.
 *
 * A ClickHouse delete is a mutation, which is asynchronous by default — a
 * spec that deleted and then read immediately would see the rows it just
 * deleted, intermittently. `mutations_sync=2` makes the request wait.
 */
export async function deleteClickHouse(table: string, where: string) {
  await run(
    `ALTER TABLE ${table} DELETE WHERE ${where}`,
    undefined,
    '&mutations_sync=2',
  );
}

/** `YYYY-MM-DD HH:MM:SS` in UTC, the format every DateTime column takes. */
export function clickHouseDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function clickHouseDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Midnight UTC, `days` days ago.
 *
 * Midnight rather than "this time of day": the lag between a publication
 * and the first day of metrics is whole days, and a publication at 02:43
 * makes a first metric 40 days later read as 39 — so a spec asserting an
 * exact lag would pass or fail on the hour it ran at.
 */
export function daysAgo(days: number, from = new Date()) {
  const date = new Date(from);

  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);

  return date;
}

export interface SeededVideo {
  /** `video_dim.video_id`, which is the publish's id — the join to Postgres. */
  videoId: string;
  projectId: string;
  accountId: string;
  connectionId: string;
  title: string;
  publishedAt: Date;
}

function videoDimRow(video: SeededVideo) {
  return {
    video_id: video.videoId,
    project_id: video.projectId,
    account_id: video.accountId,
    connection_id: video.connectionId,
    episode_id: '00000000-0000-0000-0000-000000000000',
    platform: 'youtube',
    content_type: 'long',
    language: 'en',
    title: video.title,
    published_at: clickHouseDateTime(video.publishedAt),
    duration_seconds: 600,
    tags: [],
    updated_at: clickHouseDateTime(new Date()),
  };
}

/**
 * Several videos in the dimension table, in one request.
 *
 * One request rather than one per video, because ClickHouse writes a part
 * per INSERT: a spec seeding a hundred videos a row at a time leaves two
 * hundred one-row parts behind for every later read to merge through, and
 * pays a round trip for each.
 */
export async function seedVideoDims(videos: SeededVideo[]) {
  await insertClickHouse('video_dim', videos.map(videoDimRow));
}

/**
 * One video in the dimension table, as the publish-success hook writes it.
 *
 * `video_dim` is what the Video Log lists, so a publish that is not here is
 * not in the table however complete its Postgres row is.
 */
export async function seedVideoDim(video: SeededVideo) {
  await seedVideoDims([video]);
}

export interface DailyMetric {
  /** Days after publication, so a spec states the age it means. */
  ageDays: number;
  views: number;
  revenueCents?: number;
  avgViewDurationSeconds?: number;
  avgViewPercentage?: number;
}

function videoMetricRow(video: SeededVideo, day: DailyMetric) {
  return {
    project_id: video.projectId,
    video_id: video.videoId,
    platform: 'youtube',
    metric_date: clickHouseDate(
      new Date(video.publishedAt.getTime() + day.ageDays * 86_400_000),
    ),
    views: day.views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: day.views * 60,
    revenue_cents: day.revenueCents ?? 0,
    subscribers_gained: 0,
    avg_view_duration_seconds: day.avgViewDurationSeconds ?? 120,
    avg_view_percentage: day.avgViewPercentage ?? 40,
    dislikes: 0,
  };
}

/** Daily rows for several videos, in one request. See `seedVideoDims`. */
export async function seedVideoMetricsBatch(
  entries: Array<{ video: SeededVideo; days: DailyMetric[] }>,
) {
  await insertClickHouse(
    'video_metrics',
    entries.flatMap(({ video, days }) =>
      days.map((day) => videoMetricRow(video, day)),
    ),
  );
}

/**
 * Daily rows for a video. Inserted into `video_metrics`, because
 * `video_daily_stats` is a view over it.
 */
export async function seedVideoMetrics(
  video: SeededVideo,
  days: DailyMetric[],
) {
  await seedVideoMetricsBatch([{ video, days }]);
}

/** Impressions and click-through rate, which live in their own table. */
export async function seedVideoReach(
  video: SeededVideo,
  days: Array<{ ageDays: number; impressions: number; ctr: number }>,
) {
  await insertClickHouse(
    'video_reach_daily',
    days.map((day) => ({
      project_id: video.projectId,
      video_id: video.videoId,
      platform: 'youtube',
      metric_date: clickHouseDate(
        new Date(video.publishedAt.getTime() + day.ageDays * 86_400_000),
      ),
      impressions: day.impressions,
      impressions_ctr: day.ctr,
      engaged_views: 0,
    })),
  );
}
