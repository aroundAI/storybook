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

interface PresignedUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  expiresIn: number;
  error?: string;
}

/**
 * Upload a file to R2 storage using presigned URLs
 *
 * Flow:
 * 1. Request presigned URL from server (small request)
 * 2. Upload file directly to R2 using presigned URL (no Lambda)
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
  const presignResponse = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bucket,
      path,
      contentType: file.type,
      expiresIn: 900, // 15 minutes
    }),
  });

  const presignData: PresignedUrlResponse = await presignResponse.json();

  if (!presignResponse.ok || presignData.error) {
    throw new Error(presignData.error || 'Failed to get presigned URL');
  }

  // Step 2: Upload file directly to R2 using presigned URL
  const uploadResponse = await fetch(presignData.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  // Step 3: Return public URL
  return {
    url: presignData.publicUrl,
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
