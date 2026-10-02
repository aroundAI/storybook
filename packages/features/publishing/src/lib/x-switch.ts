/**
 * Whether X is offered. Off: retired for now by the owner, 2026-10-02 — the
 * go-to-market platforms are YouTube, Instagram and Facebook.
 *
 * X is hidden, not removed as FILM-717 removed a platform: its code is kept,
 * and so are its stored connections and publishes. While this is false
 * `isHiddenPlatform('twitter')` is true, so no surface offers X and no kept
 * row is shown, refreshed or published to. To bring X back, set it to true and
 * run FILM-1725's X checks.
 *
 * Its own module, so a test can switch it on with `vi.mock`.
 */
export const X_ENABLED: boolean = false;
