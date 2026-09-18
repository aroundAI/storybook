import type { SubscriberPoint } from '@kit/clickhouse';
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
  string | number | null
>;

export function sourceKey(lineKey: string): string {
  return `${lineKey}__source`;
}

/** The solid line's data key: the level on measured days, null otherwise. */
export function measuredKey(lineKey: string): string {
  return `${lineKey}__measured`;
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
      row[measuredKey(line.key)] =
        point.source === 'interpolated' ? null : point.level;
      row[sourceKey(line.key)] = point.source;
      byDate.set(point.date, row);
    }
  }

  const config: ChartConfig = Object.fromEntries(
    lines.map((line, index) => [
      line.key,
      { label: line.name, color: `var(--chart-${(index % 5) + 1})` },
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
