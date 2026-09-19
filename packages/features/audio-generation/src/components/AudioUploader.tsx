'use client';

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';

import { Music, Trash2, Upload, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

const ACCEPTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
];
const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DURATION_PER_SAMPLE = 300; // 5 minutes

export interface AudioSample {
  id: string;
  file: File;
  url: string;
  duration: number;
  isUploading: boolean;
  uploadProgress: number;
  error?: string;
}

export interface AudioUploaderProps {
  value: AudioSample[];
  onChange: (samples: AudioSample[]) => void;
  maxSamples?: number;
  minTotalDuration?: number;
  onUpload?: (file: File) => Promise<string>;
  className?: string;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error('Failed to load audio metadata'));
    };

    audio.src = URL.createObjectURL(file);
  });
}

export function AudioUploader({
  value,
  onChange,
  maxSamples = 25,
  minTotalDuration = 60,
  onUpload,
  className,
  disabled = false,
}: AudioUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const totalDuration = value.reduce(
    (sum, sample) => sum + (sample.duration || 0),
    0,
  );
  const durationProgress = Math.min(
    (totalDuration / minTotalDuration) * 100,
    100,
  );
  const canAddMore = value.length < maxSamples && !disabled;

  const validateFile = useCallback((file: File): string | null => {
    if (!ACCEPTED_AUDIO_TYPES.includes(file.type)) {
      return `Invalid file type. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File too large. Maximum size is 50MB.';
    }
    return null;
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (disabled) return;

      const fileArray = Array.from(files);
      const availableSlots = maxSamples - value.length;
      const filesToProcess = fileArray.slice(0, availableSlots);

      const newSamples: AudioSample[] = [];

      for (const file of filesToProcess) {
        const error = validateFile(file);
        const id = generateId();

        if (error) {
          newSamples.push({
            id,
            file,
            url: '',
            duration: 0,
            isUploading: false,
            uploadProgress: 0,
            error,
          });
          continue;
        }

        try {
          const duration = await getAudioDuration(file);

          if (duration > MAX_DURATION_PER_SAMPLE) {
            newSamples.push({
              id,
              file,
              url: '',
              duration,
              isUploading: false,
              uploadProgress: 0,
              error: `Audio too long. Maximum ${MAX_DURATION_PER_SAMPLE / 60} minutes per sample.`,
            });
            continue;
          }

          const sample: AudioSample = {
            id,
            file,
            url: '',
            duration,
            isUploading: !!onUpload,
            uploadProgress: 0,
          };

          newSamples.push(sample);

          // Upload if handler provided
          if (onUpload) {
            onChange([...value, ...newSamples]);
            try {
              const uploadedUrl = await onUpload(file);
              sample.url = uploadedUrl;
              sample.isUploading = false;
              sample.uploadProgress = 100;
            } catch (uploadError) {
              sample.error =
                uploadError instanceof Error
                  ? uploadError.message
                  : 'Upload failed';
              sample.isUploading = false;
            }
            onChange([...value, ...newSamples]);
            return;
          } else {
            // Create local URL for preview
            sample.url = URL.createObjectURL(file);
          }
        } catch {
          newSamples.push({
            id,
            file,
            url: '',
            duration: 0,
            isUploading: false,
            uploadProgress: 0,
            error: 'Failed to read audio file',
          });
        }
      }

      onChange([...value, ...newSamples]);
    },
    [disabled, maxSamples, value, validateFile, onUpload, onChange],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!disabled && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [disabled, handleFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
        e.target.value = '';
      }
    },
    [handleFiles],
  );

  const handleRemoveSample = useCallback(
    (id: string) => {
      const sample = value.find((s) => s.id === id);
      if (sample?.url && sample.url.startsWith('blob:')) {
        URL.revokeObjectURL(sample.url);
      }
      onChange(value.filter((s) => s.id !== id));
    },
    [value, onChange],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className={cn('space-y-4', className)} data-test="audio-uploader">
      {/* Drop zone */}
      <div
        className={cn(
          'relative rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          isDragOver && 'border-primary bg-primary/5',
          !isDragOver && 'border-muted-foreground/25 hover:border-primary/50',
          disabled && 'cursor-not-allowed opacity-50',
          !canAddMore && 'pointer-events-none opacity-50',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_AUDIO_TYPES.join(',')}
          multiple
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled || !canAddMore}
        />

        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Drop audio files here or{' '}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={handleBrowseClick}
                disabled={disabled || !canAddMore}
              >
                browse
              </Button>
            </p>
            <p className="text-xs text-muted-foreground">
              {ACCEPTED_EXTENSIONS.join(', ')} up to 50MB each (max {maxSamples}{' '}
              files)
            </p>
          </div>
        </div>
      </div>

      {/* Duration progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total audio duration</span>
          <span
            className={cn(
              'font-medium',
              totalDuration >= minTotalDuration
                ? 'text-green-600'
                : 'text-amber-600',
            )}
          >
            {formatDuration(totalDuration)} / {formatDuration(minTotalDuration)}{' '}
            minimum
          </span>
        </div>
        <Progress value={durationProgress} className="h-2" />
      </div>

      {/* Sample list */}
      {value.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {value.length} sample{value.length !== 1 ? 's' : ''} added
          </p>
          <div className="divide-y rounded-lg border">
            {value.map((sample) => (
              <div
                key={sample.id}
                className="flex items-center gap-3 p-3"
                data-test="audio-sample-item"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                  <Music className="h-5 w-5 text-muted-foreground" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {sample.file.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatDuration(sample.duration)}
                    </span>
                    {sample.isUploading && (
                      <span className="text-primary">
                        Uploading... {sample.uploadProgress}%
                      </span>
                    )}
                    {sample.error && (
                      <span className="text-destructive">{sample.error}</span>
                    )}
                    {!sample.isUploading && !sample.error && sample.url && (
                      <span className="text-green-600">Ready</span>
                    )}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveSample(sample.id)}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {sample.error ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

AudioUploader.displayName = 'AudioUploader';
