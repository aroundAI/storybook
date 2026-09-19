'use client';

import { useCallback, useState } from 'react';

import Image from 'next/image';

import { ImageIcon, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface CoverImageUploadProps {
  value?: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

/**
 * CoverImageUpload - Select and preview cover images for projects
 * Only handles file selection - upload happens with form submission
 */
export function CoverImageUpload({
  value: _value,
  onChange,
  disabled,
}: CoverImageUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB');
        return;
      }

      setError(null);

      // Create preview URL
      const preview = URL.createObjectURL(file);
      setPreviewUrl(preview);
      onChange(file);
    },
    [onChange],
  );

  const handleRemove = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    onChange(null);
    setError(null);
  }, [onChange, previewUrl]);

  return (
    <div className="space-y-2">
      {/* Upload Area */}
      <label
        className={cn(
          'relative flex h-48 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed',
          'bg-muted/30 transition-colors hover:bg-muted/50',
          disabled && 'cursor-not-allowed opacity-50',
          error && 'border-destructive',
        )}
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={disabled}
          className="hidden"
          data-test="cover-image-input"
        />

        {previewUrl ? (
          <div className="relative h-full w-full">
            <Image
              src={previewUrl}
              alt="Cover preview"
              fill
              className="rounded-lg object-cover"
              sizes="(max-width: 768px) 100vw, 400px"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8"
              onClick={(e) => {
                e.preventDefault();
                handleRemove();
              }}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="rounded-full bg-muted p-4">
              <ImageIcon className="h-8 w-8" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Click to select cover image</p>
              <p className="text-xs">PNG, JPG, WebP up to 5MB</p>
            </div>
          </div>
        )}
      </label>

      {/* Error Message */}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
