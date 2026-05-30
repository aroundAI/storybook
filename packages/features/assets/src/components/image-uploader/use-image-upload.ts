/**
 * useImageUpload Hook (FILM-207)
 *
 * Custom hook for handling image uploads with progress tracking.
 * Uses XMLHttpRequest for upload progress events.
 */

'use client';

import { useCallback, useRef, useState } from 'react';

import { validateUpload } from '@kit/assets/upload-validation';

import { PROJECT_ASSETS_BUCKET } from '../../lib/constants';
import type {
  ImageInfo,
  UploadError,
  UploadProgress,
  UploadState,
  UseImageUploadOptions,
  UseImageUploadReturn,
} from './types';

/**
 * useImageUpload Hook (FILM-207)
 *
 * Custom hook for handling image uploads with progress tracking.
 * Uses XMLHttpRequest for upload progress events.
 */

/**
 * useImageUpload Hook (FILM-207)
 *
 * Custom hook for handling image uploads with progress tracking.
 * Uses XMLHttpRequest for upload progress events.
 */

/**
 * Hook for uploading images with progress tracking
 */

/**
 * useImageUpload Hook (FILM-207)
 *
 * Custom hook for handling image uploads with progress tracking.
 * Uses XMLHttpRequest for upload progress events.
 */

/**
 * Hook for uploading images with progress tracking
 */
export function useImageUpload(
  options: UseImageUploadOptions,
): UseImageUploadReturn {
  const { projectId, assetType, onUploadComplete } = options;

  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState<UploadProgress>({
    loaded: 0,
    total: 0,
    percentage: 0,
  });
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [error, setError] = useState<UploadError | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  /**
   * Validate a file before upload
   *
   * Delegates to validateUpload utility which handles:
   * - File size validation
   * - MIME type validation
   * - File extension validation
   * - Magic bytes verification
   */
  const validate = useCallback(
    async (file: File): Promise<{ valid: boolean; error?: UploadError }> => {
      const result = await validateUpload(file, 'image');

      if (!result.valid) {
        return {
          valid: false,
          error: {
            code: result.error?.code ?? 'UNKNOWN_ERROR',
            message: result.error?.message ?? 'Validation failed',
            details: result.error?.details,
          },
        };
      }

      return { valid: true };
    },
    [],
  );

  /**
   * Upload a file to the server
   */
  /**
   * Upload a file to the server
   */
  const upload = useCallback(
    async (file: File): Promise<void> => {
      // 1. Validate first
      setState('validating');
      setError(null);

      const validation = await validate(file);

      if (!validation.valid) {
        setState('error');
        setError(validation.error ?? null);
        return;
      }

      // 2. Client-side dimension calculation
      let dimensions = { width: 0, height: 0 };
      try {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            dimensions = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(objectUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Failed to load image for dimension calculation'));
          };
          img.src = objectUrl;
        });
      } catch (e) {
        console.warn('Failed to calculate image dimensions client-side', e);
        // Continue upload even if local dimension check fails, validation happened earlier
      }

      // 3. Prepare Upload
      setState('uploading');
      setProgress({ loaded: 0, total: file.size, percentage: 0 });

      try {
        // 3a. Get Presigned URL
        const ext = file.name.split('.').pop() || 'jpg';
        // Use a consistent naming convention like the server did, or random UUID
        const filename = `${crypto.randomUUID()}.${ext}`;
        // Match the path structure expected by policies or conventions
        // /projects/[projectId]/assets/[type]/[filename]
        const storagePath = `projects/${projectId}/assets/${assetType}/${filename}`;

        const presignRes = await fetch('/api/storage/presign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bucket: PROJECT_ASSETS_BUCKET,
            path: storagePath,
            contentType: file.type,
          }),
        });

        if (!presignRes.ok) {
          throw new Error('Failed to obtain upload URL');
        }

        const { uploadUrl, publicUrl } = await presignRes.json();

        // 3b. Upload to R2 with Progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const percentage = Math.round((event.loaded / event.total) * 100);
              setProgress({
                loaded: event.loaded,
                total: event.total,
                percentage,
              });
            }
          });

          xhr.addEventListener('load', () => {
            xhrRef.current = null;
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () =>
            reject(new Error('Network error during upload')),
          );
          xhr.addEventListener('abort', () =>
            reject(new Error('Upload aborted')),
          );

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.send(file);
        });

        // 4. Handle Success
        setState('success');

        // Since we bypassed server generation, we use the main URL as thumbnail
        // or rely on frontend to load the main image.
        const resultInfo: ImageInfo = {
          url: publicUrl,
          thumbnailUrl: publicUrl, // Use same URL as fallback since we skip sharp generation
          width: dimensions.width,
          height: dimensions.height,
          size: file.size,
          contentType: file.type,
          name: file.name,
        };

        setImageInfo(resultInfo);
        onUploadComplete?.(publicUrl, publicUrl);
      } catch (err) {
        setState('error');
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError({
          code: 'UPLOAD_FAILED',
          message,
          details: { error: err },
        });
      }
    },
    [projectId, assetType, validate, onUploadComplete],
  );

  /**
   * Cancel the current upload
   */
  const cancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
  }, []);

  /**
   * Reset to idle state
   */
  const reset = useCallback(() => {
    cancel();
    setState('idle');
    setProgress({ loaded: 0, total: 0, percentage: 0 });
    setImageInfo(null);
    setError(null);
  }, [cancel]);

  return {
    state,
    progress,
    imageInfo,
    error,
    upload,
    cancel,
    reset,
    validate,
  };
}
