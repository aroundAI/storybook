import { formatNumber } from './format';

/**
 * The series the Language Comparison chart plots: each one's display name
 * and how its tooltip reads it. The `<Bar>` takes its `dataKey` and `name`
 * from here, so the chart and its tooltip cannot disagree.
 */
export const LANGUAGE_COMPARISON_SERIES = {
  views: { name: 'Views', format: formatNumber },
} as const;

type LanguageComparisonSeries = keyof typeof LANGUAGE_COMPARISON_SERIES;

function isSeries(key: unknown): key is LanguageComparisonSeries {
  return typeof key === 'string' && key in LANGUAGE_COMPARISON_SERIES;
}

/**
 * The chart's Recharts tooltip formatter (KB-158). Recharts passes the
 * series' display name ("Views") as `name`, so the format is chosen by the
 * item's `dataKey`. A series this file does not know reads as a plain
 * number: no figure on this chart is money, so none defaults to dollars.
 */
export function formatLanguageComparisonTooltip(
  value: number,
  name: string,
  item: { dataKey?: unknown },
): [string, string] {
  if (!isSeries(item.dataKey)) return [value.toLocaleString(), name];

  const series = LANGUAGE_COMPARISON_SERIES[item.dataKey];

  return [series.format(value), series.name];
}
