import { createHash } from 'node:crypto';

/**
 * KB-189: the SHA-256 of a stored file, recorded once where it is written,
 * so the edit package (FILM-2001) can hand StorybookStudio a hash for every
 * file without a read path hashing anything.
 *
 * Server and Lambda code only (node:crypto; no `server-only`, which the
 * workers cannot import). The client must be the service role's:
 * `record_media_checksum` is executable by nothing else.
 */

export const SHA256_HEX = /^[0-9a-f]{64}$/;

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A service-role client: only `record_media_checksum` is asked of it. */
export interface MediaChecksumClient {
  rpc(
    fn: 'record_media_checksum',
    args: {
      p_bucket: string;
      p_key: string;
      p_sha256: string;
      p_bytes: number;
    },
  ): PromiseLike<{ error: { message: string } | null }>;
}

export interface MediaChecksum {
  bucket: string;
  key: string;
  sha256: string;
  bytes: number;
}

/**
 * Records `checksum` for the object at `bucket`/`key`. Never throws: the file
 * is stored either way, and one without a recorded hash is what the package
 * already says it is (`sha256Reason: 'not_recorded'`). Returns whether it
 * was recorded, and logs why not.
 */
export async function recordMediaChecksum(
  client: MediaChecksumClient,
  checksum: MediaChecksum,
): Promise<boolean> {
  try {
    if (!SHA256_HEX.test(checksum.sha256)) {
      throw new Error('not a lower-case hex SHA-256');
    }

    const { error } = await client.rpc('record_media_checksum', {
      p_bucket: checksum.bucket,
      p_key: checksum.key,
      p_sha256: checksum.sha256,
      p_bytes: checksum.bytes,
    });

    if (error) throw new Error(error.message);

    return true;
  } catch (error) {
    console.error(
      `[media-checksum] not recorded for ${checksum.bucket}/${checksum.key}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return false;
  }
}

/** Hashes the bytes a writer just stored and records them. */
export function recordWrittenMedia(
  client: MediaChecksumClient,
  bucket: string,
  key: string,
  data: Uint8Array,
): Promise<boolean> {
  return recordMediaChecksum(client, {
    bucket,
    key,
    sha256: sha256Hex(data),
    bytes: data.byteLength,
  });
}
