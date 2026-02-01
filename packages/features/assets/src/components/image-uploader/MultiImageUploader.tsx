'use client';

import { useState } from 'react';
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
                        <div key={`${url}-${index}`} className="group relative aspect-video overflow-hidden rounded-md border bg-muted">
                            {/* Image */}
                            <img
                                src={url}
                                alt={`Reference ${index + 1}`}
                                className="h-full w-full object-cover"
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
            <div className={images.length > 0 ? "w-full md:w-64" : "w-full"}>
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
                    <p className="mt-2 text-xs text-muted-foreground">
                        Upload additional reference images.
                    </p>
                )}
            </div>

            {/* Preview Modal */}
            <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
                <DialogContent className="max-w-4xl p-0 overflow-hidden bg-transparent border-none shadow-none">
                    <DialogTitle className="sr-only">Image Preview</DialogTitle>
                    <div className="relative flex items-center justify-center w-full h-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={previewImage || ''}
                            alt="Preview"
                            className="max-h-[85vh] max-w-[85vw] object-contain rounded-md shadow-2xl"
                        />
                        <Button
                            className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full"
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
