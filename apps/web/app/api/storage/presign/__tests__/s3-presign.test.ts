import { describe, expect, it } from 'vitest';

import { B2StorageAdapter, R2StorageAdapter } from '@kit/storage';

/**
 * KB-38: an R2 (or B2) upload URL must bind the content type and the exact
 * byte count it was issued for. Without them it binds only the host and the
 * key, so whoever holds it can store any bytes, of any type, of any size.
 *
 * `@aws-sdk/s3-request-presigner` drops `content-type` from the signature
 * unless it is named in `signableHeaders`, even when `ContentType` is set.
 * And since SDK 3.729 a presigned PUT carries the CRC32 of an empty body,
 * because there is no body at signing time.
 *
 * Dummy credentials: signing is local, nothing is sent.
 */

const PATH =
  'projects/11111111-3800-4000-8000-000000000001/assets/covers/c.png';

function r2() {
  return new R2StorageAdapter({
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucketName: 'test-bucket',
    publicUrl: 'https://r2.test',
  });
}

function b2() {
  return new B2StorageAdapter({
    keyId: 'test-key',
    applicationKey: 'test-secret',
    bucketName: 'test-bucket',
    endpoint: 's3.test-region.backblazeb2.com',
    publicUrl: 'https://b2.test',
  });
}

const adapters = [
  ['R2', r2],
  ['B2', b2],
] as const;

describe.each(adapters)('%s presigned upload URL', (_name, make) => {
  async function sign(contentType = 'image/png', contentLength = 1000) {
    const result = await make().getSignedUploadUrl('project-assets', PATH, {
      contentType,
      contentLength,
      expiresIn: 900,
    });

    return { result, url: new URL(result.uploadUrl) };
  }

  it('signs content-length and content-type, not only the host', async () => {
    const { url } = await sign();

    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    );
  });

  it('carries no checksum of an empty body', async () => {
    const { url } = await sign();

    const checksumParams = [...url.searchParams.keys()].filter((key) =>
      key.toLowerCase().includes('checksum'),
    );

    expect(checksumParams).toEqual([]);
  });

  it('puts the object under the bucket prefix and keeps the expiry', async () => {
    const { url } = await sign();

    expect(url.hostname.startsWith('test-bucket.')).toBe(true);
    expect(url.pathname).toBe(`/project-assets/${PATH}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('returns exactly the headers the PUT must send', async () => {
    const { result } = await sign('video/mp4', 5000);

    expect(result.headers).toEqual({ 'Content-Type': 'video/mp4' });
  });

  it('gives a different signature for a different length or type', async () => {
    const signature = async (type: string, length: number) =>
      (await sign(type, length)).url.searchParams.get('X-Amz-Signature');

    // Same second, same key: only the declared values differ.
    const [base, longer, otherType] = await Promise.all([
      signature('image/png', 1000),
      signature('image/png', 1001),
      signature('text/html', 1000),
    ]);

    expect(longer).not.toBe(base);
    expect(otherType).not.toBe(base);
  });
});
