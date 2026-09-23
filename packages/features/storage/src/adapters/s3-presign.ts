/**
 * Presigned PUT URLs for S3-compatible stores (R2, B2) that bind the upload
 * to one declared content type and one exact byte count (KB-38).
 *
 * - `@aws-sdk/s3-request-presigner` leaves `content-type` out of the
 *   signature even when `ContentType` is set, unless it is named in
 *   `signableHeaders`. Without it the URL binds only the host and the key.
 * - `ContentLength` puts `content-length` in the signature. R2 has no
 *   POST-policy uploads, so an exact signed length is the only size bound a
 *   presigned R2 upload can carry.
 * - The client computes no request checksum. Since SDK 3.729 the default
 *   signs the CRC32 of the body into the URL, and a presigned PUT has no
 *   body yet, so that is the checksum of an empty body. It asserts nothing
 *   about the file.
 */
import 'server-only';

import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createPresignClient(config: S3ClientConfig) {
  return new S3Client({
    ...config,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export async function presignPut(
  client: S3Client,
  request: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  },
) {
  const command = new PutObjectCommand({
    Bucket: request.bucket,
    Key: request.key,
    ContentType: request.contentType,
    ContentLength: request.contentLength,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: request.expiresIn,
    signableHeaders: new Set(['content-type']),
  });

  return {
    uploadUrl,
    headers: { 'Content-Type': request.contentType },
  };
}
