/**
 * Lambda-safe R2 Storage Utility
 *
 * Direct R2 upload without server-only import.
 * Use this in Lambda handlers instead of @kit/storage.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { localServiceUrl } from '@kit/shared/vendors';
import {
  type MediaChecksumClient,
  recordWrittenMedia,
} from '@kit/storage/media-checksum';
import { keyInTarget } from '@kit/storage/upload-paths';

// Singleton S3 client
let s3Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  // Only in the sandbox (FILM-1801's gate): local Supabase Storage's S3
  // endpoint stands in for R2, which a laptop does not have (FILM-1806).
  const local = localServiceUrl('r2');

  if (!accessKeyId || !secretAccessKey || (!accountId && !local)) {
    throw new Error(
      'R2 credentials not configured. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    );
  }

  s3Client = new S3Client(
    local
      ? {
          region: process.env.R2_REGION || 'local',
          endpoint: local,
          forcePathStyle: true,
          credentials: { accessKeyId, secretAccessKey },
        }
      : {
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey },
        },
  );

  return s3Client;
}

export interface R2UploadResult {
  url: string;
  path: string;
}

/** What the job's producer authorised: the only place its files may go */
export interface R2UploadTarget {
  projectId?: string;
  episodeId?: string;
}

/**
 * Upload a file to R2 storage, at a key inside `target` (KB-57). A worker
 * has no user session for `writeProjectObject` to check; its producer
 * authorised the target, and the key must lie in it. Throws before R2 is
 * called otherwise.
 *
 * @param bucket - Logical bucket name (used as path prefix)
 * @param path - File path within bucket
 * @param data - File buffer
 * @param contentType - MIME type
 * @param target - The project or episode the job was authorised for
 * @param checksums - The worker's service-role client: the bytes' SHA-256 is
 *   recorded there once they are stored (KB-189)
 * @returns Public URL and path
 */
export async function uploadToR2(
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
  target: R2UploadTarget,
  checksums: MediaChecksumClient,
): Promise<R2UploadResult> {
  if (!keyInTarget(path, target)) {
    throw new Error(
      `R2 key ${bucket}/${path} is outside its authorised target`,
    );
  }

  const client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME not configured');
  }
  if (!publicUrl) {
    throw new Error('R2_PUBLIC_URL not configured');
  }

  const fullPath = `${bucket}/${path}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fullPath,
      Body: data,
      ContentType: contentType,
    }),
  );

  await recordWrittenMedia(checksums, bucket, path, data);

  return {
    url: `${publicUrl}/${fullPath}`,
    path: fullPath,
  };
}
