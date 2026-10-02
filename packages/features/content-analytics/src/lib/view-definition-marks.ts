import {
  type AnalyticsPlatform,
  type ViewFormat,
  viewDefinitionChangesBetween,
} from '@kit/clickhouse';

import { platformLabel } from './platform-labels';

/**
 * A change in what a platform counts as a view, inside a chart's range
 * (FILM-1722 §5, adopted by FILM-1707): the chart marks the day rather
 * than drawing the step as though viewers did it.
 */
export interface ViewDefinitionMark {
  /** First day of the new definition, `YYYY-MM-DD`. */
  date: string;
  platform: AnalyticsPlatform;
  /** What the reader sees beside the mark. */
  sentence: string;
}

function dayInWords(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The boundaries a chart over `from`–`to` crosses, for the platforms whose
 * views it draws, earliest first. Straight from
 * `viewDefinitionChangesBetween`, so the registry stays the one place a
 * change is dated. Empty for an empty or backwards range — a chart with no
 * points has nothing to mark.
 */
export function viewDefinitionMarks(
  platforms: readonly AnalyticsPlatform[],
  from: string | undefined,
  to: string | undefined,
  options: { format?: ViewFormat } = {},
): ViewDefinitionMark[] {
  if (!from || !to || from > to) return [];

  return platforms
    .flatMap((platform) =>
      viewDefinitionChangesBetween(platform, from, to, options).map(
        (change) => ({
          date: change.date,
          platform,
          sentence: `${platformLabel(platform)} changed what counts as a view on ${dayInWords(change.date)} (“${change.from.label}” became “${change.to.label}”), so a step at that line may be the count changing, not viewers.`,
        }),
      ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** `YYYY-MM-DD` from a bucket key or a timestamp. */
export function isoDay(value: string): string {
  return value.slice(0, 10);
}

/** The bucket a mark falls in: the last bucket starting on or before it. */
export function bucketOfMark(
  bucketStarts: readonly string[],
  mark: ViewDefinitionMark,
): string | null {
  const sorted = [...bucketStarts].map(isoDay).sort();

  return sorted.filter((start) => start <= mark.date).at(-1) ?? null;
}

/** The buckets (by their own keys) that hold a mark, for a bar chart to draw it on. */
export function markedBuckets(
  bucketKeys: readonly string[],
  marks: readonly ViewDefinitionMark[],
): Set<string> {
  const byDay = new Map(bucketKeys.map((key) => [isoDay(key), key]));

  return new Set(
    marks.flatMap((mark) => {
      const day = bucketOfMark(bucketKeys, mark);
      const key = day === null ? undefined : byDay.get(day);

      return key === undefined ? [] : [key];
    }),
  );
}

/** How a bar chart draws a boundary: a dashed rule on the bar's leading edge. */
export const VIEW_DEFINITION_BAR_EDGE =
  'border-l-2 border-dashed border-muted-foreground';

/**
 * The marks for a chart of buckets: from the first bucket's start to the
 * last bucket's end. `span` is the bucket's length, so a monthly chart
 * whose last bucket is "2026-08-01" still covers the change on the 27th.
 */
export function marksForBuckets(
  platforms: readonly AnalyticsPlatform[],
  bucketKeys: readonly string[],
  span: 'day' | 'week' | 'month' | 'quarter',
): ViewDefinitionMark[] {
  const days = bucketKeys.map(isoDay).sort();
  const first = days[0];
  const last = days.at(-1);

  if (!first || !last) return [];

  const end = new Date(`${last}T00:00:00.000Z`);

  if (span === 'week') end.setUTCDate(end.getUTCDate() + 6);
  if (span === 'month') end.setUTCMonth(end.getUTCMonth() + 1, 0);
  if (span === 'quarter') end.setUTCMonth(end.getUTCMonth() + 3, 0);

  return viewDefinitionMarks(platforms, first, end.toISOString().slice(0, 10));
}
