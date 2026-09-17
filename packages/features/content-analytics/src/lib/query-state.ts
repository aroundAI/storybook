/**
 * Whether a query has nothing to show, as opposed to having merely failed.
 *
 * `isError` is not that question. query-core's reducer sets `status: 'error'`
 * unconditionally and keeps `data`
 * (`@tanstack/query-core/build/modern/query.js`, the `case 'error'` branch),
 * so a failed *background refetch* — this app refetches on window focus past
 * a 60s stale time — reports an error while the last good answer is still
 * cached.
 *
 * Reading `isError` alone therefore throws away a usable answer. On the Deep
 * Dive tab it also removes the channel filter while its filtering stays
 * applied to every card, leaving no control to clear it.
 */
export function isUnavailable(query: {
  isError: boolean;
  data: unknown;
}): boolean {
  return query.isError && query.data === undefined;
}
