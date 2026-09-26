/**
 * Figures a platform may not measure, in exports (KB-111, KB-114).
 *
 * `Measured<T>` in `./measured` is the card-side form of this rule. Exports
 * carry `number | null` instead, as `checkpointCell` in the raw export does.
 *
 * `null` is "not measured": TikTok's watch time and saves, Instagram's watch
 * time, a TikTok or Instagram video's average view duration. A 0 in an export
 * says the platform counted and found none; a blank says it never counted.
 * Totals over a mix add up only the rows that measured the figure and say how
 * many that was, as the Change log's "N of M videos had data" does
 * (decision #33, A).
 *
 * Pure and client-safe.
 */

/** What a blank CSV cell means, appended to that column's header. */
export const NOT_MEASURED_CSV_NOTE = 'blank = not measured by the platform';

/** What stands in for a figure that was not measured, in the PDF. */
export const NOT_MEASURED_MARK = '—';

export const NOT_MEASURED_LEGEND =
  '— not measured by the platform. Totals add up only the videos that measure the figure, and say how many.';

/** How many rows carried a figure, out of how many there were. */
export interface Coverage {
  measured: number;
  total: number;
}

/** A total over the rows that measured the figure; null when none did. */
export interface MeasuredTotal {
  value: number | null;
  coverage: Coverage;
}

export function sumMeasured(values: Array<number | null>): MeasuredTotal {
  let value = 0;
  let measured = 0;

  for (const v of values) {
    if (v === null) continue;
    value += v;
    measured += 1;
  }

  return {
    value: measured > 0 ? value : null,
    coverage: { measured, total: values.length },
  };
}

/** A weighted mean over the rows that measured the figure and have weight. */
export function weightedMeasured(
  rows: Array<{ value: number | null; weight: number }>,
): MeasuredTotal {
  let weighted = 0;
  let weight = 0;
  let measured = 0;

  for (const row of rows) {
    if (row.value === null || row.weight <= 0) continue;
    weighted += row.value * row.weight;
    weight += row.weight;
    measured += 1;
  }

  return {
    value: weight > 0 ? weighted / weight : null,
    coverage: { measured, total: rows.length },
  };
}

/** "from 3 of 5 videos" when partial; empty when every row measured it. */
export function coverageLabel(coverage: Coverage): string {
  return coverage.measured < coverage.total
    ? `from ${coverage.measured} of ${coverage.total} videos`
    : '';
}

/** A CSV cell: the figure, or blank for not measured. */
export function measuredCell(
  value: number | null,
  format: (v: number) => string = String,
): string {
  return value === null ? '' : format(value);
}

/**
 * The header of a column a platform may not measure. Always with the note,
 * never only when a blank occurs: the raw export promises fixed headers so
 * monthly files concatenate, and a header that came and went would break it.
 */
export function measuredHeader(header: string): string {
  return `${header} (${NOT_MEASURED_CSV_NOTE})`;
}
