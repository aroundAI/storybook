'use client';

import { useCallback, useState } from 'react';

import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';

import { updateShotAction } from '@kit/episodes/server';
import { refusalMessage } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { uploadWithPresignedUrl } from '~/lib/presigned-upload';

interface FrameUploaderProps {
  projectId: string;
  shotId: string;
  frameType: 'first' | 'last';
  currentUrl?: string | null;
  onUploadComplete: () => void;
}

/**
 * Image uploader component for first/last frame storyboard images.
 * Uploads to R2 Storage using presigned URLs and updates the shot record.
 */
export function FrameUploader({
  projectId,
  shotId,
  frameType,
  currentUrl,
  onUploadComplete,
}: FrameUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Image must be smaller than 10MB');
        return;
      }

      setIsUploading(true);

      try {
        // Generate unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${frameType}-frame-${Date.now()}.${fileExt}`;
        const storagePath = `projects/${projectId}/shots/${shotId}/frames/${fileName}`;

        // Upload to R2 via presigned URL
        const result = await uploadWithPresignedUrl(
          file,
          'project-assets',
          storagePath,
        );

        // Update shot record
        const updateData =
          frameType === 'first'
            ? { shotId, firstFrameUrl: result.url }
            : { shotId, lastFrameUrl: result.url };

        const updateResult = await updateShotAction(updateData);

        if (!updateResult.success) {
          throw new Error('Failed to update shot');
        }

        toast.success(
          `${frameType === 'first' ? 'First' : 'Last'} frame uploaded`,
        );
        onUploadComplete();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to upload image'));
      } finally {
        setIsUploading(false);
        // Reset the input
        event.target.value = '';
      }
    },
    [projectId, shotId, frameType, onUploadComplete],
  );

  const handleRemove = useCallback(async () => {
    setIsUploading(true);

    try {
      const updateData =
        frameType === 'first'
          ? { shotId, firstFrameUrl: '' }
          : { shotId, lastFrameUrl: '' };

      const result = await updateShotAction(updateData);

      if (!result.success) {
        throw new Error('Failed to remove frame');
      }

      toast.success(
        `${frameType === 'first' ? 'First' : 'Last'} frame removed`,
      );
      onUploadComplete();
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to remove frame'));
    } finally {
      setIsUploading(false);
    }
  }, [shotId, frameType, onUploadComplete]);

  if (currentUrl) {
    // Show preview with remove option
    return (
      <div className="space-y-2">
        <div className="group relative overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt={`${frameType === 'first' ? 'First' : 'Last'} frame`}
            className="aspect-video w-full object-cover"
          />
          {/* Overlay on hover */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemove}
              disabled={isUploading}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show upload dropzone
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 transition-colors',
        'border-gray-300 bg-gray-50/50 hover:border-gray-400 hover:bg-gray-100/50',
        'dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-gray-500 dark:hover:bg-gray-700/50',
        isUploading && 'pointer-events-none opacity-50',
      )}
    >
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        disabled={isUploading}
        className="hidden"
        data-test={`frame-upload-input-${frameType}`}
      />
      {isUploading ? (
        <>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <span className="text-xs text-gray-500">Uploading...</span>
        </>
      ) : (
        <>
          <div className="rounded-full bg-gray-200 p-2 dark:bg-gray-700">
            {frameType === 'first' ? (
              <ImageIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            ) : (
              <Upload className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            )}
          </div>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Upload {frameType === 'first' ? 'First' : 'Last'} Frame
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            PNG, JPG up to 10MB
          </span>
        </>
      )}
    </label>
  );
}
