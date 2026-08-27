/**
 * Raw per-video per-day CSV export (FILM-1511).
 *
 * YouTube Studio's retention window is limited and comparisons get harder
 * the further back you look. A monthly dump of the underlying rows gives
 * a clean multi-year series that does not depend on any dashboard.
 */

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
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  impressions: number;
  ctr: number;
  avgViewDurationSeconds: number;
  /** Top traffic source for this video/day, when known. */
  topTrafficSource: string;
  /** Taxonomy tags as 'dimension:slug', pipe-separated. */
  tags: string;
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
  { header: 'Published At', getValue: (r) => r.publishedAt },
  { header: 'Video Age (days)', getValue: (r) => String(r.videoAgeDays) },
  { header: 'Views', getValue: (r) => String(r.views) },
  { header: 'Likes', getValue: (r) => String(r.likes) },
  { header: 'Comments', getValue: (r) => String(r.comments) },
  { header: 'Shares', getValue: (r) => String(r.shares) },
  { header: 'Saves', getValue: (r) => String(r.saves) },
  {
    header: 'Watch Time (s)',
    getValue: (r) => String(r.watchTimeSeconds),
  },
  {
    header: 'Subscribers Gained',
    getValue: (r) => String(r.subscribersGained),
  },
  {
    header: 'Revenue (USD)',
    getValue: (r) => (r.revenueCents / 100).toFixed(2),
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
    header: 'Avg View Duration (s)',
    getValue: (r) =>
      r.avgViewDurationSeconds > 0
        ? r.avgViewDurationSeconds.toFixed(1)
        : '',
  },
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
  const lines = [COLUMNS.map((column) => column.header).join(',')];

  for (const row of rows) {
    lines.push(
      COLUMNS.map((column) => escapeCSVValue(column.getValue(row))).join(','),
    );
  }

  return lines.join('\n');
}

/** Days between a publish date and a metric date, floored at zero. */
export function videoAgeInDays(publishedAt: string, metricDate: string): number {
  const published = new Date(publishedAt).getTime();
  const metric = new Date(metricDate).getTime();

  if (Number.isNaN(published) || Number.isNaN(metric)) return 0;

  return Math.max(0, Math.floor((metric - published) / 86_400_000));
}
