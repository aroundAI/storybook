import 'server-only';

import { type StorageAdapter, storageKeyFromPublicUrl } from '@kit/storage';
import { STORAGE_BUCKETS } from '@kit/storage/buckets';
import { keyInTarget } from '@kit/storage/upload-paths';

import type { MediaEntry, MediaReason } from '../edit-package.schema';

/**
 * FILM-2001: every media URL a package names becomes a presigned GET, or a
 * reason it is not one. Never a broken link.
 *
 * The URLs come from rows the caller read under RLS, but a row's URL is
 * whatever its writer stored, and R2 signs with the app's own credentials.
 * So a URL is signed only when its key lies in this episode's own project
 * or episode folder (KB-57's `keyInTarget`), or is the legacy key of an
 * audio asset the caller read in this project. Anything else is
 * `outside_project`, and nothing is signed for it.
 */

export interface ResolveMediaOptions {
  storage: StorageAdapter;
  projectId: string;
  episodeId: string;
  /** Audio assets of this project the caller read: their legacy keys are theirs. */
  audioAssetIds: ReadonlySet<string>;
  /** Stored URL → recorded SHA-256 (`assets.file_hash`). */
  recordedHashes: Readonly<Record<string, string>>;
  ttlSeconds: number;
  /** Parallel HEAD + sign requests. */
  concurrency?: number;
}

const SHA256 = /^[0-9a-f]{64}$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function mimeFor(key: string, stored: string | null) {
  if (stored && stored !== 'application/octet-stream') return stored;

  const extension = key.split('.').pop()?.toLowerCase() ?? '';

  return MIME_BY_EXTENSION[extension] ?? stored ?? 'application/octet-stream';
}

/** Where a stored URL lives in StoryBook's storage, or null. */
function locate(storage: StorageAdapter, url: string) {
  for (const bucket of Object.values(STORAGE_BUCKETS)) {
    const key = storageKeyFromPublicUrl(storage, bucket, url);

    if (key) return { bucket, key };
  }

  return null;
}

function isOwnKey(
  bucket: string,
  key: string,
  options: ResolveMediaOptions,
): boolean {
  if (
    keyInTarget(key, {
      projectId: options.projectId,
      episodeId: options.episodeId,
    })
  ) {
    return true;
  }

  // `audio-assets/music|sfx/<audioAssetId>.mp3`, which names no project.
  const legacy = /^(?:music|sfx)\/([0-9a-f-]{36})\.mp3$/i.exec(key);

  return (
    bucket === STORAGE_BUCKETS.audioAssets &&
    legacy !== null &&
    options.audioAssetIds.has(legacy[1]!.toLowerCase())
  );
}

const missing = (mediaReason: MediaReason): MediaEntry => ({
  url: null,
  mediaReason,
});

async function resolveOne(
  url: string,
  options: ResolveMediaOptions,
): Promise<MediaEntry> {
  const location = locate(options.storage, url);

  if (!location) return missing('not_in_storage');

  const { bucket, key } = location;

  if (!isOwnKey(bucket, key, options)) return missing('outside_project');

  try {
    const info = await options.storage.stat(bucket, key);

    if (!info) return missing('missing');

    const signed = await options.storage.getSignedReadUrl(
      bucket,
      key,
      options.ttlSeconds,
    );
    const recorded = options.recordedHashes[url];

    return {
      url: signed,
      key: `${bucket}/${key}`,
      ...(recorded && SHA256.test(recorded)
        ? { sha256: recorded.toLowerCase() }
        : { sha256: null, sha256Reason: 'not_recorded' as const }),
      bytes: info.bytes,
      mime: mimeFor(key, info.contentType),
    };
  } catch {
    // No detail: the error may carry the object's URL, which is not logged.
    return missing('unavailable');
  }
}

/** The entry for each URL, keyed by the URL as stored. */
export async function resolveMedia(
  urls: string[],
  options: ResolveMediaOptions,
): Promise<Map<string, MediaEntry>> {
  const resolved = new Map<string, MediaEntry>();
  const queue = [...urls];
  const workers = Array.from(
    { length: Math.max(1, Math.min(options.concurrency ?? 32, queue.length)) },
    async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        resolved.set(url, await resolveOne(url, options));
      }
    },
  );

  await Promise.all(workers);

  return resolved;
}
