/**
 * Parsers for YouTube Reporting API (Bulk Reports) CSV files.
 *
 * Pure functions — no I/O — so they are unit-testable against fixture
 * files. Parsing is header-driven (column names, never positions): report
 * versions add columns over time (e.g. engaged_views in 2025) and rows
 * carry extra dimensions (subscribed_status, country_code, …) that must be
 * aggregated away to per-video per-day values.
 */

/** Per-video per-day core metrics from channel_basic_a3. */
export interface BasicReportRow {
  date: string; // YYYY-MM-DD
  youtubeVideoId: string;
  views: number;
  engagedViews: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  /** Gross gains. Net movement is subscribersGained - subscribersLost. */
  subscribersGained: number;
  /** Gross losses, kept separate so the column name stays honest. */
  subscribersLost: number;
  /** View-weighted average view duration in seconds. */
  avgViewDurationSeconds: number;
  /** View-weighted average view percentage (0-100). */
  avgViewPercentage: number;
}

/** Per-video per-day per-source metrics from channel_traffic_source_a3. */
export interface TrafficSourceReportRow {
  date: string;
  youtubeVideoId: string;
  source: string;
  views: number;
  watchTimeMinutes: number;
}

/** Per-video per-day reach metrics from channel_reach_*_a1. */
export interface ReachReportRow {
  date: string;
  youtubeVideoId: string;
  impressions: number;
  impressionsCtr: number;
  engagedViews: number;
}

/**
 * Reporting API numeric traffic_source_type codes → readable names.
 * Codes confirmed by the API changelog; unknown codes fall back to
 * `TS_<code>` so no data is dropped. Verify against current docs before
 * building the Browse/Suggested share query on top (FILM-1506).
 */
const TRAFFIC_SOURCE_CODES: Record<string, string> = {
  '0': 'DIRECT_OR_UNKNOWN',
  '1': 'ADVERTISING',
  '2': 'ANNOTATION',
  '3': 'SUBSCRIBER',
  '4': 'CHANNEL_PAGE',
  '5': 'YT_SEARCH',
  '7': 'RELATED_VIDEO',
  '9': 'EXTERNAL_URL',
  '14': 'PLAYLIST',
  '17': 'NOTIFICATION',
  '18': 'PLAYLIST_PAGE',
  '20': 'END_SCREEN',
  '24': 'SHORTS',
  '25': 'PRODUCT_PAGE',
  '26': 'HASHTAG_PAGE',
  '27': 'SOUND_PAGE',
  '28': 'LIVE_REDIRECT',
  '30': 'VIDEO_REMIXES',
};

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function parseCsv(csv: string): ParsedCsv {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Bulk report CSVs are plain comma-separated with no quoted fields.
  const headers = lines[0]!.split(',').map((header) => header.trim());
  const rows = lines.slice(1).map((line) => line.split(','));

  return { headers, rows };
}

function columnIndex(headers: string[], name: string): number {
  return headers.indexOf(name);
}

function numberAt(row: string[], index: number): number {
  if (index < 0) return 0;
  const value = Number(row[index]);
  return Number.isFinite(value) ? value : 0;
}

function stringAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '') : '';
}

/** Bulk reports use YYYYMMDD dates; ClickHouse wants YYYY-MM-DD. */
function normalizeDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

/**
 * Parse channel_basic_a3 (also tolerates channel_combined_a3): aggregates
 * rows over the non-video dimensions to per-video per-day totals.
 */
