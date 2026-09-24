/**
 * Upload paths: the keys the app's uploaders build, and the rules the presign
 * route checks them against, in one module.
 *
 * They used to live apart — the intro dialog and `uploadAvatar` built paths
 * the route's pattern refused, so neither upload ever worked (KB-39, KB-53).
 * `upload-paths.test.ts` binds every builder here to its bucket's rule.
 *
 * Safe for client and server: no I/O, no server-only imports.
 */

export const PROJECT_ASSETS_BUCKET = 'project-assets';
export const ACCOUNT_IMAGE_BUCKET = 'account_image';

export type UploadBucket =
  | typeof PROJECT_ASSETS_BUCKET
  | typeof ACCOUNT_IMAGE_BUCKET;

/**
 * The path shapes the project uploaders write, each naming its project:
 *   projects/{projectId}/assets/{type}/{filename}
 *   projects/{projectId}/shots/{shotId}/{type}/{filename}
 *   episodes/{episodeId}/{type}/{filename}
 * A filename may hold `_`: `sanitizeFilename` emits it and the export dialog
 * names files `export_en_<ts>.mp4`. Before KB-28 it could not, so every
 * export and every underscore-named shot video was refused. Traversal stays
 * impossible: no segment may contain `/` or be empty, and no `..` may appear
 * anywhere.
 */
const PROJECT_ASSETS_PATH =
  /^(?!.*\.\.)(?:projects\/[a-f0-9-]+\/(?:assets|shots\/[a-f0-9-]+)|episodes\/[a-f0-9-]+)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/i;

/**
 * `{accountId}.{ext}` and nothing else: the `account_image` bucket policy
 * reads the file name as the owning account's id.
 */
const ACCOUNT_IMAGE_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/;

const UPLOAD_PATH_RULES: Record<UploadBucket, RegExp> = {
  [PROJECT_ASSETS_BUCKET]: PROJECT_ASSETS_PATH,
  [ACCOUNT_IMAGE_BUCKET]: ACCOUNT_IMAGE_PATH,
};

export function isUploadBucket(bucket: string): bucket is UploadBucket {
  return Object.hasOwn(UPLOAD_PATH_RULES, bucket);
}

/** Whether the presign route may sign `path` in `bucket` */
export function isUploadPath(bucket: string, path: string): boolean {
  return isUploadBucket(bucket) && UPLOAD_PATH_RULES[bucket].test(path);
}

const IMAGE_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const VIDEO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** A free-text value made safe for one path segment */
function segment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

/** A project's intro video for one language (KB-39) */
export function projectIntroPath(
  projectId: string,
  language: string,
  contentType: string,
  now = Date.now(),
) {
  const ext = VIDEO_EXTENSION[contentType.toLowerCase()] ?? 'mp4';

  return `projects/${projectId}/assets/intros/${segment(language)}-${now}.${ext}`;
}

/**
 * An account's picture (KB-53). One fixed key per account and type, so a new
 * upload overwrites the last; callers add a cache-busting query to the URL
 * they store.
 */
export function accountImagePath(accountId: string, contentType: string) {
  const ext = IMAGE_EXTENSION[contentType.toLowerCase()] ?? 'png';

  return `${accountId}.${ext}`;
}

export function projectCoverPath(
  projectId: string,
  ext: string,
  now = Date.now(),
) {
  return `projects/${projectId}/assets/covers/cover-${now}.${ext}`;
}

export function episodeThumbnailPath(
  episodeId: string,
  language: string,
  ext: string,
  now = Date.now(),
) {
  return `episodes/${episodeId}/thumbnails/${segment(language)}-${now}.${ext}`;
}

export function publishVideoPath(
  episodeId: string,
  language: string,
  ext: string,
  now = Date.now(),
) {
  return `episodes/${episodeId}/videos/${language}-${now}.${ext}`;
}

export function shotVideoPath(
  projectId: string,
  shotId: string,
  ext: string,
  now = Date.now(),
) {
  return `projects/${projectId}/shots/${shotId}/video/shot-${shotId}-${now}.${ext}`;
}

/** The extension of a file name, or `fallback` when it has none */
export function fileExtension(name: string, fallback: string) {
  return name.includes('.') ? name.split('.').pop() || fallback : fallback;
}
