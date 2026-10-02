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
 * token. `TWITTER_OAUTH_CONFIG.scopes` requests it (FILM-1729); a connection
 * made before that lacks it, and its upload is refused until it reconnects.
 */
const X_API_HOST = vendorUrl('x-api');
export const X_API_VERSION = '2';
const X_WEB_HOST = vendorUrl('x-oauth');

export const X_API_BASE = `${X_API_HOST}/${X_API_VERSION}`;

const X_MEDIA_UPLOAD_URL = `${X_API_BASE}/media/upload`;

/** The scope `/2/media/upload` demands of an OAuth 2.0 user token. */
export const X_MEDIA_UPLOAD_SCOPE = 'media.write';

/**
 * FILM-1729. Refresh cannot add a scope, so an X connection made before
 * `media.write` was requested can never upload video until it reconnects.
 * Read from the grant stored at connect time; a connection that recorded
 * none predates the scope.
 */
export function holdsXUploadScope(scopes: readonly string[] | null): boolean {
  return (scopes ?? []).includes(X_MEDIA_UPLOAD_SCOPE);
}

/**
 * The words shown in place of an X publish such a connection cannot make:
 * by the publish action as a refusal value, and by the worker as the
 * failed job's error.
 */
export function xUploadScopeRefusal(accountNames: readonly string[]): string {
  const accounts = accountNames.map((name) => `@${name}`).join(', ');

  return `${accounts} was connected before X allowed us to upload video (the ${X_MEDIA_UPLOAD_SCOPE} permission). In Settings → Platforms, disconnect X and connect it again, then publish.`;
}

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

/**
 * X's limits on a Post video that hold for every account (FILM-1729), from
 * https://docs.x.com/x-api/media/quickstart/best-practices, read 2026-10-01:
 * "Duration: must be at least 0.5 seconds … 20 minutes by default for Post
 * video", "File size: … 8 GB default for Post video", "Aspect ratio: must be
 * between 1:3 and 3:1". Premium accounts get 125 minutes and 16 GB; we cannot
 * tell which an account is, so the default applies.
 *
 * Not enforced, deliberately: the same page says dimensions "must be between
 * 32x32 and 1280x1024" yet that subscribers "can upload a 1080p video", so the
 * maximum is not a rule we can apply; frame rate and codec need the sample
 * tables, not the header this reads.
 */
export const X_VIDEO_LIMITS = {
  minSeconds: 0.5,
  maxSeconds: 20 * 60,
  maxBytes: 8 * 1024 ** 3,
  minAspect: 1 / 3,
  maxAspect: 3,
} as const;

/** What a video's MP4 header says about it; null where it could not be read. */
export interface VideoFacts {
  bytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Why X would refuse this video, in words for the person publishing it, or
 * null when it is within X's limits.
 */
export function xVideoRefusal(facts: VideoFacts): string | null {
  const { bytes, durationSeconds, width, height } = facts;

  if (durationSeconds === null || !width || !height) {
    return "X can't take this video: we couldn't read its length and shape from the file, so it can't be checked against X's limits. Upload it again as an MP4.";
  }

  if (durationSeconds < X_VIDEO_LIMITS.minSeconds) {
    return `X can't take this video: it is ${durationSeconds.toFixed(1)} seconds long, and X needs at least ${X_VIDEO_LIMITS.minSeconds} seconds.`;
  }

  if (durationSeconds > X_VIDEO_LIMITS.maxSeconds) {
    return `X can't take this video: it is ${Math.ceil(durationSeconds / 60)} minutes long, and X takes at most ${X_VIDEO_LIMITS.maxSeconds / 60} minutes. Publish a Short to X instead.`;
  }

  if (bytes !== null && bytes > X_VIDEO_LIMITS.maxBytes) {
    return `X can't take this video: it is ${(bytes / 1024 ** 3).toFixed(1)} GB, and X takes at most 8 GB.`;
  }

  const aspect = width / height;

  if (aspect < X_VIDEO_LIMITS.minAspect || aspect > X_VIDEO_LIMITS.maxAspect) {
    return `X can't take this video: it is ${width}×${height}, and X needs a shape between 1:3 (tall) and 3:1 (wide).`;
  }

  return null;
}

/** Followed by the user's browser, not called by the server. */
export const X_OAUTH_AUTHORIZE_URL = `${X_WEB_HOST}/i/oauth2/authorize`;

/** A post's permalink, which does not need its author's handle. */
export function xPostUrl(postId: string) {
  return `${X_WEB_HOST}/i/web/status/${postId}`;
}
