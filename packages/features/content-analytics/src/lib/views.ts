import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  CAPABILITY_MATRIX,
} from '@kit/clickhouse';

import { coverageLines } from './provenance';

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

/** The matrix's sentence for a platform with no views column, or null (FILM-1722). */
export function viewsNotReportedNote(
  platform: AnalyticsPlatform,
): string | null {
  return CAPABILITY_MATRIX.engagement[platform].viewsNote ?? null;
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * Why a single video's views are not measured: its platform has no single
 * view. Every such platform's matrix note, so no platform is named here.
 */
export const VIEWS_NOT_MEASURED_REASON = unique(
  ANALYTICS_PLATFORMS.flatMap((platform) => {
    const note = viewsNotReportedNote(platform);
    return note ? [note] : [];
  }),
).join(' ');

/** When nothing says which platforms are behind a null views figure. */
export const VIEWS_NOT_MEASURED_FALLBACK =
  'No platform behind this figure reported a view in this period.';

/**
 * What a views figure covers: the platforms its videos are on, and which of
 * them have a row in the window. Enough to say why the figure is null.
 */
export interface ViewsScope {
  platforms: readonly AnalyticsPlatform[];
  withRows: readonly AnalyticsPlatform[];
  /** The window in words, as the chips say it: "the last 30 days". */
  windowLabel: string;
}

/**
 * Why a views figure over `scope` is null (KB-166). Per platform, in the
 * chips' order: its matrix note when it has no views column, the chip's
 * no-data-in-window line when it has no rows; each sentence once, as a
 * chip's body lines are. A platform with rows and a views column adds
 * nothing — it would have made the figure a number.
 */
export function viewsNotMeasuredReason(scope: ViewsScope | null): string {
  if (!scope) return VIEWS_NOT_MEASURED_FALLBACK;

  const view = {
    windowLabel: scope.windowLabel,
    cellsFor: () => {
      throw new Error('not read for a no-data line');
    },
    channels: undefined,
    observed: true,
  };

  const lines = ANALYTICS_PLATFORMS.filter((platform) =>
    scope.platforms.includes(platform),
  ).flatMap((platform) => {
    const note = viewsNotReportedNote(platform);

    if (note) return [note];
    if (scope.withRows.includes(platform)) return [];

    return coverageLines(view, ['engagement'], platform, {
      kind: 'no_data_in_window',
    });
  });

  return lines.length > 0
    ? unique(lines).join(' ')
    : VIEWS_NOT_MEASURED_FALLBACK;
}

/** The platforms among `values` that the analytics read, once each. */
function analyticsPlatforms(values: Iterable<string>): AnalyticsPlatform[] {
  const set = new Set(values);

  return ANALYTICS_PLATFORMS.filter((platform) => set.has(platform));
}

/** A scope with no publishes: its views are null, not 0 (KB-167). */
export const EMPTY_VIEWS_SCOPE: ViewsScope = {
  platforms: [],
  withRows: [],
  windowLabel: '',
};

/** The window in words, as the chips write one; no range is every day so far. */
export function viewsWindowLabel(startDate?: string, endDate?: string) {
  return startDate && endDate ? `${startDate} to ${endDate}` : 'any day so far';
}

/**
 * The scope of a views figure summed over `publishes`: their platforms, and
 * those of the publishes `withRows` holds a total for.
 */
export function viewsScopeOf(
  publishes: readonly { id: string; platform: string }[],
  withRows: { has: (id: string) => boolean },
  windowLabel: string,
): ViewsScope {
  return {
    platforms: analyticsPlatforms(publishes.map(({ platform }) => platform)),
    withRows: analyticsPlatforms(
      publishes
        .filter(({ id }) => withRows.has(id))
        .map(({ platform }) => platform),
    ),
    windowLabel,
  };
}

/** Two scopes' platforms together, as a project's are its seasons'. */
export function mergeViewsScopes(
  scopes: readonly ViewsScope[],
  windowLabel: string,
): ViewsScope {
  return {
    platforms: analyticsPlatforms(scopes.flatMap((s) => s.platforms)),
    withRows: analyticsPlatforms(scopes.flatMap((s) => s.withRows)),
    windowLabel,
  };
}

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