export function parseChannelBasicReport(csv: string): BasicReportRow[] {
  const { headers, rows } = parseCsv(csv);

  if (headers.length === 0) return [];

  const dateIdx = columnIndex(headers, 'date');
  const videoIdx = columnIndex(headers, 'video_id');

  if (dateIdx < 0 || videoIdx < 0) return [];

  const viewsIdx = columnIndex(headers, 'views');
  const engagedIdx = columnIndex(headers, 'engaged_views');
  const likesIdx = columnIndex(headers, 'likes');
  const dislikesIdx = columnIndex(headers, 'dislikes');
  const commentsIdx = columnIndex(headers, 'comments');
  const sharesIdx = columnIndex(headers, 'shares');
  const watchIdx = columnIndex(headers, 'watch_time_minutes');
  const subsGainedIdx = columnIndex(headers, 'subscribers_gained');
  const subsLostIdx = columnIndex(headers, 'subscribers_lost');
  const avdIdx = columnIndex(headers, 'average_view_duration_seconds');
  const avpIdx = columnIndex(headers, 'average_view_duration_percentage');

  const byKey = new Map<
    string,
    BasicReportRow & { avdWeightedSum: number; avpWeightedSum: number }
  >();

  for (const row of rows) {
    const date = normalizeDate(stringAt(row, dateIdx));
    const videoId = stringAt(row, videoIdx);
    if (!date || !videoId) continue;

    const key = `${videoId}:${date}`;
    const existing = byKey.get(key) ?? {
      date,
      youtubeVideoId: videoId,
      views: 0,
      engagedViews: 0,
      likes: 0,
      dislikes: 0,
      comments: 0,
      shares: 0,
      watchTimeSeconds: 0,
      subscribersGained: 0,
      subscribersLost: 0,
      avgViewDurationSeconds: 0,
      avgViewPercentage: 0,
      avdWeightedSum: 0,
      avpWeightedSum: 0,
    };

    const views = numberAt(row, viewsIdx);

    existing.views += views;
    existing.engagedViews += numberAt(row, engagedIdx);
    existing.likes += numberAt(row, likesIdx);
    existing.dislikes += numberAt(row, dislikesIdx);
    existing.comments += numberAt(row, commentsIdx);
    existing.shares += numberAt(row, sharesIdx);
    existing.watchTimeSeconds += Math.round(numberAt(row, watchIdx) * 60);
    existing.subscribersGained += numberAt(row, subsGainedIdx);
    existing.subscribersLost += numberAt(row, subsLostIdx);
    existing.avdWeightedSum += numberAt(row, avdIdx) * views;
    existing.avpWeightedSum += numberAt(row, avpIdx) * views;

    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).map(
    ({ avdWeightedSum, avpWeightedSum, ...row }) => ({
      ...row,
      avgViewDurationSeconds: row.views > 0 ? avdWeightedSum / row.views : 0,
      avgViewPercentage: row.views > 0 ? avpWeightedSum / row.views : 0,
    }),
  );
}

/**
 * Parse channel_traffic_source_a3: aggregates to per-video per-day
 * per-source. Numeric source codes are mapped to readable names.
 */
export function parseTrafficSourceReport(
  csv: string,
): TrafficSourceReportRow[] {
  const { headers, rows } = parseCsv(csv);

  if (headers.length === 0) return [];

  const dateIdx = columnIndex(headers, 'date');
  const videoIdx = columnIndex(headers, 'video_id');
  const sourceIdx = columnIndex(headers, 'traffic_source_type');

  if (dateIdx < 0 || videoIdx < 0 || sourceIdx < 0) return [];

  const viewsIdx = columnIndex(headers, 'views');
  const watchIdx = columnIndex(headers, 'watch_time_minutes');

  const byKey = new Map<string, TrafficSourceReportRow>();

  for (const row of rows) {
    const date = normalizeDate(stringAt(row, dateIdx));
    const videoId = stringAt(row, videoIdx);
    const code = stringAt(row, sourceIdx);
    if (!date || !videoId || !code) continue;

    const source = TRAFFIC_SOURCE_CODES[code] ?? `TS_${code}`;
    const key = `${videoId}:${date}:${source}`;
    const existing = byKey.get(key) ?? {
      date,
      youtubeVideoId: videoId,
      source,
      views: 0,
      watchTimeMinutes: 0,
    };

    existing.views += numberAt(row, viewsIdx);
    existing.watchTimeMinutes += numberAt(row, watchIdx);

    byKey.set(key, existing);
  }

  return Array.from(byKey.values());
}

/**
 * Parse channel_reach_*_a1: thumbnail impressions and CTR per video/day.
 * CTR is view-weighted when rows span extra dimensions.
 */
export function parseReachReport(csv: string): ReachReportRow[] {
  const { headers, rows } = parseCsv(csv);

  if (headers.length === 0) return [];

  const dateIdx = columnIndex(headers, 'date');
  const videoIdx = columnIndex(headers, 'video_id');
  const impressionsIdx = columnIndex(headers, 'video_thumbnail_impressions');

  if (dateIdx < 0 || videoIdx < 0 || impressionsIdx < 0) return [];

  const ctrIdx = columnIndex(headers, 'video_thumbnail_impressions_ctr');
  const engagedIdx = columnIndex(headers, 'engaged_views');

  const byKey = new Map<string, ReachReportRow & { ctrWeightedSum: number }>();

  for (const row of rows) {
    const date = normalizeDate(stringAt(row, dateIdx));
    const videoId = stringAt(row, videoIdx);
    if (!date || !videoId) continue;

    const impressions = numberAt(row, impressionsIdx);
    const ctr = numberAt(row, ctrIdx);

    const key = `${videoId}:${date}`;
    const existing = byKey.get(key) ?? {
      date,
      youtubeVideoId: videoId,
      impressions: 0,
      impressionsCtr: 0,
      engagedViews: 0,
      ctrWeightedSum: 0,
    };

    existing.impressions += impressions;
    existing.ctrWeightedSum += ctr * impressions;
    existing.engagedViews += numberAt(row, engagedIdx);

    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).map(({ ctrWeightedSum, ...row }) => ({
    ...row,
    impressionsCtr: row.impressions > 0 ? ctrWeightedSum / row.impressions : 0,
  }));
}
