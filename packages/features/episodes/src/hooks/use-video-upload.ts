'use client';

/**
 * useVideoUpload Hook
 *
 * Custom hook for handling video uploads with progress tracking.
 * Extracts first frame as thumbnail using browser-side canvas.
 * Uses XMLHttpRequest for upload progress events.
 */
import { useCallback, useRef, useState } from 'react';

import { PROJECT_ASSETS_BUCKET } from '@kit/assets/lib';
import { sanitizeFilename } from '@kit/assets/upload-validation';
import { requestPresignedUpload } from '@kit/storage/client';

// Video constraints
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mov'];

export type VideoUploadState =
  | 'idle'
  | 'validating'
  | 'extracting_thumbnail'
  | 'uploading'
  | 'success'
  | 'error';

export interface VideoUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface VideoInfo {
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  contentType: string;
  name: string;
}

export interface VideoUploadError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface UseVideoUploadOptions {
  projectId: string;
  shotId: string;
  onUploadComplete?: (videoUrl: string, thumbnailUrl: string) => void;
  onError?: (error: VideoUploadError) => void;
}

export interface UseVideoUploadReturn {
  state: VideoUploadState;
  progress: VideoUploadProgress;
  videoInfo: VideoInfo | null;
  error: VideoUploadError | null;
  upload: (file: File) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  validate: (
    file: File,
  ) => Promise<{ valid: boolean; error?: VideoUploadError }>;
}

/**
 * Extract first frame from video as a thumbnail
 */
async function extractFirstFrame(videoFile: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };

    video.onloadedmetadata = () => {
      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        // Use 16:9 aspect ratio, max 512px width
        const targetWidth = Math.min(512, video.videoWidth);
        const targetHeight = Math.round(targetWidth * (9 / 16));
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw video frame to canvas (center crop if aspect ratio differs)
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = canvas.width / canvas.height;

        let sx = 0,
          sy = 0,
          sWidth = video.videoWidth,
          sHeight = video.videoHeight;

        if (videoAspect > canvasAspect) {
          // Video is wider - crop sides
          sWidth = video.videoHeight * canvasAspect;
          sx = (video.videoWidth - sWidth) / 2;
        } else {
          // Video is taller - crop top/bottom
          sHeight = video.videoWidth / canvasAspect;
          sy = (video.videoHeight - sHeight) / 2;
        }

        ctx.drawImage(
          video,
          sx,
          sy,
          sWidth,
          sHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );

        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create thumbnail blob'));
            }
          },
          'image/webp',
          0.8,
        );
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video for thumbnail extraction'));
    };

    video.src = URL.createObjectURL(videoFile);
    video.load();
  });
}

/**
 * Get video metadata (duration, dimensions)
 */
async function getVideoMetadata(
  videoFile: File,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(video.src);
      video.remove();
      resolve(metadata);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = URL.createObjectURL(videoFile);
    video.load();
  });
}

/**
 * Hook for uploading videos with progress tracking
 */
