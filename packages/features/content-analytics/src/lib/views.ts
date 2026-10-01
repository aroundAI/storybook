/**
 * A views figure as ClickHouse hands it back since migration 020: `null`
 * where every row behind it is a platform with no single view (Facebook,
 * FILM-1722), which is "not measured", never 0 (KB-153).
 *
 * The one set of rules every consumer uses, so a Facebook video neither
 * reads as 0 views nor sorts among the zeros.
 */
export type Views = number | null;

export { addViews } from '@kit/clickhouse';

export const VIEWS_NOT_MEASURED = 'Not measured';

export const VIEWS_NOT_MEASURED_REASON =
  'Facebook counts four different kinds of view, and none of them is a view in this sense, so its plays are not counted as views.';

/** Most views first; not measured after every measured figure. */
export function compareViewsDesc(
  a: { views: Views },
  b: { views: Views },
): number {
  if (a.views === null || b.views === null) {
    return (a.views === null ? 1 : 0) - (b.views === null ? 1 : 0);
  }
  return b.views - a.views;
}

/**
 * A figure for a pooled sum of views: a not-measured part adds nothing,
 * as on the reach page's All tab. Only for adding into a total that is
 * itself labelled as views across measured platforms.
 */
export function viewsToAdd(views: Views): number {
  return views ?? 0;
}

/** A share of a total, as a percentage; null when the part is not measured. */
export function viewsShare(part: Views, total: Views): number | null {
  if (part === null) return null;
  return total ? (part / total) * 100 : 0;
}

/** Measured views added: a not-measured part adds nothing. */
export function sumViews(values: readonly Views[]): Views {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 && values.length > 0
    ? null
    : measured.reduce((sum, value) => sum + value, 0);
}

export function formatViews(
  views: Views,
  format: (value: number) => string = (value) => value.toLocaleString('en-US'),
): string {
  return views === null ? VIEWS_NOT_MEASURED : format(views);
}
