'use client';

import { useState } from 'react';

import Image from 'next/image';

import { X, ZoomIn } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@kit/ui/dialog';

import { ImageUploader } from './ImageUploader';

interface MultiImageUploaderProps {
  images: string[];
  onImagesChange: (images: string[]) => void;
  projectId: string;
  assetId?: string;
  disabled?: boolean;
}

export function MultiImageUploader({
  images,
  onImagesChange,
  projectId,
  assetId,
  disabled,
}: MultiImageUploaderProps) {
  // Key to force re-mount of ImageUploader after successful upload
  // This effectively "resets" it to show the dropzone again
  const [uploaderKey, setUploaderKey] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleRemove = (indexToRemove: number) => {
    const newImages = images.filter((_, index) => index !== indexToRemove);
    onImagesChange(newImages);
  };

  const handleUploadComplete = (url: string) => {
    onImagesChange([...images, url]);
    // Reset uploader for next image
    setUploaderKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-4">
      {/* Image Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className="bg-muted group relative aspect-video overflow-hidden rounded-md border"
            >
              {/* Image */}
              <Image
                src={url}
                alt={`Reference ${index + 1}`}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                className="object-cover"
              />

              {/* Overlay with Actions */}
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPreviewImage(url)}
                >
                  <ZoomIn className="h-4 w-4" />
                  <span className="sr-only">Zoom image</span>
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleRemove(index)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Remove image</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploader for New Image */}
      <div className={images.length > 0 ? 'w-full md:w-64' : 'w-full'}>
        <ImageUploader
          key={uploaderKey}
          projectId={projectId}
          assetType="location"
          assetId={assetId}
          onUploadComplete={(url) => handleUploadComplete(url)}
          disabled={disabled}
          className="h-32 w-full"
        />
        {images.length > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            Upload additional reference images.
          </p>
        )}
      </div>

      {/* Preview Modal */}
      <Dialog
        open={!!previewImage}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      >
        <DialogContent className="max-w-4xl overflow-hidden border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          <div className="relative flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage || ''}
              alt="Preview"
              className="max-h-[85vh] max-w-[85vw] rounded-md object-contain shadow-2xl"
            />
            <Button
              className="absolute right-2 top-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              size="icon"
              variant="ghost"
              onClick={() => setPreviewImage(null)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close preview</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
