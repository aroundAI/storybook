/**
 * ImageUploadProgress Component (FILM-207)
 *
 * Displays upload progress with progress bar and cancel option.
 */

'use client';

import { Loader2, X } from 'lucide-react';

import { formatFileSize } from '@kit/assets/upload-validation';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import type { UploadProgress, UploadState } from './types';

/**
 * ImageUploadProgress Component (FILM-207)
 *
 * Displays upload progress with progress bar and cancel option.
 */

/**
 * ImageUploadProgress Component (FILM-207)
 *
 * Displays upload progress with progress bar and cancel option.
 */

/**
 * ImageUploadProgress Component (FILM-207)
 *
 * Displays upload progress with progress bar and cancel option.
 */

/**
 * ImageUploadProgress Component (FILM-207)
 *
 * Displays upload progress with progress bar and cancel option.
 */

interface ImageUploadProgressProps {
  /** Upload progress information */
  progress: UploadProgress;
  /** Current upload state */
  state: UploadState;
  /** Callback to cancel the upload */
  onCancel: () => void;
  /** Additional CSS class names */
  className?: string;
}

export function ImageUploadProgress({
  progress,
  state,
  onCancel,
  className,
}: ImageUploadProgressProps) {
  const isValidating = state === 'validating';
  const isUploading = state === 'uploading';

  return (
    <div
      className={cn(
        'border-primary/50 bg-primary/5 flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-6',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={
        isValidating ? 'Validating file' : `Uploading ${progress.percentage}%`
      }
      data-test="image-upload-progress"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        <Loader2
          className="text-primary h-8 w-8 animate-spin"
          aria-hidden="true"
        />

        <div className="w-full space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium">
              {isValidating ? 'Validating...' : 'Uploading...'}
            </span>
            {isUploading && (
              <span className="text-muted-foreground">
                {progress.percentage}%
              </span>
            )}
          </div>

          {isUploading && (
            <>
              <Progress
                value={progress.percentage}
                className="h-2"
                aria-label={`Upload progress: ${progress.percentage}%`}
              />
              <p className="text-muted-foreground text-center text-xs">
                {formatFileSize(progress.loaded)} of{' '}
                {formatFileSize(progress.total)}
              </p>
            </>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel upload"
          data-test="image-upload-cancel"
        >
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
