import { vendorUrl } from './resolver';

/**
 * The one X API host and version this repository calls (FILM-1723).
 *
 * `api.x.com` replaced `api.twitter.com`, and the v1.1 chunked upload on
 * `upload.twitter.com` was retired in favour of `/2/media/upload`. The v2
 * upload is not the v1.1 protocol on a new path: INIT, APPEND and FINALIZE are
 * separate endpoints (`/initialize`, `/{id}/append`, `/{id}/finalize`) and X
 * rejects the old `command=` parameters on them. Only STATUS keeps its
 * `command` query.
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *
 * X API v2 is unversioned beyond the `/2` path segment and publishes no
 * end-of-life for it, so there is no expiry to record here.
 *
 * `/2/media/upload` requires the `media.write` scope on an OAuth 2.0 user
 * token. `TWITTER_OAUTH_CONFIG.scopes` does not request it, and adding a scope
 * is outside FILM-1723, so a video upload is refused until it is added and the
 * connection re-authorised.
 */
const X_API_HOST = vendorUrl('x-api');
const X_API_VERSION = '2';
const X_WEB_HOST = vendorUrl('x-oauth');

export const X_API_BASE = `${X_API_HOST}/${X_API_VERSION}`;

const X_MEDIA_UPLOAD_URL = `${X_API_BASE}/media/upload`;

/** The scope `/2/media/upload` demands of an OAuth 2.0 user token. */
export const X_MEDIA_UPLOAD_SCOPE = 'media.write';

/**
 * The chunked upload's endpoints, here once because the provider and the
 * publish lambda each walk the protocol themselves.
 */
export const X_MEDIA_UPLOAD = {
  initialize: `${X_MEDIA_UPLOAD_URL}/initialize`,
  append: (mediaId: string) => `${X_MEDIA_UPLOAD_URL}/${mediaId}/append`,
  finalize: (mediaId: string) => `${X_MEDIA_UPLOAD_URL}/${mediaId}/finalize`,
  status: (mediaId: string) =>
    `${X_MEDIA_UPLOAD_URL}?command=STATUS&media_id=${mediaId}`,
} as const;

/** Followed by the user's browser, not called by the server. */
export const X_OAUTH_AUTHORIZE_URL = `${X_WEB_HOST}/i/oauth2/authorize`;

/** A post's permalink, which does not need its author's handle. */
export function xPostUrl(postId: string) {
  return `${X_WEB_HOST}/i/web/status/${postId}`;
}
