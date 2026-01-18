/**
 * Storage Adapter Types
 *
 * Defines the interface for all storage adapters.
 */

/**
 * Options for uploading a file
 */
export interface UploadOptions {
    /** MIME type of the file */
    contentType: string;
    /** Cache-Control header value (default: 3600) */
    cacheControl?: string;
    /** Whether to overwrite existing file (default: false) */
    upsert?: boolean;
}

/**
 * Result of an upload operation
 */
export interface UploadResult {
    /** Storage path of the uploaded file */
    path: string;
    /** Public URL to access the file */
    url: string;
}

/**
 * Result of a presigned URL request
 */
export interface SignedUploadResult {
    /** Presigned URL to upload directly */
    uploadUrl: string;
    /** Public URL to access the file after upload */
    publicUrl: string;
    /** Expiration time in seconds */
    expiresIn: number;
}

/**
 * Unified storage adapter interface
 *
 * All storage backends (local, Supabase, S3, etc.) implement this interface.
 */
export interface StorageAdapter {
    /**
     * Upload a file to storage
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     * @param data - File data as Buffer
     * @param options - Upload options (contentType, etc.)
     * @returns Upload result with path and public URL
     */
    upload(
        bucket: string,
        path: string,
        data: Buffer,
        options: UploadOptions,
    ): Promise<UploadResult>;

    /**
     * Get a presigned URL for direct client-side upload
     * This bypasses the Lambda payload limit (6MB)
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     * @param contentType - MIME type of the file
     * @param expiresIn - URL expiration in seconds (default: 3600)
     * @returns Presigned upload URL and public URL
     */
    getSignedUploadUrl(
        bucket: string,
        path: string,
        contentType: string,
        expiresIn?: number,
    ): Promise<SignedUploadResult>;

    /**
     * Get the public URL for a file
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     * @returns Public URL string
     */
    getPublicUrl(bucket: string, path: string): string;

    /**
     * Delete a file from storage
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     */
    delete(bucket: string, path: string): Promise<void>;

    /**
     * Check if a file exists
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     * @returns Whether the file exists
     */
    exists(bucket: string, path: string): Promise<boolean>;

    /**
     * Read a file from storage
     *
     * @param bucket - The bucket/folder name
     * @param path - Path within the bucket
     * @returns File data as Buffer, or null if not found
     */
    read(bucket: string, path: string): Promise<Buffer | null>;
}
