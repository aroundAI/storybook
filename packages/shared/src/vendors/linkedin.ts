/**
 * The `LinkedIn-Version` header, declared once (FILM-1723). It was written
 * separately in the provider and in the publish lambda.
 *
 * **The value is inherited, not chosen, and is past sunset.** LinkedIn's
 * migrations table gives 202401 a sunset of 2025-01-22, and its versioning
 * page names 202401 as the example of a header refused with 426
 * `NONEXISTENT_VERSION` (both read 2026-10-01; links in `pins.ts`). Every call
 * that sends it goes to `/v2/...`, while the header is documented for
 * `/rest/...`, so whether LinkedIn refuses our calls could not be settled
 * without a LinkedIn token: an unauthenticated probe returns 401 before the
 * version is looked at, for 202401 and 202609 alike. KB-164 owns the move.
 */
export const LINKEDIN_REST_VERSION = '202401';
