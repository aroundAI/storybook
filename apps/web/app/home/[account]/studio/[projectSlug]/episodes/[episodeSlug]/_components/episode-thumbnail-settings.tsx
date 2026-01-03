'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { Check, ImageIcon, Loader2, Plus, Star, Trash2, Upload } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@kit/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';

import {
    deleteEpisodeThumbnailAction,
    type EpisodeThumbnail,
    getEpisodeThumbnailsAction,
    setDefaultThumbnailAction,
    uploadEpisodeThumbnailAction,
} from '@kit/episodes/server';
import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';

// ============================================================================
// Types
// ============================================================================

interface EpisodeThumbnailSettingsProps {
    episodeId: string;
}

// ============================================================================
// Main Component
// ============================================================================

export function EpisodeThumbnailSettings({ episodeId }: EpisodeThumbnailSettingsProps) {
    const [thumbnails, setThumbnails] = useState<EpisodeThumbnail[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

    // Load thumbnails on mount
    useEffect(() => {
        async function loadThumbnails() {
            try {
                const result = await getEpisodeThumbnailsAction({ episodeId });
                if (result.success && result.thumbnails) {
                    setThumbnails(result.thumbnails);
                }
            } catch (error) {
                console.error('Failed to load thumbnails:', error);
                toast.error('Failed to load thumbnails');
            } finally {
                setIsLoading(false);
            }
        }

        void loadThumbnails();
    }, [episodeId]);

    const handleThumbnailAdded = useCallback((newThumbnail: EpisodeThumbnail) => {
        setThumbnails((prev) => {
            // Replace existing thumbnail for same language or add new
            const filtered = prev.filter((t) => t.language !== newThumbnail.language);
            return [...filtered, newThumbnail].sort((a, b) =>
                a.language.localeCompare(b.language),
            );
        });
        setIsAddDialogOpen(false);
    }, []);

    const handleThumbnailDeleted = useCallback((deletedId: string) => {
        setThumbnails((prev) => prev.filter((t) => t.id !== deletedId));
    }, []);

    const handleDefaultSet = useCallback((thumbnailId: string) => {
        setThumbnails((prev) =>
            prev.map((t) => ({
                ...t,
                isDefault: t.id === thumbnailId,
            })),
        );
    }, []);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Episode Thumbnails</CardTitle>
                    <CardDescription>Loading thumbnails...</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Episode Thumbnails</CardTitle>
                        <CardDescription>
                            Upload different thumbnails for each language. These will be
                            automatically used when publishing to match the video language.
                        </CardDescription>
                    </div>
                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                                <Plus className="mr-2 h-4 w-4" />
                                Add Thumbnail
                            </Button>
                        </DialogTrigger>
                        <AddThumbnailDialog
                            episodeId={episodeId}
                            existingLanguages={thumbnails.map((t) => t.language)}
                            onSuccess={handleThumbnailAdded}
                            onClose={() => setIsAddDialogOpen(false)}
                        />
                    </Dialog>
                </div>
            </CardHeader>
            <CardContent>
                {thumbnails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            No thumbnails uploaded yet. Click &quot;Add Thumbnail&quot; to upload
                            your first one.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {thumbnails.map((thumbnail) => (
                            <ThumbnailCard
                                key={thumbnail.id}
                                thumbnail={thumbnail}
                                episodeId={episodeId}
                                onDeleted={handleThumbnailDeleted}
                                onReplaced={handleThumbnailAdded}
                                onDefaultSet={handleDefaultSet}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================================================
// Thumbnail Card Component
// ============================================================================

interface ThumbnailCardProps {
    thumbnail: EpisodeThumbnail;
    episodeId: string;
    onDeleted: (id: string) => void;
    onReplaced: (thumbnail: EpisodeThumbnail) => void;
    onDefaultSet: (id: string) => void;
}

function ThumbnailCard({
    thumbnail,
    episodeId,
    onDeleted,
    onReplaced,
    onDefaultSet,
}: ThumbnailCardProps) {
    const [isDeleting, startDeleteTransition] = useTransition();
    const [isSettingDefault, startDefaultTransition] = useTransition();
    const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);

    const handleDelete = () => {
        startDeleteTransition(async () => {
            try {
                const result = await deleteEpisodeThumbnailAction({
                    thumbnailId: thumbnail.id,
                    episodeId,
                });

                if (result.success) {
                    toast.success(`Deleted ${thumbnail.languageLabel || thumbnail.language} thumbnail`);
                    onDeleted(thumbnail.id);
                } else {
                    toast.error(result.error || 'Failed to delete thumbnail');
                }
            } catch (error) {
                console.error('Delete failed:', error);
                toast.error('Failed to delete thumbnail');
            }
        });
    };

    const handleSetDefault = () => {
        if (thumbnail.isDefault) return;

        startDefaultTransition(async () => {
            try {
                const result = await setDefaultThumbnailAction({
                    thumbnailId: thumbnail.id,
                    episodeId,
                });

                if (result.success) {
                    toast.success(`Set ${thumbnail.languageLabel || thumbnail.language} as default`);
                    onDefaultSet(thumbnail.id);
                } else {
                    toast.error(result.error || 'Failed to set default');
                }
            } catch (error) {
                console.error('Set default failed:', error);
                toast.error('Failed to set default');
            }
        });
    };

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return null;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="group relative overflow-hidden rounded-lg border">
            {/* Thumbnail Preview */}
            <div className="aspect-video w-full overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={thumbnail.thumbnailUrl}
                    alt={`${thumbnail.languageLabel || thumbnail.language} thumbnail`}
                    className="h-full w-full object-cover"
                />
            </div>

            {/* Default Badge */}
            {thumbnail.isDefault && (
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                    <Star className="h-3 w-3" />
                    Default
                </div>
            )}

            {/* Overlay Actions */}
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Dialog open={isReplaceDialogOpen} onOpenChange={setIsReplaceDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                            <Upload className="mr-1 h-3 w-3" />
                            Replace
                        </Button>
                    </DialogTrigger>
                    <AddThumbnailDialog
                        episodeId={episodeId}
                        existingLanguages={[]}
                        prefillLanguage={thumbnail.language}
                        prefillLabel={thumbnail.languageLabel || undefined}
                        onSuccess={(newThumbnail) => {
                            onReplaced(newThumbnail);
                            setIsReplaceDialogOpen(false);
                        }}
                        onClose={() => setIsReplaceDialogOpen(false)}
                    />
                </Dialog>
                {!thumbnail.isDefault && (
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleSetDefault}
                        disabled={isSettingDefault}
                    >
                        {isSettingDefault ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <>
                                <Check className="mr-1 h-3 w-3" />
                                Default
                            </>
                        )}
                    </Button>
                )}
                <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    {isDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Trash2 className="h-3 w-3" />
                    )}
                </Button>
            </div>

            {/* Info */}
            <div className="p-3">
                <h4 className="font-medium">
                    {thumbnail.languageLabel || thumbnail.language}
                    <span className="ml-2 text-xs text-muted-foreground">
                        ({thumbnail.language})
                    </span>
                </h4>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {thumbnail.width && thumbnail.height && (
                        <span>{thumbnail.width}×{thumbnail.height}</span>
                    )}
                    {thumbnail.fileSizeBytes && (
                        <span>{formatFileSize(thumbnail.fileSizeBytes)}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Add Thumbnail Dialog Component
// ============================================================================

interface AddThumbnailDialogProps {
    episodeId: string;
    existingLanguages: string[];
    prefillLanguage?: string;
    prefillLabel?: string;
    onSuccess: (thumbnail: EpisodeThumbnail) => void;
    onClose: () => void;
}

function AddThumbnailDialog({
    episodeId,
    existingLanguages,
    prefillLanguage,
    prefillLabel,
    onSuccess,
    onClose,
}: AddThumbnailDialogProps) {
    const [language, setLanguage] = useState(prefillLanguage || '');
    const [languageLabel, setLanguageLabel] = useState(prefillLabel || '');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

    const isReplacing = !!prefillLanguage;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                toast.error('Please select an image file');
                return;
            }
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                toast.error('File size must be less than 5MB');
                return;
            }
            setSelectedFile(file);

            // Create preview
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);

            // Get dimensions
            const img = new Image();
            img.onload = () => {
                setImageDimensions({ width: img.width, height: img.height });
            };
            img.src = url;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!language.trim()) {
            toast.error('Please enter a language code');
            return;
        }

        if (!selectedFile) {
            toast.error('Please select an image file');
            return;
        }

        // Check if language already exists (unless replacing)
        if (!isReplacing && existingLanguages.includes(language.toLowerCase())) {
            toast.error(
                `A thumbnail for "${language}" already exists. Use "Replace" to update it.`,
            );
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);

        try {
            // 1. Upload file to Supabase Storage
            const client = getSupabaseBrowserClient();
            const timestamp = Date.now();
            const ext = selectedFile.name.split('.').pop() || 'jpg';
            const storagePath = `episodes/${episodeId}/thumbnails/${language.toLowerCase()}-${timestamp}.${ext}`;

            setUploadProgress(30);

            const { data: uploadData, error: uploadError } = await client.storage
                .from('project-assets')
                .upload(storagePath, selectedFile, {
                    contentType: selectedFile.type,
                    upsert: true,
                });

            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }

            setUploadProgress(70);

            // Get public URL
            const { data: urlData } = client.storage
                .from('project-assets')
                .getPublicUrl(uploadData.path);

            // 2. Save to database
            const result = await uploadEpisodeThumbnailAction({
                episodeId,
                language: language.toLowerCase(),
                languageLabel: languageLabel.trim() || undefined,
                thumbnailUrl: urlData.publicUrl,
                fileName: selectedFile.name,
                fileSizeBytes: selectedFile.size,
                mimeType: selectedFile.type,
                width: imageDimensions?.width,
                height: imageDimensions?.height,
            });

            setUploadProgress(100);

            if (result.success && result.thumbnail) {
                toast.success(
                    isReplacing
                        ? `Replaced ${languageLabel || language} thumbnail`
                        : `Added ${languageLabel || language} thumbnail`,
                );
                onSuccess(result.thumbnail);
            } else {
                toast.error(result.error || 'Failed to save thumbnail');
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload thumbnail');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    // Cleanup preview URL
    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    return (
        <DialogContent>
            <form onSubmit={handleSubmit}>
                <DialogHeader>
                    <DialogTitle>
                        {isReplacing ? 'Replace Thumbnail' : 'Add Thumbnail'}
                    </DialogTitle>
                    <DialogDescription>
                        {isReplacing
                            ? 'Upload a new image to replace the current thumbnail.'
                            : 'Upload a thumbnail for a specific language. Recommended: 1280×720 (16:9) for YouTube.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Language Code */}
                    <div className="grid gap-2">
                        <Label htmlFor="language">Language Code</Label>
                        <Input
                            id="language"
                            placeholder="e.g., en, hi, es, it"
                            value={language}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLanguage(e.target.value)}
                            disabled={isReplacing}
                            maxLength={10}
                        />
                        <p className="text-xs text-muted-foreground">
                            Use ISO 639-1 codes (en, hi, es) or custom codes
                        </p>
                    </div>

                    {/* Language Label */}
                    <div className="grid gap-2">
                        <Label htmlFor="label">Display Name (Optional)</Label>
                        <Input
                            id="label"
                            placeholder="e.g., English, Hindi, Italian"
                            value={languageLabel}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLanguageLabel(e.target.value)}
                            maxLength={100}
                        />
                    </div>

                    {/* File Upload */}
                    <div className="grid gap-2">
                        <Label htmlFor="image">Thumbnail Image</Label>
                        <Input
                            id="image"
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            disabled={isUploading}
                        />
                        <p className="text-xs text-muted-foreground">
                            Recommended: 1280×720 (16:9). Max 5MB. PNG/JPG/WebP.
                        </p>
                    </div>

                    {/* Preview */}
                    {previewUrl && (
                        <div className="space-y-2">
                            <Label>Preview</Label>
                            <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={previewUrl}
                                    alt="Thumbnail preview"
                                    className="h-full w-full object-contain"
                                />
                            </div>
                            {imageDimensions && (
                                <p className="text-xs text-muted-foreground">
                                    {imageDimensions.width}×{imageDimensions.height} • {(selectedFile!.size / 1024).toFixed(1)} KB
                                </p>
                            )}
                        </div>
                    )}

                    {/* Upload Progress */}
                    {isUploading && (
                        <div className="space-y-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                            <p className="text-center text-xs text-muted-foreground">
                                Uploading... {uploadProgress}%
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={isUploading}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isUploading || !selectedFile || !language}>
                        {isUploading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Uploading...
                            </>
                        ) : isReplacing ? (
                            'Replace Thumbnail'
                        ) : (
                            'Add Thumbnail'
                        )}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    );
}
