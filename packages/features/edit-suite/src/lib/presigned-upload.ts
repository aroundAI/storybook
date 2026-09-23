/**
 * presigned-upload — upload blobs directly to R2 from the browser.
 *
 * Uses the existing `/api/storage/presign` endpoint to get a presigned URL,
 * then performs a direct PUT to R2. Supports progress tracking via XHR.
 *
 * This bypasses Lambda's 6MB payload limit for client-side rendered exports.
 *
 * The URL is signed for the blob's exact size and type (KB-38): the request
 * declares `blob.size`, and the PUT sends the headers the route returns.
 * This package does not depend on `@kit/storage`, so it keeps its own copy of
 * the request that `@kit/storage/client`'s `requestPresignedUpload` makes.
 */

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface PresignedUploadResult {
  publicUrl: string;
  uploadedAt: string;
}

export interface PresignedUploadOptions {
  /** R2 bucket name */
  bucket: string;
  /** R2 object path (e.g., "projects/{id}/renders/export.mp4") */
  path: string;
  /** MIME type of the blob */
  contentType: string;
  /** Progress callback (0-100) */
  onProgress?: (percent: number) => void;
}

// ──────────────────────────────────────────
// Helper: Get presigned URL from server
// ──────────────────────────────────────────

interface PresignedUrl {
  uploadUrl: string;
  publicUrl: string;
  /** The headers the PUT must send, exactly */
  headers: Record<string, string>;
}

async function getPresignedUrl(
  bucket: string,
  path: string,
  contentType: string,
  size: number,
): Promise<PresignedUrl> {
  const response = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path, contentType, size }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { error?: string }).error ??
        `Presign request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<PresignedUrl>;
}

// ──────────────────────────────────────────
// Upload a Blob via XHR (for progress tracking)
// ──────────────────────────────────────────

function uploadWithProgress(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () =>
      reject(new Error('Upload network error')),
    );
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('PUT', url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(blob);
  });
}

// ──────────────────────────────────────────
// Main export function
// ──────────────────────────────────────────

/**
 * Upload a blob directly to R2 from the browser using a presigned URL.
 *
 * @example
 * ```ts
 * const result = await uploadToR2Presigned(exportBlob, {
 *   bucket: 'storybook-assets',
 *   path: `projects/${projectId}/renders/${Date.now()}_export.mp4`,
 *   contentType: 'video/mp4',
 *   onProgress: (pct) => setUploadProgress(pct),
 * });
 * console.log('Uploaded to:', result.publicUrl);
 * ```
 */
export async function uploadToR2Presigned(
  blob: Blob,
  options: PresignedUploadOptions,
): Promise<PresignedUploadResult> {
  const { bucket, path, contentType, onProgress } = options;

  // 1. Get presigned URL from our API (handles auth + path validation)
  const { uploadUrl, publicUrl, headers } = await getPresignedUrl(
    bucket,
    path,
    contentType,
    blob.size,
  );

  // 2. Upload the same blob directly to R2, with the headers it was signed for
  await uploadWithProgress(uploadUrl, blob, headers, onProgress);

  return {
    publicUrl,
    uploadedAt: new Date().toISOString(),
  };
}
