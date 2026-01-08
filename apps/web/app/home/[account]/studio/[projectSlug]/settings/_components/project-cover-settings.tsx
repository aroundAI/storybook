'use client';

/**
 * ProjectCoverSettings - Manage project cover image
 * Displays current cover and allows upload of new cover
 */

import { useCallback, useState, useTransition } from 'react';

import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';

import { uploadProjectCover } from '@kit/storage/client';
import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { updateProjectCoverImage } from '../../../projects/new/_lib/server/create-film-project.action';

interface ProjectCoverSettingsProps {
    projectId: string;
    currentCoverUrl?: string | null;
}

export function ProjectCoverSettings({
    projectId,
    currentCoverUrl,
}: ProjectCoverSettingsProps) {
    const [isPending, startTransition] = useTransition();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [currentUrl, setCurrentUrl] = useState<string | null>(currentCoverUrl ?? null);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
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

            // Upload the file
            startTransition(async () => {
                try {
                    // Upload to R2 via presigned URL
                    const uploadResult = await uploadProjectCover(file, projectId);

                    // Update project metadata with new cover URL
                    await updateProjectCoverImage(projectId, uploadResult.url);

                    // Update current URL and clear preview
                    setCurrentUrl(uploadResult.url);
                    setPreviewUrl(null);
                    URL.revokeObjectURL(preview);

                    toast.success('Cover image updated successfully');
                } catch (uploadError) {
                    setError(
                        uploadError instanceof Error
                            ? uploadError.message
                            : 'Failed to upload cover image',
                    );
                    toast.error('Failed to upload cover image');
                    setPreviewUrl(null);
                    URL.revokeObjectURL(preview);
                }
            });
        },
        [projectId],
    );

    const handleRemoveCover = useCallback(() => {
        startTransition(async () => {
            try {
                // Update project metadata to remove cover URL
                await updateProjectCoverImage(projectId, '');

                setCurrentUrl(null);
                setPreviewUrl(null);

                toast.success('Cover image removed');
            } catch {
                toast.error('Failed to remove cover image');
            }
        });
    }, [projectId]);

    const displayUrl = previewUrl || currentUrl;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="h-5 w-5" />
                    Cover Image
                </CardTitle>
                <CardDescription>
                    Upload a cover image for your project. Recommended size: 1920x1080 (16:9 aspect ratio).
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {/* Cover Image Preview / Upload Area */}
                    <label
                        className={cn(
                            'relative flex h-48 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed',
                            'bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden',
                            isPending && 'cursor-wait opacity-70',
                            error && 'border-destructive',
                        )}
                    >
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            disabled={isPending}
                            className="hidden"
                            data-test="cover-image-input"
                        />

                        {displayUrl ? (
                            <div className="relative h-full w-full">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={displayUrl}
                                    alt="Cover preview"
                                    className="h-full w-full rounded-lg object-cover"
                                />
                                {isPending && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-muted-foreground flex flex-col items-center gap-2">
                                {isPending ? (
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                ) : (
                                    <>
                                        <div className="bg-muted rounded-full p-4">
                                            <Upload className="h-8 w-8" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-medium">Click to upload cover image</p>
                                            <p className="text-xs">PNG, JPG, WebP up to 5MB</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </label>

                    {/* Error Message */}
                    {error && <p className="text-destructive text-sm">{error}</p>}

                    {/* Actions */}
                    {currentUrl && !isPending && (
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const input = document.querySelector(
                                        '[data-test="cover-image-input"]',
                                    ) as HTMLInputElement;
                                    input?.click();
                                }}
                            >
                                <Upload className="mr-2 h-4 w-4" />
                                Change Cover
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={handleRemoveCover}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove Cover
                            </Button>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
