/**
 * useImageUpload Hook (FILM-207)
 *
 * Custom hook for handling image uploads with progress tracking.
 * Uses XMLHttpRequest for upload progress events.
 */

'use client';

import { useCallback, useRef, useState } from 'react';

import { validateUpload } from '@kit/assets/upload-validation';

import type {
  ImageInfo,
  UploadError,
  UploadProgress,
  UploadResponse,
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
export function useImageUpload(
  options: UseImageUploadOptions,
): UseImageUploadReturn {
  const { projectId, assetType, assetId, onUploadComplete } = options;

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

      // 2. Prepare FormData
      setState('uploading');
      setProgress({ loaded: 0, total: file.size, percentage: 0 });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('assetType', assetType);
      if (assetId) {
        formData.append('assetId', assetId);
      }

      // 3. Upload with XMLHttpRequest for progress tracking
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        // Track upload progress
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

        // Handle successful response
        xhr.addEventListener('load', () => {
          xhrRef.current = null;

          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText) as UploadResponse;
              setState('success');
              setImageInfo({
                url: response.imageUrl,
                thumbnailUrl: response.thumbnailUrl,
                width: response.width,
                height: response.height,
                size: response.size,
                contentType: response.contentType,
                name: file.name,
              });
              onUploadComplete?.(response.imageUrl, response.thumbnailUrl);
              resolve();
            } catch {
              setState('error');
              setError({
                code: 'PARSE_ERROR',
                message: 'Failed to parse server response',
              });
              reject(new Error('Failed to parse response'));
            }
          } else {
            // Handle HTTP errors
            try {
              const errorResponse = JSON.parse(xhr.responseText) as Record<
                string,
                unknown
              > | null;
              setState('error');
              setError({
                code:
                  typeof errorResponse?.code === 'string'
                    ? errorResponse.code
                    : 'UPLOAD_FAILED',
                message:
                  typeof errorResponse?.error === 'string'
                    ? errorResponse.error
                    : 'Upload failed',
                details: errorResponse?.details as Record<string, unknown>,
              });
            } catch {
              setState('error');
              setError({
                code: 'UPLOAD_FAILED',
                message: `Upload failed with status ${xhr.status}`,
              });
            }
            reject(new Error('Upload failed'));
          }
        });

        // Handle network errors
        xhr.addEventListener('error', () => {
          xhrRef.current = null;
          setState('error');
          setError({
            code: 'NETWORK_ERROR',
            message: 'Network error occurred. Please check your connection.',
          });
          reject(new Error('Network error'));
        });

        // Handle abort
        xhr.addEventListener('abort', () => {
          xhrRef.current = null;
          setState('idle');
          setProgress({ loaded: 0, total: 0, percentage: 0 });
          resolve();
        });

        // Send request
        xhr.open('POST', `/api/projects/${projectId}/assets/upload`);
        xhr.send(formData);
      });
    },
    [projectId, assetType, assetId, validate, onUploadComplete],
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
