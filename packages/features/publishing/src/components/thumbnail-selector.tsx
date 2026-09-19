'use client';

import { useCallback, useRef, useState } from 'react';

import { ImageIcon, Upload, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Label } from '@kit/ui/label';

import type { ThumbnailSelectorProps } from '../lib/types';

export function ThumbnailSelector({
  currentUrl,
  videoUrl: _videoUrl,
  onChange,
}: ThumbnailSelectorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        return;
      }

      setIsUploading(true);

      try {
        // In production, this would upload to storage
        // For now, create a local URL
        const localUrl = URL.createObjectURL(file);
        onChange(localUrl);
      } finally {
        setIsUploading(false);
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onChange],
  );

  const handleRemove = useCallback(() => {
    onChange('');
  }, [onChange]);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-2">
      <Label>Thumbnail</Label>

      <div className="flex gap-3">
        {/* Thumbnail Preview */}
        <div className="relative aspect-video w-32 overflow-hidden rounded-lg border bg-muted">
          {currentUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentUrl}
                alt="Thumbnail preview"
                className="h-full w-full object-cover"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={handleRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Upload Actions */}
        <div className="flex flex-col justify-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <Button
            variant="outline"
            size="sm"
            onClick={triggerFileInput}
            disabled={isUploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>

          <p className="text-xs text-muted-foreground">
            Recommended: 1280x720 (16:9)
          </p>
        </div>
      </div>
    </div>
  );
}
