/**
 * ImageUploader Component (FILM-207)
 *
 * Main image uploader component that orchestrates the upload flow.
 * Displays dropzone, progress, or preview based on upload state.
 */

'use client';

import { useCallback, useState } from 'react';

import { cn } from '@kit/ui/utils';

import { ImageDropzone } from './ImageDropzone';
import { ImagePreview } from './ImagePreview';
import { ImageUploadProgress } from './ImageUploadProgress';
import type { ImageUploaderProps } from './types';
import { useImageUpload } from './use-image-upload';

/**
 * ImageUploader Component (FILM-207)
 *
 * Main image uploader component that orchestrates the upload flow.
 * Displays dropzone, progress, or preview based on upload state.
 */

/**
 * ImageUploader Component (FILM-207)
 *
 * Main image uploader component that orchestrates the upload flow.
 * Displays dropzone, progress, or preview based on upload state.
 */

export function ImageUploader({
  projectId,
  assetType,
  assetId,
  initialImageUrl,
  initialThumbnailUrl,
  onUploadComplete,
  onRemove,
  maxSize,
  acceptedTypes,
  className,
  disabled = false,
}: ImageUploaderProps) {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const { state, progress, imageInfo, error, upload, cancel, reset } =
    useImageUpload({
      projectId,
      assetType,
      assetId,
      maxSize,
      acceptedTypes,
      onUploadComplete,
    });

  const handleFileDrop = useCallback(
    async (file: File) => {
      await upload(file);
    },
    [upload],
  );

  const handleRemove = useCallback(() => {
    reset();
    onRemove?.();
  }, [reset, onRemove]);

  const handleZoom = useCallback(() => {
    setPreviewModalOpen(true);
  }, []);

  const handlePreviewModalClose = useCallback(() => {
    setPreviewModalOpen(false);
  }, []);

  // Determine what to render based on state
  const hasUploadedImage = state === 'success' && imageInfo;
  const hasInitialImage = state === 'idle' && initialImageUrl;
  const hasImage = hasUploadedImage || hasInitialImage;
  const isUploading = state === 'uploading' || state === 'validating';
  const showDropzone = state === 'idle' && !initialImageUrl;
  const showError = state === 'error';

  return (
    <div
      className={cn('relative', className)}
      data-test="image-uploader"
      data-state={state}
    >
      {showDropzone && (
        <ImageDropzone
          onFileDrop={handleFileDrop}
          maxSize={maxSize}
          acceptedTypes={acceptedTypes}
          disabled={disabled || isUploading}
        />
      )}

      {isUploading && (
        <ImageUploadProgress
          progress={progress}
          state={state}
          onCancel={cancel}
        />
      )}

      {hasImage && (
        <ImagePreview
          imageUrl={imageInfo?.url ?? initialImageUrl ?? ''}
          thumbnailUrl={imageInfo?.thumbnailUrl ?? initialThumbnailUrl}
          width={imageInfo?.width}
          height={imageInfo?.height}
          size={imageInfo?.size}
          onRemove={handleRemove}
          onZoom={handleZoom}
          previewModalOpen={previewModalOpen}
          onPreviewModalClose={handlePreviewModalClose}
        />
      )}

      {showError && error && (
        <ImageDropzone
          onFileDrop={handleFileDrop}
          maxSize={maxSize}
          acceptedTypes={acceptedTypes}
          error={error.message}
          onRetry={reset}
          disabled={disabled}
        />
      )}
    </div>
  );
}
