import { vendorUrl } from './resolver';

/**
 * The one Meta Graph API version this repository calls (FILM-1723, moved by
 * FILM-1728).
 *
 * | | |
 * |---|---|
 * | Pinned | **v26.0** |
 * | Released | 2026-07-29 |
 * | Expires | **2028-07-29 or later** - the guaranteed floor; Meta has not published the date |
 * | Chosen | 2026-10-01 |
 *
 * **An expired Graph version does not fail, it is silently replaced** by the
 * oldest version still usable. Before FILM-1723 the OAuth dialog, the token
 * exchange and the token refresh asked for v18.0 and the publish lambdas for
 * v19.0, and Meta answered both as v20.0 for eight months. On 2026-10-01 a
 * request for the unreleased v27.0 came back as v21.0, so a typo would not
 * fail either. The `facebook-api-version` response header says what was
 * served: `metaFetch` reads it on every call and logs the first mismatch, and
 * a person can check by hand:
 *
 *     curl -sI "https://graph.facebook.com/v26.0/me" | grep -i facebook-api-version
 *
 * Why v26.0: the latest version, with the longest life. FILM-1723 took v23.0
 * first as the minimal-diff pin; FILM-1728 read the v24.0, v25.0 and v26.0
 * changelogs against every call made here and found nothing we call changed.
 * v25.0 retired 41 Facebook insight metrics for every version, and v26.0 the
 * `pretty`, `debug`, `If-None-Match`, `date_format` and root `?ids=`
 * parameters; none is used, and the reference's forbidden block keeps it so.
 * The findings are in `docs/platform-capability-reference.md`, one dated row
 * per version.
 *
 * A bump is a scheduled task, and the tests make it one: change the four
 * constants below together, the Pinned line and row in the reference with
 * them, append a findings row for every version crossed, then force one token
 * refresh against a live connection after deploy (FILM-1725 Check D).
 * `vendor-api-versions.test.ts` fails on any of those left undone, on a version
 * literal written anywhere else, and from 120 days before the date below.
 */
export const META_GRAPH_VERSION = 'v26.0';
export const META_GRAPH_VERSION_RELEASED = '2026-07-29';
export const META_GRAPH_VERSION_EXPIRES = '2028-07-29';
/**
 * True when `META_GRAPH_VERSION_EXPIRES` is the guaranteed floor (two years
 * from release) because Meta has not yet published the end date; false when
 * it is the date the changelog states (FILM-1728 §3). Meta lists v26.0's end
 * as "TBD" until v27.0 ships (read 2026-10-01).
 */
export const META_GRAPH_VERSION_EXPIRY_IS_FLOOR = true;

const META_GRAPH_HOST = vendorUrl('meta-graph');
const META_GRAPH_VIDEO_HOST = vendorUrl('meta-graph-video');
const META_DIALOG_HOST = vendorUrl('meta-oauth');

export const META_GRAPH_BASE = `${META_GRAPH_HOST}/${META_GRAPH_VERSION}`;

/** Non-resumable Page video uploads go to their own host. */
export const META_GRAPH_VIDEO_BASE = `${META_GRAPH_VIDEO_HOST}/${META_GRAPH_VERSION}`;

/** Followed by the user's browser, not called by the server. */
export const META_OAUTH_DIALOG_URL = `${META_DIALOG_HOST}/${META_GRAPH_VERSION}/dialog/oauth`;

export const META_OAUTH_TOKEN_URL = `${META_GRAPH_BASE}/oauth/access_token`;
