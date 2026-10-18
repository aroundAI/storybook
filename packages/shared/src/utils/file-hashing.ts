import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * A file's SHA-256, lower-case hex: deduplication on the Publish screen and
 * the checksum an upload records (KB-189). Read chunk by chunk from
 * `file.stream()` (FILM-2212): a video may be close to 5 GB, and
 * `crypto.subtle.digest` takes the whole file as one buffer, which a
 * browser tab cannot hold.
 */
export async function calculateFileHash(file: Blob): Promise<string> {
  const hash = sha256.create();
  const reader = file.stream().getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }

  return bytesToHex(hash.digest());
}
