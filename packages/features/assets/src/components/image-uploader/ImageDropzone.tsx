'use client';

/**
 * ImageDropzone Component (FILM-207)
 *
 * Drag-and-drop zone for image uploads with visual feedback.
 */
import { useCallback, useState } from 'react';

import { AlertCircle, ImageIcon, Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

import {
  UPLOAD_CONSTRAINTS,
  formatFileSize,
} from '@kit/assets/upload-validation';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface ImageDropzoneProps {
  /** Callback when a file is dropped */
  onFileDrop: (file: File) => void;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Accepted MIME types */
  acceptedTypes?: string[];
  /** Whether the dropzone is disabled */
  disabled?: boolean;
  /** Error message to display */
  error?: string;
  /** Callback for retry button */
  onRetry?: () => void;
  /** Additional CSS class names */
  className?: string;
}

export function ImageDropzone({
  onFileDrop,
  maxSize = UPLOAD_CONSTRAINTS.image.maxSize,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  disabled = false,
  error,
  onRetry,
  className,
}: ImageDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setIsDragging(false);
      if (acceptedFiles.length > 0 && acceptedFiles[0]) {
        onFileDrop(acceptedFiles[0]);
      }
    },
    [onFileDrop],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: acceptedTypes.reduce(
        (acc, type) => ({ ...acc, [type]: [] }),
        {} as Record<string, string[]>,
      ),
      maxSize,
      maxFiles: 1,
      multiple: false,
      disabled,
      onDragEnter: () => setIsDragging(true),
      onDragLeave: () => setIsDragging(false),
    });

  const hasError = Boolean(error) || isDragReject;

  return (
    <div
      {...getRootProps({
        className: cn(
          'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors duration-200',
          'min-h-[200px] cursor-pointer',
          'bg-muted/30 hover:bg-muted/50',
          isDragActive && !isDragReject && 'border-primary bg-primary/10',
          hasError && 'border-destructive bg-destructive/10',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled &&
            !hasError &&
            'border-muted-foreground/25 hover:border-primary',
          className,
        ),
      })}
      role="button"
      aria-label="Drop zone for image upload"
      aria-describedby="dropzone-description"
      tabIndex={disabled ? -1 : 0}
      data-test="image-dropzone"
    >
      <input
        {...getInputProps()}
        aria-label="File input"
        data-test="image-dropzone-input"
      />

      <div className="flex flex-col items-center gap-3 text-center">
        {hasError ? (
          <AlertCircle
            className="h-10 w-10 text-destructive"
            aria-hidden="true"
          />
        ) : isDragActive || isDragging ? (
          <Upload
            className="h-10 w-10 animate-bounce text-primary"
            aria-hidden="true"
          />
        ) : (
          <ImageIcon
            className="h-10 w-10 text-muted-foreground"
            aria-hidden="true"
          />
        )}

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {isDragActive
              ? 'Drop image here'
              : 'Drag and drop an image, or click to browse'}
          </p>
          <p
            id="dropzone-description"
            className="text-xs text-muted-foreground"
          >
            PNG, JPG, JPEG, or WebP up to {formatFileSize(maxSize)}
          </p>
        </div>

        {error && (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                data-test="image-dropzone-retry"
              >
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
