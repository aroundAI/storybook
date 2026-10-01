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

/**
 * The database the app under test reads, when it is not `default`.
 *
 * A spec that changes `video_dim`'s shape cannot run against the database
 * other branches share, so it points both the server and this helper at a
 * scratch one with the same variable the app's own client reads.
 */
function database() {
  const name = process.env.CLICKHOUSE_DB;

  return name ? `&database=${encodeURIComponent(name)}` : '';
}

async function run(query: string, body?: string, settings?: string) {
  const url = `${HOST()}/?query=${encodeURIComponent(query)}${database()}${settings ?? ''}`;

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
/** `SELECT count()` over one table, for a spec that checks rows are gone. */
export async function countClickHouse(table: string, where: string) {
  const text = await run(`SELECT count() FROM ${table} WHERE ${where}`);

  return Number(text.trim());
}

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
  /**
   * The platform the rows are written under. YouTube when omitted, which is
   * what every spec before FILM-1701 meant.
   */
  platform?: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
}

function videoDimRow(video: SeededVideo) {
  return {
    video_id: video.videoId,
    project_id: video.projectId,
    account_id: video.accountId,
    connection_id: video.connectionId,
    episode_id: '00000000-0000-0000-0000-000000000000',
    platform: video.platform ?? 'youtube',
    content_type: 'long',
    language: 'en',
    // Stated, not left to the column default: omitted, it reads as "no
    // channel target", which is a claim these fixtures do not mean to make.
    channel_language: 'en',
    title: video.title,
    published_at: clickHouseDateTime(video.publishedAt),
    episode_duration_seconds: 600,
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
  /** Null for a Facebook row: no single view (migration 020, KB-153). */
  views: number | null;
  avgViewDurationSeconds?: number;
  avgViewPercentage?: number;
}

function videoMetricRow(video: SeededVideo, day: DailyMetric) {
  return {
    project_id: video.projectId,
    video_id: video.videoId,
    platform: video.platform ?? 'youtube',
    metric_date: clickHouseDate(
      new Date(video.publishedAt.getTime() + day.ageDays * 86_400_000),
    ),
    views: day.views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: (day.views ?? 0) * 60,
    subscribers_gained: 0,
    // Facebook reports no average (FILM-1720): null, as ingest writes it.
    avg_view_duration_seconds:
      day.views === null ? null : (day.avgViewDurationSeconds ?? 120),
    avg_view_percentage:
      day.views === null ? null : (day.avgViewPercentage ?? 40),
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

/**
 * An audience-retention curve, which platforms report as normalized
 * positions through the video rather than seconds.
 *
 * Only YouTube feeds `video_retention_curves`, so a seeded TikTok or
 * Instagram publish legitimately has no curve and the chart renders empty.
 */
export async function seedRetentionCurve(
  video: SeededVideo,
  points: Array<{ elapsedRatio: number; audienceWatchRatio: number }>,
) {
  await insertClickHouse(
    'video_retention_curves',
    points.map((point) => ({
      project_id: video.projectId,
      video_id: video.videoId,
      platform: 'youtube',
      elapsed_ratio: point.elapsedRatio,
      audience_watch_ratio: point.audienceWatchRatio,
    })),
  );
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
    })),
  );
}

/**
 * One row of `video_audience`: a share of one video's audience, for one key
 * of one dimension.
 *
 * `views` is the absolute count where the platform reports one (YouTube's
 * device, country), and `percentage` is the share where it reports only that
 * (age, gender, and everything TikTok sends). A row carries one or the other,
 * and the Audience read weights a percentage by the video's own views.
 */
export interface AudienceRow {
  dimension:
    | 'age_group'
    | 'gender'
    | 'country'
    | 'city'
    | 'device'
    | 'os'
    | 'follower_status';
  key: string;
  views?: number;
  percentage?: number;
}

/** Audience breakdown rows for several videos, in one request. */
export async function seedVideoAudience(
  entries: Array<{ video: SeededVideo; rows: AudienceRow[] }>,
) {
  await insertClickHouse(
    'video_audience',
    entries.flatMap(({ video, rows }) =>
      rows.map((row) => ({
        project_id: video.projectId,
        video_id: video.videoId,
        platform: video.platform ?? 'youtube',
        dimension: row.dimension,
        key: row.key,
        views: row.views ?? 0,
        percentage: row.percentage ?? 0,
      })),
    ),
  );
}
