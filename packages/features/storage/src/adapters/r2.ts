/**
 * Cloudflare R2 Storage Adapter
 *
 * Uses S3-compatible API for Cloudflare R2.
 * Provides zero egress fees for video/audio streaming.
 *
 * Required environment variables:
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_ACCESS_KEY_ID: R2 API token access key
 * - R2_SECRET_ACCESS_KEY: R2 API token secret
 * - R2_BUCKET_NAME: R2 bucket name
 * - R2_PUBLIC_URL: Public URL for the bucket (custom domain or r2.dev)
 */
import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type {
  SignedUploadRequest,
  SignedUploadResult,
  StorageAdapter,
  UploadOptions,
  UploadResult,
} from '../types';
import { createPresignClient, presignPut } from './s3-presign';

export class R2StorageAdapter implements StorageAdapter {
  private s3Client: S3Client;
  private presignClient: S3Client;
  private bucketName: string;
  private publicUrl: string;

  constructor(options?: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucketName?: string;
    publicUrl?: string;
    /** Defaults to the account's R2 endpoint. Tests point it at a local S3 server. */
    endpoint?: string;
  }) {
    const accountId = options?.accountId ?? process.env.R2_ACCOUNT_ID;
    const accessKeyId = options?.accessKeyId ?? process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey =
      options?.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = options?.bucketName ?? process.env.R2_BUCKET_NAME ?? '';
    this.publicUrl = options?.publicUrl ?? process.env.R2_PUBLIC_URL ?? '';

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
      );
    }

    if (!this.bucketName) {
      throw new Error('R2 bucket name not configured. Set R2_BUCKET_NAME.');
    }

    const config = {
      region: 'auto',
      endpoint:
        options?.endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    };

    this.s3Client = new S3Client(config);
    this.presignClient = createPresignClient(config);
  }

  async upload(
    bucket: string,
    path: string,
    data: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    // Use bucket as a prefix in the path for organization
    const fullPath = `${bucket}/${path}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
        Body: data,
        ContentType: options.contentType,
      }),
    );

    const url = this.getPublicUrl(bucket, path);

    return { path, url };
  }

  async getSignedUploadUrl(
    bucket: string,
    path: string,
    { contentType, contentLength, expiresIn = 3600 }: SignedUploadRequest,
  ): Promise<SignedUploadResult> {
    const { uploadUrl, headers } = await presignPut(this.presignClient, {
      bucket: this.bucketName,
      key: `${bucket}/${path}`,
      contentType,
      contentLength,
      expiresIn,
    });

    const publicUrl = this.getPublicUrl(bucket, path);

    return {
      uploadUrl,
      publicUrl,
      expiresIn,
      headers,
    };
  }

  getPublicUrl(bucket: string, path: string): string {
    const fullPath = `${bucket}/${path}`;

    if (this.publicUrl) {
      // Use custom domain or r2.dev URL
      return `${this.publicUrl}/${fullPath}`;
    }

    // Fallback: R2 doesn't have default public URLs, so this requires configuration
    throw new Error(
      'R2_PUBLIC_URL not configured. Set a custom domain or r2.dev URL.',
    );
  }

  async delete(bucket: string, path: string): Promise<void> {
    const fullPath = `${bucket}/${path}`;

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fullPath,
      }),
    );
  }

  async exists(bucket: string, path: string): Promise<boolean> {
    const fullPath = `${bucket}/${path}`;

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: fullPath,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async read(bucket: string, path: string): Promise<Buffer | null> {
    const fullPath = `${bucket}/${path}`;

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: fullPath,
        }),
      );

      if (!response.Body) {
        return null;
      }

      // Convert readable stream to buffer
      const chunks: Uint8Array[] = [];
      const body = response.Body as AsyncIterable<Uint8Array>;

      for await (const chunk of body) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
}

/**
 * Create a Cloudflare R2 storage adapter instance
 */
export function createR2StorageAdapter(options?: {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  publicUrl?: string;
}): R2StorageAdapter {
  return new R2StorageAdapter(options);
}
