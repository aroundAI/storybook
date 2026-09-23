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
  /**
   * The request headers the PUT must send, exactly. On R2 and B2 they are
   * part of the signature, so a PUT with other values is refused (KB-38).
   * `Content-Length` is signed too but is not listed: the browser sets it
   * from the body, which must be exactly `contentLength` bytes.
   */
  headers: Record<string, string>;
}

/**
 * What a presigned upload URL is issued for (KB-38)
 */
export interface SignedUploadRequest {
  /** MIME type the PUT must send */
  contentType: string;
  /** Exact byte length of the body the PUT must send */
  contentLength: number;
  /** URL expiration in seconds (default: 3600) */
  expiresIn?: number;
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
   * @param request - The content type and exact size the upload may have
   * @returns Presigned upload URL, public URL and the headers to send
   */
  getSignedUploadUrl(
    bucket: string,
    path: string,
    request: SignedUploadRequest,
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
