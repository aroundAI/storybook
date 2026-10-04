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
 *   projects/{projectId}/episodes/{episodeId}/{type}/{filename} (FILM-2003 renders)
 *   episodes/{episodeId}/{type}/{filename}
 * A filename may hold `_`: `sanitizeFilename` emits it and the export dialog
 * names files `export_en_<ts>.mp4`. Before KB-28 it could not, so every
 * export and every underscore-named shot video was refused. Traversal stays
 * impossible: no segment may contain `/` or be empty, and no `..` may appear
 * anywhere.
 */
const PROJECT_ASSETS_PATH =
  /^(?!.*\.\.)(?:projects\/[a-f0-9-]+\/(?:assets|shots\/[a-f0-9-]+|episodes\/[a-f0-9-]+)|episodes\/[a-f0-9-]+)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/i;

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

/**
 * The folder a project's intros are uploaded to, and the only one the intro
 * action will store a file from (KB-90).
 */
export function projectIntroFolder(projectId: string) {
  return `projects/${projectId}/assets/intros/`;
}

/** A project's intro video for one language (KB-39) */
export function projectIntroPath(
  projectId: string,
  language: string,
  contentType: string,
  now = Date.now(),
) {
  const ext = VIDEO_EXTENSION[contentType.toLowerCase()] ?? 'mp4';

  return `${projectIntroFolder(projectId)}${segment(language)}-${now}.${ext}`;
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

/**
 * The folder an episode's thumbnails are uploaded to, and the only one the
 * thumbnail action will store a file from (KB-90).
 */
export function episodeThumbnailFolder(episodeId: string) {
  return `episodes/${episodeId}/thumbnails/`;
}

export function episodeThumbnailPath(
  episodeId: string,
  language: string,
  ext: string,
  now = Date.now(),
) {
  return `${episodeThumbnailFolder(episodeId)}${segment(language)}-${now}.${ext}`;
}

/**
 * The folder an episode's full and shorts videos are uploaded to, and the
 * only one the save actions will store a new video from (KB-123).
 */
export function episodeVideoFolder(episodeId: string) {
  return `episodes/${episodeId}/videos/`;
}

export function publishVideoPath(
  episodeId: string,
  language: string,
  ext: string,
  now = Date.now(),
) {
  return `${episodeVideoFolder(episodeId)}${language}-${now}.${ext}`;
}

export function shotVideoPath(
  projectId: string,
  shotId: string,
  ext: string,
  now = Date.now(),
) {
  return `projects/${projectId}/shots/${shotId}/video/shot-${shotId}-${now}.${ext}`;
}

/**
 * The folder StorybookStudio's renders of an episode are uploaded to
 * (FILM-2003). Under the project, so KB-28's project rule decides who may
 * write it and KB-123's publish rule accepts its URLs.
 */
export function episodeRenderFolder(projectId: string, episodeId: string) {
  return `projects/${projectId}/episodes/${episodeId}/renders/`;
}

/** A render's video: one key per render row, named by its id */
export function episodeRenderKey(
  projectId: string,
  episodeId: string,
  renderId: string,
) {
  return `${episodeRenderFolder(projectId, episodeId)}${renderId}.mp4`;
}

/** A render's thumbnail */
export function episodeRenderThumbnailKey(
  projectId: string,
  episodeId: string,
  renderId: string,
  contentType: string,
) {
  const ext = IMAGE_EXTENSION[contentType.toLowerCase()] ?? 'jpg';

  return `${episodeRenderFolder(projectId, episodeId)}${renderId}-thumb.${ext}`;
}

/** A render's sidecar captions (WebVTT) */
export function episodeRenderCaptionsKey(
  projectId: string,
  episodeId: string,
  renderId: string,
) {
  return `${episodeRenderFolder(projectId, episodeId)}${renderId}.vtt`;
}

/** The extension of a file name, or `fallback` when it has none */
export function fileExtension(name: string, fallback: string) {
  return name.includes('.') ? name.split('.').pop() || fallback : fallback;
}

/**
 * What the audio library stores (KB-73), and the extension each is kept
 * under. Only types `project-assets` already takes, so the library does not
 * widen KB-28's list.
 */
const AUDIO_LIBRARY_EXTENSION = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
} as const;

export type AudioLibraryUploadType = keyof typeof AUDIO_LIBRARY_EXTENSION;

