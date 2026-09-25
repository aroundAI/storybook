/**
 * Navigate after a server action has succeeded, and make sure the page
 * actually leaves (KB-117).
 *
 * A soft `router.push` in Next 15.5 can occasionally never commit: the
 * router suspends the navigation on a promise that nothing resolves, and
 * the page stays where it is with its form disabled. In our measurements it
 * stalled about 1 creation in 6 (vercel/next.js#83386). A passing
 * navigation commits in well under a second.
 *
 * So: push, and if the address still shows the page we started from after
 * `fallbackAfterMs`, do a hard navigation to the target. A hard navigation
 * cannot take that path. If the user has gone somewhere else meanwhile,
 * nothing happens.
 */
export interface SoftRouter {
  push: (href: string) => void;
}

export interface NavigateWithFallbackOptions {
  /** How long a soft navigation may take before the hard fallback. */
  fallbackAfterMs?: number;
}

export const NAVIGATION_FALLBACK_MS = 5_000;

export function navigateWithFallback(
  router: SoftRouter,
  href: string,
  {
    fallbackAfterMs = NAVIGATION_FALLBACK_MS,
  }: NavigateWithFallbackOptions = {},
): void {
  const from = currentAddress();

  router.push(href);

  setTimeout(() => {
    if (currentAddress() === from) {
      window.location.assign(href);
    }
  }, fallbackAfterMs);
}

function currentAddress() {
  return window.location.pathname + window.location.search;
}
