/**
 * Paging and sorting for the Video Log (FILM-1615). Pure.
 *
 * Sorting is the server's: only the three columns ClickHouse can order by
 * (`VIDEO_AGE_ORDER_COLUMNS`) are offered, and every change re-queries from
 * the first page. Sorting any other column in the browser would sort one
 * page while presenting itself as a sort of the whole log.
 */

export const VIDEO_LOG_PAGE_SIZE = 100;

export type VideoLogSortColumn = 'published_at' | 'lifetime_views' | 'title';

export interface VideoLogView {
  orderBy: VideoLogSortColumn;
  orderDirection: 'asc' | 'desc';
  /** Zero-based. */
  page: number;
}

export const DEFAULT_VIDEO_LOG_VIEW: VideoLogView = {
  orderBy: 'published_at',
  orderDirection: 'desc',
  page: 0,
};

/**
 * The action's paging inputs for a view. One row more than a page is asked
 * for, so "is there a next page" is answered by the data rather than by
 * guessing from a full page — the action returns no total, and counting
 * the whole scope would double the ClickHouse cost.
 */
export function videoLogRequest(view: VideoLogView) {
  return {
    orderBy: view.orderBy,
    orderDirection: view.orderDirection,
    limit: VIDEO_LOG_PAGE_SIZE + 1,
    offset: view.page * VIDEO_LOG_PAGE_SIZE,
  };
}

/** The rows to show, and whether a next page exists. */
export function videoLogPage<T>(rows: T[]): { rows: T[]; hasMore: boolean } {
  return {
    rows: rows.slice(0, VIDEO_LOG_PAGE_SIZE),
    hasMore: rows.length > VIDEO_LOG_PAGE_SIZE,
  };
}

/**
 * The view after a header click. The same column flips direction; a new
 * column starts where a reader expects it to — titles A→Z, dates and views
 * largest first. Either way the list goes back to the first page.
 */
export function nextVideoLogSort(
  view: VideoLogView,
  column: VideoLogSortColumn,
): VideoLogView {
  if (view.orderBy === column) {
    return {
      orderBy: column,
      orderDirection: view.orderDirection === 'asc' ? 'desc' : 'asc',
      page: 0,
    };
  }

  return {
    orderBy: column,
    orderDirection: column === 'title' ? 'asc' : 'desc',
    page: 0,
  };
}

/** "Rows 101–200" for a page holding `count` rows. */
export function videoLogRangeLabel(page: number, count: number): string {
  const first = page * VIDEO_LOG_PAGE_SIZE + 1;
  return `Rows ${first}–${first + count - 1}`;
}