export const AUDIO_LIBRARY_UPLOAD_TYPES = Object.keys(
  AUDIO_LIBRARY_EXTENSION,
) as AudioLibraryUploadType[];

/** The names browsers give these files, as the type the upload declares */
const AUDIO_TYPE_ALIASES: Record<string, AudioLibraryUploadType> = {
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
};

const AUDIO_EXTENSION_TYPE: Record<string, AudioLibraryUploadType> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/**
 * The type an audio-library upload declares, or `null` when the library does
 * not take the file. A browser that gives no type is judged by the extension;
 * one that names another type is taken at its word.
 */
export function audioLibraryUploadType(
  type: string,
  fileName: string,
): AudioLibraryUploadType | null {
  if (type) {
    return AUDIO_TYPE_ALIASES[type.toLowerCase()] ?? null;
  }

  const ext = fileName.includes('.')
    ? fileName.split('.').pop()!.toLowerCase()
    : '';

  return AUDIO_EXTENSION_TYPE[ext] ?? null;
}

/**
 * An audio-library upload (KB-73). No user text in the key: the name the
 * user gives is kept on the row. The random part keeps two uploads in the
 * same millisecond apart.
 */
export function audioLibraryUploadPath(
  projectId: string,
  contentType: AudioLibraryUploadType,
  now = Date.now(),
  id = globalThis.crypto.randomUUID().slice(0, 8),
) {
  const ext = AUDIO_LIBRARY_EXTENSION[contentType];

  return `projects/${projectId}/assets/audio/${now}-${id}.${ext}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `path` is an audio-library upload in `projectId`'s own folder, the
 * only key the save action will record for that project.
 */
export function isAudioLibraryPath(projectId: string, path: string): boolean {
  if (!UUID.test(projectId)) return false;

  const rule = new RegExp(
    `^projects/${projectId}/assets/audio/\\d+-[0-9a-f]{8}\\.(?:mp3|wav|m4a)$`,
    'i',
  );

  return rule.test(path) && isUploadPath(PROJECT_ASSETS_BUCKET, path);
}

/**
 * What a storage key belongs to, read from the key alone (KB-57). It follows
 * `kit.get_project_id_from_path`, the function every project storage policy
 * runs, except that an `episodes/<id>` key is returned as the episode: which
 * project that is needs the database. Anything else, including a key holding
 * `..` or an empty segment, belongs to nothing, and nothing can write it.
 */
export type StorageKeyScope = { projectId: string } | { episodeId: string };

export function storageKeyScope(key: string): StorageKeyScope | null {
  const parts = key.split('/');

  if (parts.length < 2 || parts.some((part) => part === '' || part === '..')) {
    return null;
  }

  const [first, second] = parts as [string, string];

  if (first === 'projects') {
    return UUID.test(second) ? { projectId: second.toLowerCase() } : null;
  }

  if (first === 'episodes') {
    return UUID.test(second) ? { episodeId: second.toLowerCase() } : null;
  }

  return UUID.test(first) ? { projectId: first.toLowerCase() } : null;
}

/**
 * Whether `key` lies in the project or episode a job was authorised for.
 * For writers with no user session (the workers), whose target was checked
 * by the producer. An episode key needs an episode target, and a project key
 * a project target.
 */
export function keyInTarget(
  key: string,
  target: { projectId?: string; episodeId?: string },
): boolean {
  const scope = storageKeyScope(key);

  if (!scope) return false;

  if ('projectId' in scope) {
    return scope.projectId === target.projectId?.toLowerCase();
  }

  return scope.episodeId === target.episodeId?.toLowerCase();
}

/** A dialogue line's generated audio. The time keeps a regeneration off the CDN's cached copy. */
export function dialogueAudioPath(
  episodeId: string,
  dialogueLineId: string,
  now = Date.now(),
) {
  return `episodes/${episodeId}/dialogue/${dialogueLineId}_${now}.mp3`;
}

/** A voice preview, heard once in the voice picker */
export function voicePreviewPath(
  episodeId: string,
  userId: string,
  now = Date.now(),
) {
  return `episodes/${episodeId}/previews/${userId}-${now}.mp3`;
}

/** Generated SFX or music, in the `audio` or `audio-assets` bucket */
export function generatedAudioPath(
  projectId: string,
  kind: 'sfx' | 'music',
  assetId: string,
) {
  return `projects/${projectId}/${kind}/${assetId}.mp3`;
}
