/**
 * Lambda-safe R2 Storage Utility for Render Worker
 *
 * Direct R2 upload without server-only import.
 * Reuses the same pattern as llm-worker/utils/r2-storage.ts
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

// Singleton S3 client
let s3Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials not configured. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    );
  }

  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3Client;
}

export interface R2UploadResult {
  url: string;
  path: string;
}

/**
 * Upload a file to R2 storage
 *
 * @param bucket - Logical bucket name (used as path prefix)
 * @param path - File path within bucket
 * @param data - File buffer or readable stream (stream avoids loading entire file into RAM)
 * @param contentType - MIME type
 * @returns Public URL and path
 */
export async function uploadToR2(
  bucket: string,
  path: string,
  data: Buffer | Readable,
  contentType: string,
): Promise<R2UploadResult> {
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

  return {
    url: `${publicUrl}/${fullPath}`,
    path: fullPath,
  };
}
