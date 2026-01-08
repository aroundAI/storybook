/**
 * Backblaze B2 Storage Adapter
 *
 * Uses S3-compatible API for Backblaze B2.
 * Provides low-cost storage with affordable egress.
 *
 * Required environment variables:
 * - B2_KEY_ID: B2 application key ID
 * - B2_APPLICATION_KEY: B2 application key
 * - B2_BUCKET_NAME: B2 bucket name
 * - B2_ENDPOINT: B2 S3-compatible endpoint (e.g., s3.us-west-001.backblazeb2.com)
 * - B2_PUBLIC_URL: Public URL for the bucket (friendly URL)
 */

import 'server-only';

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { SignedUploadResult, StorageAdapter, UploadOptions, UploadResult } from '../types';

export class B2StorageAdapter implements StorageAdapter {
    private s3Client: S3Client;
    private bucketName: string;
    private publicUrl: string;

    constructor(options?: {
        keyId?: string;
        applicationKey?: string;
        bucketName?: string;
        endpoint?: string;
        publicUrl?: string;
    }) {
        const keyId = options?.keyId ?? process.env.B2_KEY_ID;
        const applicationKey = options?.applicationKey ?? process.env.B2_APPLICATION_KEY;
        const endpoint = options?.endpoint ?? process.env.B2_ENDPOINT;
        this.bucketName = options?.bucketName ?? process.env.B2_BUCKET_NAME ?? '';
        this.publicUrl = options?.publicUrl ?? process.env.B2_PUBLIC_URL ?? '';

        if (!keyId || !applicationKey) {
            throw new Error(
                'B2 credentials not configured. Set B2_KEY_ID, B2_APPLICATION_KEY.',
            );
        }

        if (!endpoint) {
            throw new Error('B2 endpoint not configured. Set B2_ENDPOINT.');
        }

        if (!this.bucketName) {
            throw new Error('B2 bucket name not configured. Set B2_BUCKET_NAME.');
        }

        this.s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${endpoint}`,
            credentials: {
                accessKeyId: keyId,
                secretAccessKey: applicationKey,
            },
        });
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
        contentType: string,
        expiresIn: number = 3600,
    ): Promise<SignedUploadResult> {
        const fullPath = `${bucket}/${path}`;

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: fullPath,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(this.s3Client, command, {
            expiresIn,
        });

        const publicUrl = this.getPublicUrl(bucket, path);

        return {
            uploadUrl,
            publicUrl,
            expiresIn,
        };
    }

    getPublicUrl(bucket: string, path: string): string {
        const fullPath = `${bucket}/${path}`;

        if (this.publicUrl) {
            // Use friendly URL
            return `${this.publicUrl}/${fullPath}`;
        }

        // Fallback to B2 friendly URL format
        return `https://f001.backblazeb2.com/file/${this.bucketName}/${fullPath}`;
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
 * Create a Backblaze B2 storage adapter instance
 */
export function createB2StorageAdapter(options?: {
    keyId?: string;
    applicationKey?: string;
    bucketName?: string;
    endpoint?: string;
    publicUrl?: string;
}): B2StorageAdapter {
    return new B2StorageAdapter(options);
}
