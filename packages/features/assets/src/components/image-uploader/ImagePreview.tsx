/**
 * ImagePreview Component (FILM-207)
 *
 * Displays uploaded image with remove and zoom actions.
 */

'use client';

import { X, ZoomIn } from 'lucide-react';

import { formatFileSize } from '@kit/assets/upload-validation';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { cn } from '@kit/ui/utils';

/**
 * ImagePreview Component (FILM-207)
 *
 * Displays uploaded image with remove and zoom actions.
 */

/**
 * ImagePreview Component (FILM-207)
 *
 * Displays uploaded image with remove and zoom actions.
 */

interface ImagePreviewProps {
  /** Full-size image URL */
  imageUrl: string;
  /** Thumbnail URL (optional, falls back to imageUrl) */
  thumbnailUrl?: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** File size in bytes */
  size?: number;
  /** Callback when remove button is clicked */
  onRemove: () => void;
  /** Callback when zoom button is clicked */
  onZoom: () => void;
  /** Whether the zoom modal is open */
  previewModalOpen: boolean;
  /** Callback to close the zoom modal */
  onPreviewModalClose: () => void;
  /** Additional CSS class names */
  className?: string;
}

export function ImagePreview({
  imageUrl,
  thumbnailUrl,
  width,
  height,
  size,
  onRemove,
  onZoom,
  previewModalOpen,
  onPreviewModalClose,
  className,
}: ImagePreviewProps) {
  const displayUrl = thumbnailUrl ?? imageUrl;

  return (
    <>
      <div
        className={cn(
          'bg-muted/30 group relative overflow-hidden rounded-lg border',
          className,
        )}
        data-test="image-preview"
      >
        {/* Image thumbnail */}
        <div className="relative aspect-video">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl}
            alt="Uploaded image preview"
            className="h-full w-full object-cover"
            loading="lazy"
          />

          {/* Overlay with actions */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onZoom}
              aria-label="Zoom image"
              data-test="image-preview-zoom"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onRemove}
              aria-label="Remove image"
              data-test="image-preview-remove"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Image info */}
        {(width || height || size) && (
          <div className="text-muted-foreground flex items-center justify-between p-2 text-xs">
            {width && height && (
              <span>
                {width} x {height}px
              </span>
            )}
            {size && <span>{formatFileSize(size)}</span>}
          </div>
        )}
      </div>

      {/* Zoom modal */}
      <Dialog open={previewModalOpen} onOpenChange={onPreviewModalClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Image Preview</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Full size image preview"
              className="max-h-[70vh] max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
