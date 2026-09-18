import { type SubscriberPoint, isMeasuredSource } from '@kit/clickhouse';
import type { ChartConfig } from '@kit/ui/chart';

/**
 * The subscriber card's chart rows (FILM-1617).
 *
 * Each line is drawn twice: a dashed line through every day, and a solid line
 * through the measured days only. Snapshots are daily, so almost every day is
 * measured and the line reads solid; a capture gap — days reconstructed from
 * movement alone — breaks the solid line and leaves the dashed one showing.
 */

export interface ChartLine {
  key: string;
  name: string;
  points: SubscriberPoint[];
}

export type ChartRow = { date: string } & Record<
  string,
  string | number | boolean | null
>;

export function sourceKey(lineKey: string): string {
  return `${lineKey}__source`;
}

/** The solid line's data key: the level on measured days, null otherwise. */
export function measuredKey(lineKey: string): string {
  return `${lineKey}__measured`;
}

/**
 * True on a measured day with no measured day either side. A stroke needs
 * two points to draw anything, so without a mark such a day — a channel's
 * first snapshot, or one snapshot inside a capture gap — is invisible.
 */
export function isolatedKey(lineKey: string): string {
  return `${lineKey}__isolated`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The theme defines five chart colours. */
const CHART_COLOURS = 5;

/**
 * A distinct colour per line. Past the fifth, each round of the palette is
 * mixed further toward the foreground, so a sixth channel no longer shares
 * the first one's colour and the key can tell them apart.
 */
export function lineColour(index: number): string {
  const token = `var(--chart-${(index % CHART_COLOURS) + 1})`;
  const round = Math.floor(index / CHART_COLOURS);

  if (round === 0) return token;

  return `color-mix(in oklch, ${token} ${Math.max(30, 100 - round * 35)}%, var(--foreground))`;
}

export function toChartData(lines: ChartLine[]): {
  rows: ChartRow[];
  config: ChartConfig;
} {
  const byDate = new Map<string, ChartRow>();

  for (const line of lines) {
    for (const point of line.points) {
      const row = byDate.get(point.date) ?? { date: point.date };

      row[line.key] = point.level;
      row[measuredKey(line.key)] = isMeasuredSource(point.source)
        ? point.level
        : null;
      row[sourceKey(line.key)] = point.source;
      byDate.set(point.date, row);
    }
  }

  for (const line of lines) {
    const measured = new Set(
      line.points.filter((p) => isMeasuredSource(p.source)).map((p) => p.date),
    );

    for (const date of measured) {
      byDate.get(date)![isolatedKey(line.key)] =
        !measured.has(addDays(date, -1)) && !measured.has(addDays(date, 1));
    }
  }

  const config: ChartConfig = Object.fromEntries(
    lines.map((line, index) => [
      line.key,
      { label: line.name, color: lineColour(index) },
    ]),
  );

  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  return { rows, config };
}

/**
 * The rounding warning under the Total view covers the lines it draws. A
 * platform with no total — its channels share no day — still sums its
 * channels' errors, and counting it warned about a line that isn't there.
 */
export function drawnRoundingError(
  totals: Array<{ points: SubscriberPoint[]; roundingError: number }>,
): number {
  return Math.max(
    0,
    ...totals.filter((t) => t.points.length > 0).map((t) => t.roundingError),
  );
}
