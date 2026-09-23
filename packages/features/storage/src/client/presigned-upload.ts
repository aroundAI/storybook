/**
 * Client-side Presigned Upload Utility
 *
 * Uploads files directly to R2 storage using presigned URLs,
 * bypassing the Lambda 6MB payload limit.
 *
 * This module is designed to be used in client-side code across all packages.
 */

interface PresignedUploadResult {
  url: string;
  path: string;
}

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  expiresIn: number;
  /**
   * The headers the PUT must send, exactly. On R2 they are part of the
   * signature, and so is the body's length (KB-38).
   */
  headers: Record<string, string>;
}

export interface PresignRequest {
  bucket: string;
  path: string;
  contentType: string;
  /**
   * The exact byte length of the body the PUT will send (`file.size`,
   * `blob.size`). The URL is signed for this length; any other is refused.
   */
  size: number;
  expiresIn?: number;
}

/**
 * Ask `/api/storage/presign` for an upload URL. The one place a browser
 * calls the route, so no uploader can forget the size it is signed for
 * (KB-38). Throws the route's own message when it refuses.
 */
export async function requestPresignedUpload(
  request: PresignRequest,
): Promise<PresignedUpload> {
  const response = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data = (await response.json().catch(() => ({}))) as
    | PresignedUpload
    | { error?: string };

  if (!response.ok || !('uploadUrl' in data)) {
    throw new Error(
      ('error' in data && data.error) ||
        `Failed to get presigned URL (${response.status})`,
    );
  }

  return data;
}

/**
 * Upload a file using a presigned URL
 *
 * Flow:
 * 1. Request presigned URL from server (small request)
 * 2. Upload file directly to storage using presigned URL (no Lambda)
 * 3. Return public URL
 *
 * @param file - File to upload
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @returns Upload result with URL and path
 */
export async function uploadWithPresignedUrl(
  file: File,
  bucket: string,
  path: string,
): Promise<PresignedUploadResult> {
  // Step 1: Get presigned URL from our API
  const presigned = await requestPresignedUpload({
    bucket,
    path,
    contentType: file.type,
    size: file.size,
    expiresIn: 900, // 15 minutes
  });

  // Step 2: Upload the same file, with exactly the headers it was signed for
  const uploadResponse = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: presigned.headers,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  // Step 3: Return public URL
  return {
    url: presigned.publicUrl,
    path,
  };
}

/**
 * Upload an avatar/profile image
 *
 * @param file - Image file
 * @param accountId - Account ID (user or team)
 * @param bucket - Bucket name (default: 'account_image')
 * @returns Upload result
 */
export async function uploadAvatar(
  file: File,
  accountId: string,
  bucket: string = 'account_image',
): Promise<PresignedUploadResult> {
  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const path = `${accountId}/avatar-${timestamp}.${ext}`;

  return uploadWithPresignedUrl(file, bucket, path);
}

/**
 * Upload a project cover image
 *
 * @param file - Image file
 * @param projectId - Project ID
 * @returns Upload result
 */
export async function uploadProjectCover(
  file: File,
  projectId: string,
): Promise<PresignedUploadResult> {
  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const path = `projects/${projectId}/assets/covers/cover-${timestamp}.${ext}`;

  return uploadWithPresignedUrl(file, 'project-assets', path);
}
