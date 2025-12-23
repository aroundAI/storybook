/**
 * VideoUploader Component
 *
 * Dropzone component for uploading videos to shots.
 * Supports drag-and-drop, click-to-upload, and progress tracking.
 */

'use client';

import { useCallback, useState } from 'react';

import {
  AlertCircle,
  CheckCircle,
  Film,
  Loader2,
  Upload,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import {
  type VideoInfo,
  type VideoUploadError,
  type VideoUploadState,
  useVideoUpload,
} from '../hooks/use-video-upload';

/**
 * VideoUploader Component
 *
 * Dropzone component for uploading videos to shots.
 * Supports drag-and-drop, click-to-upload, and progress tracking.
 */

interface VideoUploaderProps {
  projectId: string;
  shotId: string;
  onUploadComplete?: (videoUrl: string, thumbnailUrl: string) => void;
  onError?: (error: VideoUploadError) => void;
  className?: string;
  compact?: boolean;
}

export function VideoUploader({
  projectId,
  shotId,
  onUploadComplete,
  onError,
  className,
  compact = false,
}: VideoUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const { state, progress, videoInfo, error, upload, cancel, reset } =
    useVideoUpload({
      projectId,
      shotId,
      onUploadComplete,
      onError,
    });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        await upload(file);
      }
    },
    [upload],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await upload(file);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [upload],
  );

  const handleClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';
    input.onchange = (e) =>
      handleFileSelect(e as unknown as React.ChangeEvent<HTMLInputElement>);
    input.click();
  }, [handleFileSelect]);

  // Render based on state
  if (state === 'success' && videoInfo) {
    return (
      <SuccessState
        videoInfo={videoInfo}
        onReset={reset}
        className={className}
        compact={compact}
      />
    );
  }

  if (state === 'error' && error) {
    return (
      <ErrorState
        error={error}
        onRetry={reset}
        className={className}
        compact={compact}
      />
    );
  }

  if (
    state === 'uploading' ||
    state === 'validating' ||
    state === 'extracting_thumbnail'
  ) {
    return (
      <UploadingState
        state={state}
        progress={progress}
        onCancel={cancel}
        className={className}
        compact={compact}
      />
    );
  }

  // Idle state - show dropzone
  return (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50',
        compact ? 'gap-2 p-4' : 'gap-3 p-6',
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <div
        className={cn(
          'bg-muted text-muted-foreground flex items-center justify-center rounded-full',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        )}
      >
        <Upload className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
      </div>

      <div className="text-center">
        <p className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
          {compact ? 'Upload Video' : 'Drop video here or click to upload'}
        </p>
        <p
          className={cn(
            'text-muted-foreground',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          MP4, WebM, or MOV • Max 500MB
        </p>
      </div>
    </div>
  );
}

function UploadingState({
  state,
  progress,
  onCancel,
  className,
  compact,
}: {
  state: VideoUploadState;
  progress: { percentage: number; loaded: number; total: number };
  onCancel: () => void;
  className?: string;
  compact?: boolean;
}) {
  const getStatusText = () => {
    switch (state) {
      case 'validating':
        return 'Validating video...';
      case 'extracting_thumbnail':
        return 'Extracting thumbnail...';
      case 'uploading':
        return `Uploading... ${progress.percentage}%`;
      default:
        return 'Processing...';
    }
  };

  return (
    <div
      className={cn(
        'bg-muted/30 flex flex-col items-center justify-center rounded-lg border',
        compact ? 'gap-2 p-4' : 'gap-3 p-6',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Loader2
          className={cn(
            'text-primary animate-spin',
            compact ? 'h-5 w-5' : 'h-6 w-6',
          )}
        />
        <span className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
          {getStatusText()}
        </span>
      </div>

      {state === 'uploading' && (
        <div className="w-full max-w-xs">
          <Progress value={progress.percentage} className="h-2" />
          <p className="text-muted-foreground mt-1 text-center text-xs">
            {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
          </p>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="text-muted-foreground"
      >
        Cancel
      </Button>
    </div>
  );
}

function SuccessState({
  videoInfo,
  onReset,
  className,
  compact,
}: {
  videoInfo: VideoInfo;
  onReset: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-green-500/30 bg-green-500/5',
        compact ? 'gap-2 p-4' : 'gap-3 p-6',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
        <span className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
          Video uploaded
        </span>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Film className="h-4 w-4" />
        <span>{videoInfo.name}</span>
        <span>•</span>
        <span>{formatDuration(videoInfo.duration)}</span>
        <span>•</span>
        <span>{formatBytes(videoInfo.size)}</span>
      </div>

      <Button variant="outline" size="sm" onClick={onReset}>
        Replace Video
      </Button>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: VideoUploadError;
  onRetry: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center rounded-lg border',
        compact ? 'gap-2 p-4' : 'gap-3 p-6',
        className,
      )}
    >
      <div className="text-destructive flex items-center gap-2">
        <AlertCircle className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
        <span className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
          Upload failed
        </span>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        {error.message}
      </p>

      <Button variant="outline" size="sm" onClick={onRetry}>
        Try Again
      </Button>
    </div>
  );
}

// Utility functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export type { VideoUploaderProps };
