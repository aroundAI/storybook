/**
 * Raw per-video per-day CSV export (FILM-1511).
 *
 * YouTube Studio's retention window is limited and comparisons get harder
 * the further back you look. A monthly dump of the underlying rows gives
 * a clean multi-year series that does not depend on any dashboard.
 *
 * The four columns a platform may not measure carry "(blank = not measured
 * by the platform)" in their header, always, so the headers stay fixed from
 * one month's file to the next (KB-111, KB-114).
 */
import { measuredCell, measuredHeader } from './export-coverage';

export interface RawExportRow {
  date: string;
  videoId: string;
  title: string;
  platform: string;
  contentType: string;
  language: string;
  publishedAt: string;
  /** Days between publication and this metric date. */
  videoAgeDays: number;
  /** Null for a Facebook row: no single view (KB-153). */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  /**
   * Null where the platform does not measure it (KB-111, KB-114): saves on
   * YouTube and TikTok, watch time on TikTok and Instagram, follower gains
   * on TikTok, average view duration on TikTok and Instagram. Blank in the
   * file, with the column's header saying so; never 0.
   */
  saves: number | null;
  watchTimeSeconds: number | null;
  subscribersGained: number | null;
  /** Null when not measured (FILM-1726); blank in the file, never 0. */
  revenueCents: number | null;
  /**
   * That day's own impressions and click-through rate. Zero when the
   * platform reported no reach for the day, which the file writes as blank.
   */
  impressions: number;
  ctr: number;
  avgViewDurationSeconds: number | null;
  /** Top traffic source for this video/day, when known. */
  topTrafficSource: string;
  /** Taxonomy tags as 'dimension:slug', pipe-separated. */
  tags: string;
  /** Channel this video was published to. */
  channelName: string;
  /**
   * Views accumulated in days 0..N-1 of the video's life.
   *
   * A per-video constant repeated on each of that video's daily rows —
   * which is what keeps monthly exports concatenable without a join, the
   * property the file header promises.
   *
   * Empty when the checkpoint has not elapsed yet: an unreached "@90d" is
   * not zero, it is not yet knowable, and a zero in the cell would be read
   * as a real measurement.
   */
  viewsAt30: number | null;
  viewsAt90: number | null;
  viewsAt180: number | null;
  viewsAt365: number | null;
}

export interface DailyReach {
  videoId: string;
  date: string;
  impressions: number;
  impressionsCtr: number;
}

/**
 * Looks up a video's reach for one day, so each daily row carries that
 * day's figure rather than the video's period total repeated on every row.
 */
export function dailyReachLookup(
  rows: DailyReach[],
): (videoId: string, date: string) => { impressions: number; ctr: number } {
  const byVideoDate = new Map(
    rows.map((row) => [`${row.videoId}:${row.date}`, row]),
  );

  return (videoId, date) => {
    const row = byVideoDate.get(`${videoId}:${date}`);

    return {
      impressions: row?.impressions ?? 0,
      ctr: row?.impressionsCtr ?? 0,
    };
  };
}

/** Blank for an unreached checkpoint, so it cannot be read as zero. */
function checkpointCell(value: number | null): string {
  return value === null ? '' : String(value);
}

const COLUMNS: Array<{
  header: string;
  getValue: (row: RawExportRow) => string;
}> = [
  { header: 'Date', getValue: (r) => r.date },
  { header: 'Video ID', getValue: (r) => r.videoId },
  { header: 'Title', getValue: (r) => r.title },
  { header: 'Platform', getValue: (r) => r.platform },
  { header: 'Content Type', getValue: (r) => r.contentType },
  { header: 'Language', getValue: (r) => r.language },
  { header: 'Channel', getValue: (r) => r.channelName },
  { header: 'Published At', getValue: (r) => r.publishedAt },
  { header: 'Video Age (days)', getValue: (r) => String(r.videoAgeDays) },
  {
    header: measuredHeader('Views'),
    getValue: (r) => measuredCell(r.views),
  },
  { header: 'Likes', getValue: (r) => String(r.likes) },
  { header: 'Comments', getValue: (r) => String(r.comments) },
  { header: 'Shares', getValue: (r) => String(r.shares) },
  {
    header: measuredHeader('Saves'),
    getValue: (r) => measuredCell(r.saves),
  },
  {
    header: measuredHeader('Watch Time (s)'),
    getValue: (r) => measuredCell(r.watchTimeSeconds),
  },
  {
    header: measuredHeader('Subscribers Gained'),
    getValue: (r) => measuredCell(r.subscribersGained),
  },
  {
    // The header is a column name in files recipients already parse, so it
    // stays. It is also true: the figure is ClickHouse's, which holds only
    // USD-sourced revenue (KB-12; bound by `revenue-writers.test.ts`), and
    // never a manual entry in another currency.
    // Blank when not measured (FILM-1726), under the same fixed header.
    header: 'Revenue (USD)',
    getValue: (r) => measuredCell(r.revenueCents, (v) => (v / 100).toFixed(2)),
  },
  {
    header: 'Impressions',
    getValue: (r) => (r.impressions > 0 ? String(r.impressions) : ''),
  },
  {
    header: 'CTR',
    getValue: (r) => (r.impressions > 0 ? r.ctr.toFixed(4) : ''),
  },
  {
    header: measuredHeader('Avg View Duration (s)'),
    getValue: (r) =>
      r.avgViewDurationSeconds !== null && r.avgViewDurationSeconds > 0
        ? r.avgViewDurationSeconds.toFixed(1)
        : '',
  },
  { header: 'Views @30d', getValue: (r) => checkpointCell(r.viewsAt30) },
  { header: 'Views @90d', getValue: (r) => checkpointCell(r.viewsAt90) },
  { header: 'Views @180d', getValue: (r) => checkpointCell(r.viewsAt180) },
  { header: 'Views @365d', getValue: (r) => checkpointCell(r.viewsAt365) },
  { header: 'Top Traffic Source', getValue: (r) => r.topTrafficSource },
  { header: 'Tags', getValue: (r) => r.tags },
];

function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Renders raw export rows as CSV. Columns are fixed and ordered so
 * successive monthly dumps concatenate cleanly into one long series.
 */
export function generateRawExportCSV(rows: RawExportRow[]): string {
  const lines = [
    COLUMNS.map((column) => escapeCSVValue(column.header)).join(','),
  ];

  for (const row of rows) {
    lines.push(
      COLUMNS.map((column) => escapeCSVValue(column.getValue(row))).join(','),
    );
  }

  return lines.join('\n');
}

/** Days between a publish date and a metric date, floored at zero. */
export function videoAgeInDays(
  publishedAt: string,
  metricDate: string,
): number {
  const published = new Date(publishedAt).getTime();
  const metric = new Date(metricDate).getTime();

  if (Number.isNaN(published) || Number.isNaN(metric)) return 0;

  return Math.max(0, Math.floor((metric - published) / 86_400_000));
}