export function useVideoUpload(
  options: UseVideoUploadOptions,
): UseVideoUploadReturn {
  const { projectId, shotId, onUploadComplete, onError } = options;

  const [state, setState] = useState<VideoUploadState>('idle');
  const [progress, setProgress] = useState<VideoUploadProgress>({
    loaded: 0,
    total: 0,
    percentage: 0,
  });
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<VideoUploadError | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  /**
   * Validate a video file before upload
   */
  const validate = useCallback(
    async (
      file: File,
    ): Promise<{ valid: boolean; error?: VideoUploadError }> => {
      // Check file size
      if (file.size > MAX_VIDEO_SIZE) {
        return {
          valid: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File size exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit`,
            details: { size: file.size, maxSize: MAX_VIDEO_SIZE },
          },
        };
      }

      // Check MIME type
      if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
        return {
          valid: false,
          error: {
            code: 'INVALID_TYPE',
            message: `Invalid video type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
            details: { type: file.type, allowed: ALLOWED_VIDEO_TYPES },
          },
        };
      }

      // Check extension
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return {
          valid: false,
          error: {
            code: 'INVALID_EXTENSION',
            message: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
            details: { extension: ext, allowed: ALLOWED_EXTENSIONS },
          },
        };
      }

      return { valid: true };
    },
    [],
  );

  /**
   * Upload a video file with thumbnail extraction
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
        onError?.(validation.error!);
        return;
      }

      // 2. Extract thumbnail from first frame
      setState('extracting_thumbnail');
      let thumbnailBlob: Blob;
      let metadata: { duration: number; width: number; height: number };

      try {
        [thumbnailBlob, metadata] = await Promise.all([
          extractFirstFrame(file),
          getVideoMetadata(file),
        ]);
      } catch (err) {
        const extractError: VideoUploadError = {
          code: 'THUMBNAIL_EXTRACTION_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to extract video thumbnail',
        };
        setState('error');
        setError(extractError);
        onError?.(extractError);
        return;
      }

      // 3. Upload video and thumbnail via presigned URLs (bypasses API Gateway 10MB limit)
      setState('uploading');
      setProgress({
        loaded: 0,
        total: file.size + thumbnailBlob.size,
        percentage: 0,
      });

      const timestamp = Date.now();
      const sanitizedName = sanitizeFilename(file.name);
      const videoPath = `projects/${projectId}/shots/${shotId}/video/${timestamp}-${sanitizedName}`;
      const thumbnailPath = `projects/${projectId}/shots/${shotId}/thumbnail/${timestamp}.webp`;

      let videoUrl: string;
      let thumbnailUrl: string;

      try {
        // 3a. Get presigned URLs for both files
        // Each URL is signed for its body's exact size and type (KB-38)
        const [videoPresign, thumbnailPresign] = await Promise.all([
          requestPresignedUpload({
            bucket: PROJECT_ASSETS_BUCKET,
            path: videoPath,
            contentType: file.type,
            size: file.size,
          }),
          requestPresignedUpload({
            bucket: PROJECT_ASSETS_BUCKET,
            path: thumbnailPath,
            contentType: 'image/webp',
            size: thumbnailBlob.size,
          }),
        ]);

        // 3b. Upload video directly to storage with progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const percentage = Math.round((event.loaded / event.total) * 95); // 95% for video
              setProgress({
                loaded: event.loaded,
                total: file.size,
                percentage,
              });
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(
                new Error(`Video upload failed with status ${xhr.status}`),
              );
            }
          });

          xhr.addEventListener('error', () =>
            reject(new Error('Video upload network error')),
          );
          xhr.addEventListener('abort', () =>
            reject(new Error('Upload cancelled')),
          );

          xhr.open('PUT', videoPresign.uploadUrl, true);
          for (const [name, value] of Object.entries(videoPresign.headers)) {
            xhr.setRequestHeader(name, value);
          }
          xhr.send(file);
        });

        videoUrl = videoPresign.publicUrl;
        xhrRef.current = null;

        // 3c. Upload thumbnail (small, no progress tracking needed)
        setProgress((prev) => ({ ...prev, percentage: 97 }));
        const thumbResponse = await fetch(thumbnailPresign.uploadUrl, {
          method: 'PUT',
          body: thumbnailBlob,
          headers: thumbnailPresign.headers,
        });

        if (!thumbResponse.ok) {
          throw new Error(
            `Thumbnail upload failed with status ${thumbResponse.status}`,
          );
        }

        thumbnailUrl = thumbnailPresign.publicUrl;
      } catch (err) {
        xhrRef.current = null;
        if (err instanceof Error && err.message === 'Upload cancelled') {
          setState('idle');
          setProgress({ loaded: 0, total: 0, percentage: 0 });
          return;
        }
        const uploadError: VideoUploadError = {
          code: 'UPLOAD_FAILED',
          message: err instanceof Error ? err.message : 'Upload failed',
        };
        setState('error');
        setError(uploadError);
        onError?.(uploadError);
        return;
      }

      // 4. Update shot record with metadata (small JSON, well under API Gateway limit)
      setProgress((prev) => ({ ...prev, percentage: 99 }));

      try {
        const metadataResponse = await fetch(
          `/api/projects/${projectId}/shots/${shotId}/upload`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoUrl,
              thumbnailUrl,
              duration: String(Math.round(metadata.duration)),
              width: String(metadata.width),
              height: String(metadata.height),
              size: file.size,
              contentType: file.type,
            }),
          },
        );

        if (!metadataResponse.ok) {
          const errorBody = (await metadataResponse
            .json()
            .catch(() => ({}))) as Record<string, unknown>;
          throw new Error(
            (errorBody.error as string) ||
              `Metadata update failed with status ${metadataResponse.status}`,
          );
        }

        const response = (await metadataResponse.json()) as {
          success: boolean;
          videoUrl: string;
          thumbnailUrl: string;
        };

        setState('success');
        setProgress({ loaded: file.size, total: file.size, percentage: 100 });
        setVideoInfo({
          videoUrl: response.videoUrl,
          thumbnailUrl: response.thumbnailUrl,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          size: file.size,
          contentType: file.type,
          name: file.name,
        });
        onUploadComplete?.(response.videoUrl, response.thumbnailUrl);
      } catch (err) {
        const metadataError: VideoUploadError = {
          code: 'METADATA_UPDATE_FAILED',
          message:
            err instanceof Error ? err.message : 'Failed to update shot record',
        };
        setState('error');
        setError(metadataError);
        onError?.(metadataError);
      }
    },
    [projectId, shotId, validate, onUploadComplete, onError],
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
    setVideoInfo(null);
    setError(null);
  }, [cancel]);

  return {
    state,
    progress,
    videoInfo,
    error,
    upload,
    cancel,
    reset,
    validate,
  };
}
