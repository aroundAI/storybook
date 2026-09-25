import type { Locator, Page } from '@playwright/test';

/**
 * The on-screen match for a selector, ignoring React's hidden streamed copy.
 *
 * Every `/home` page streams in under a `loading.tsx` boundary. React 19.2
 * delivers a boundary's content inside `<div hidden id="S:n">` and reveals it
 * in a batch (a frame later, or up to ~300ms), and if the page updates first
 * the client renders its own copy. For that moment both exist: the hidden one
 * is not rendered and cannot be clicked, but a bare CSS locator matches it,
 * and Playwright's strict mode fails at once instead of retrying (#19).
 *
 * A user only ever sees one; so does this.
 */
export function visible(root: Page | Locator, selector: string): Locator {
  return root.locator(selector).filter({ visible: true });
}

/** `visible()` for a `data-test` id. */
export function byTest(root: Page | Locator, id: string): Locator {
  return visible(root, `[data-test="${id}"]`);
}
