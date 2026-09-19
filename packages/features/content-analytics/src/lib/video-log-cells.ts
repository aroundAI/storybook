/**
 * What each Video Log cell means (FILM-1615).
 *
 * Pure, so every decision the table makes about a number — is it a real
 * measurement, or a reason there is none — is tested without rendering.
 * The components only draw what these return. A cell that shows a number
 * where a reason belongs is the failure the table exists to prevent: a zero
 * looks like data, sorts like data and averages like data.
 */

/** The row fields the cells read; a subset of `VideoLogRow`. */
export interface VideoLogCellRow {
  publishedAt: string;
  viewsAtAge: Record<number, number>;
  matureAt: Record<number, boolean>;
  predatesIngestAt: Record<number, boolean>;
  ingestLagDays: number | null;
  lifetimeViews: number;
  impressions: number;
  ctr: number;
  avgViewDurationSeconds: number;
  avgViewPercentage: number;
}

/**
 * One views-at-age cell. Four states, not the three the spec first listed:
 * a video with no metrics ever ingested has `ingestLagDays === null`, is
 * never marked as predating ingest, and once old enough its checkpoints
 * read 0 — which would render missing data as a real zero (EDD F-1).
 */
export type CheckpointState =
  | { kind: 'immature'; ageDays: number | null; daysToGo: number }
  | { kind: 'no-data' }
  | { kind: 'predates'; lagDays: number }
  | { kind: 'figure'; value: number };

/**
 * Decides one checkpoint cell. The order is the precedence:
 *
 * 1. not old enough — there is no answer yet, whatever else is true;
 * 2. no metrics ever received — nothing to report;
 * 3. the window closed before this channel's ingest began — unrecoverable;
 * 4. otherwise the figure, zero included.
 */
export function checkpointState(
  row: VideoLogCellRow,
  days: number,
  now: Date = new Date(),
): CheckpointState {
  if (!row.matureAt[days]) {
    const ageDays = videoAgeDays(row.publishedAt, now);

    return {
      kind: 'immature',
      ageDays,
      daysToGo: ageDays === null ? days : Math.max(1, days - ageDays),
    };
  }

  if (row.ingestLagDays === null) return { kind: 'no-data' };

  if (row.predatesIngestAt[days]) {
    return { kind: 'predates', lagDays: row.ingestLagDays };
  }

  return { kind: 'figure', value: row.viewsAtAge[days] ?? 0 };
}

/** A lifetime quality cell: a value, or why there is none. */
export type QualityState =
  | { kind: 'value'; value: number }
  | { kind: 'none'; reason: 'no-data' | 'no-impressions' | 'no-views' };

/**
 * The lifetime cells. Quality metrics default to 0 when there is nothing
 * behind them (EDD F-3); a CTR over no impressions, or an average view
 * duration over no views, is not a measurement of zero. The CSV blanks the
 * same cases.
 */
export function qualityStates(row: VideoLogCellRow): {
  lifetimeViews: QualityState;
  impressions: QualityState;
  ctr: QualityState;
  avgViewDuration: QualityState;
  avgViewPercentage: QualityState;
} {
  if (row.ingestLagDays === null) {
    const none: QualityState = { kind: 'none', reason: 'no-data' };

    return {
      lifetimeViews: none,
      impressions: none,
      ctr: none,
      avgViewDuration: none,
      avgViewPercentage: none,
    };
  }

  const noViews: QualityState = { kind: 'none', reason: 'no-views' };

  return {
    lifetimeViews: { kind: 'value', value: row.lifetimeViews },
    impressions: { kind: 'value', value: row.impressions },
    ctr:
      row.impressions > 0
        ? { kind: 'value', value: row.ctr }
        : { kind: 'none', reason: 'no-impressions' },
    avgViewDuration:
      row.lifetimeViews > 0
        ? { kind: 'value', value: row.avgViewDurationSeconds }
        : noViews,
    avgViewPercentage:
      row.lifetimeViews > 0
        ? { kind: 'value', value: row.avgViewPercentage }
        : noViews,
  };
}

/**
 * Whether a row's early days were partly missed: analytics began more than
 * a day after publication, so every figure in the row starts late.
 */
export function isPartial(
  row: Pick<VideoLogCellRow, 'ingestLagDays'>,
): boolean {
  return row.ingestLagDays !== null && row.ingestLagDays > 1;
}

/**
 * ClickHouse returns `published_at` as `'YYYY-MM-DD HH:MM:SS'` in UTC with
 * no zone. `new Date()` reads that form as *local* time, which shifts the
 * day for anyone away from UTC (EDD F-4), so it is parsed as UTC here.
 * Returns null for anything unparseable.
 */
export function parseUtcTimestamp(value: string): Date | null {
  // Zoneless or explicit UTC only; anything with an offset is left to the
  // standard parser, which honours it.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/.exec(
      value,
    );

  if (match) {
    const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
    return new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function videoAgeDays(publishedAt: string, now: Date): number | null {
  const published = parseUtcTimestamp(publishedAt);

  if (!published) return null;

  return Math.max(
    0,
    Math.floor((now.getTime() - published.getTime()) / 86_400_000),
  );
}
