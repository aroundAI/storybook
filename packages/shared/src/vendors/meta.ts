/**
 * The one Meta Graph API version this repository calls (FILM-1723).
 *
 * | | |
 * |---|---|
 * | Pinned | **v23.0** |
 * | Released | 2025-05-29 |
 * | Expires | **2027-10-08** - upgrade before then |
 * | Chosen | 2026-09-22 |
 *
 * **An expired Graph version does not fail, it is silently replaced** by the
 * oldest version still usable. Before this constant existed the OAuth dialog,
 * the token exchange and the token refresh asked for v18.0 (expired
 * 2026-01-26) and the publish lambdas for v19.0 (expired 2026-05-21); Meta
 * answered both as v20.0, itself expiring 2026-09-24, so the version in force
 * was about to change again without a commit. Measured 2026-09-21 by reading
 * the `facebook-api-version` response header, which is also how to check that
 * this pin is honoured:
 *
 *     curl -sI "https://graph.facebook.com/v23.0/me" | grep -i facebook-api-version
 *
 * Why v23.0 and not the latest (v26.0): it is the only version this repository
 * had already chosen and run in production (Instagram insights), so analytics
 * requests are unchanged by the consolidation, and the token-refresh path
 * moves the shortest distance from what Meta was actually serving. v21-v23
 * change nothing on the OAuth, Page, publishing or container endpoints called
 * here. They do remove insights metrics - `video_views` in v21, and `plays`,
 * `impressions`, `clips_replays_count` and
 * `ig_reels_aggregated_all_plays_count` on 2025-04-21 for every version - none
 * of which this repository requests; `platform-field-names.test.ts` keeps it
 * that way.
 *
 * Meta retires a version roughly two years after release, so a bump is a
 * scheduled task: change the three constants below together, update the row in
 * `docs/platform-capability-reference.md`, read the changelog for every version
 * crossed, and verify a token refresh against a live connection.
 * `vendor-api-versions.test.ts` binds the dates to that table and fails on a
 * version literal written anywhere else.
 */
export const META_GRAPH_VERSION = 'v23.0';
export const META_GRAPH_VERSION_RELEASED = '2025-05-29';
export const META_GRAPH_VERSION_EXPIRES = '2027-10-08';

const META_GRAPH_HOST = 'https://graph.facebook.com';
const META_GRAPH_VIDEO_HOST = 'https://graph-video.facebook.com';
const META_DIALOG_HOST = 'https://www.facebook.com';

export const META_GRAPH_BASE = `${META_GRAPH_HOST}/${META_GRAPH_VERSION}`;

/** Non-resumable Page video uploads go to their own host. */
export const META_GRAPH_VIDEO_BASE = `${META_GRAPH_VIDEO_HOST}/${META_GRAPH_VERSION}`;

/** Followed by the user's browser, not called by the server. */
export const META_OAUTH_DIALOG_URL = `${META_DIALOG_HOST}/${META_GRAPH_VERSION}/dialog/oauth`;

export const META_OAUTH_TOKEN_URL = `${META_GRAPH_BASE}/oauth/access_token`;
