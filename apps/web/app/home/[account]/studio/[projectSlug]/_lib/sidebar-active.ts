/**
 * Which studio sidebar link is the current page (FILM-901).
 *
 * `usePathname()` carries no query string, and the Characters and Locations
 * links differ only in `?tab=`, so they were tested for the words "character"
 * and "location" in the pathname, which never appear: neither link ever lit.
 * The tab is read from the search params instead. The assets page shows
 * Characters when `tab` is absent.
 */

export type AssetsTab = 'character' | 'location';

/** `path` itself, or with `exact` off, anything beneath it. */
export function isPathActive(pathname: string, path: string, exact = false) {
  if (exact) return pathname === path;

  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The assets link for one tab: on the assets page, with that tab showing. */
export function isAssetsTabActive(
  pathname: string,
  assetsPath: string,
  tab: string | null,
  link: AssetsTab,
) {
  if (!isPathActive(pathname, assetsPath)) return false;

  return (tab === 'location' ? 'location' : 'character') === link;
}
