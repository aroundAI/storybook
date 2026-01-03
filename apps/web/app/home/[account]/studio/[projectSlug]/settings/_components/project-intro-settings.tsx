'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { Loader2, Plus, Trash2, Upload, Video } from 'lucide-react';

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
    deleteProjectIntroAction,
    getProjectIntrosAction,
    type ProjectIntro,
    uploadProjectIntroAction,
} from '@kit/episodes/server';
import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';

// ============================================================================
// Types
// ============================================================================

interface ProjectIntroSettingsProps {
    projectId: string;
}

// ============================================================================
// Main Component
// ============================================================================

export function ProjectIntroSettings({ projectId }: ProjectIntroSettingsProps) {
    const [intros, setIntros] = useState<ProjectIntro[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

    // Load intros on mount
    useEffect(() => {
        async function loadIntros() {
            try {
                const result = await getProjectIntrosAction({ projectId });
                if (result.success && result.intros) {
                    setIntros(result.intros);
                }
            } catch (error) {
                console.error('Failed to load intros:', error);
                toast.error('Failed to load intro videos');
            } finally {
                setIsLoading(false);
            }
        }

        void loadIntros();
    }, [projectId]);

    const handleIntroAdded = useCallback((newIntro: ProjectIntro) => {
        setIntros((prev) => {
            // Replace existing intro for same language or add new
            const filtered = prev.filter((i) => i.language !== newIntro.language);
            return [...filtered, newIntro].sort((a, b) =>
                a.language.localeCompare(b.language),
            );
        });
        setIsAddDialogOpen(false);
    }, []);

    const handleIntroDeleted = useCallback((deletedId: string) => {
        setIntros((prev) => prev.filter((i) => i.id !== deletedId));
    }, []);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Episode Intros</CardTitle>
                    <CardDescription>
                        Loading intro videos...
                    </CardDescription>
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
                        <CardTitle>Episode Intros</CardTitle>
                        <CardDescription>
                            Add intro videos that will be stitched to the beginning of each
                            episode during rendering. Upload different intros for each
                            language to create fully localized content.
                        </CardDescription>
                    </div>
                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                                <Plus className="mr-2 h-4 w-4" />
                                Add Language
                            </Button>
                        </DialogTrigger>
                        <AddIntroDialog
                            projectId={projectId}
                            existingLanguages={intros.map((i) => i.language)}
                            onSuccess={handleIntroAdded}
                            onClose={() => setIsAddDialogOpen(false)}
                        />
                    </Dialog>
                </div>
            </CardHeader>
            <CardContent>
                {intros.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Video className="mb-4 h-12 w-12 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            No intro videos uploaded yet. Click &quot;Add Language&quot; to upload
                            your first intro.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {intros.map((intro) => (
                            <IntroCard
                                key={intro.id}
                                intro={intro}
                                projectId={projectId}
                                onDeleted={handleIntroDeleted}
                                onReplaced={handleIntroAdded}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================================================
// Intro Card Component
// ============================================================================

interface IntroCardProps {
    intro: ProjectIntro;
    projectId: string;
    onDeleted: (id: string) => void;
    onReplaced: (intro: ProjectIntro) => void;
}

function IntroCard({ intro, projectId, onDeleted, onReplaced }: IntroCardProps) {
    const [isDeleting, startDeleteTransition] = useTransition();
    const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);

    const handleDelete = () => {
        startDeleteTransition(async () => {
            try {
                const result = await deleteProjectIntroAction({
                    introId: intro.id,
                    projectId,
                });

                if (result.success) {
                    toast.success(`Deleted ${intro.languageLabel || intro.language} intro`);
                    onDeleted(intro.id);
                } else {
                    toast.error(result.error || 'Failed to delete intro');
                }
            } catch (error) {
                console.error('Delete failed:', error);
                toast.error('Failed to delete intro');
            }
        });
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return null;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="flex items-center gap-4 rounded-lg border p-4">
            {/* Preview Thumbnail */}
            <div className="relative h-20 w-32 flex-shrink-0 overflow-hidden rounded bg-muted">
                {intro.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={intro.thumbnailUrl}
                        alt={`${intro.languageLabel || intro.language} intro preview`}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <Video className="h-8 w-8 text-muted-foreground" />
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <h4 className="font-medium">
                    {intro.languageLabel || intro.language}
                    <span className="ml-2 text-xs text-muted-foreground">
                        ({intro.language})
                    </span>
                </h4>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                    {intro.fileName && (
                        <span className="truncate max-w-[200px]">{intro.fileName}</span>
                    )}
                    <span className="shrink-0">{formatDuration(intro.durationSeconds)}</span>
                    {intro.fileSizeBytes && (
                        <span className="shrink-0">{formatFileSize(intro.fileSizeBytes)}</span>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <Dialog open={isReplaceDialogOpen} onOpenChange={setIsReplaceDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                            <Upload className="mr-2 h-4 w-4" />
                            Replace
                        </Button>
                    </DialogTrigger>
                    <AddIntroDialog
                        projectId={projectId}
                        existingLanguages={[]}
                        prefillLanguage={intro.language}
                        prefillLabel={intro.languageLabel || undefined}
                        onSuccess={(newIntro) => {
                            onReplaced(newIntro);
                            setIsReplaceDialogOpen(false);
                        }}
                        onClose={() => setIsReplaceDialogOpen(false)}
                    />
                </Dialog>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-destructive hover:text-destructive"
                >
                    {isDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Trash2 className="h-4 w-4" />
                    )}
                </Button>
            </div>
        </div>
    );
}

// ============================================================================
// Add Intro Dialog Component
// ============================================================================

interface AddIntroDialogProps {
    projectId: string;
    existingLanguages: string[];
    prefillLanguage?: string;
    prefillLabel?: string;
    onSuccess: (intro: ProjectIntro) => void;
    onClose: () => void;
}

function AddIntroDialog({
    projectId,
    existingLanguages,
    prefillLanguage,
    prefillLabel,
    onSuccess,
    onClose,
}: AddIntroDialogProps) {
    const [language, setLanguage] = useState(prefillLanguage || '');
    const [languageLabel, setLanguageLabel] = useState(prefillLabel || '');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const isReplacing = !!prefillLanguage;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('video/')) {
                toast.error('Please select a video file');
                return;
            }
            // Validate file size (max 100MB)
            if (file.size > 100 * 1024 * 1024) {
                toast.error('File size must be less than 100MB');
                return;
            }
            setSelectedFile(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!language.trim()) {
            toast.error('Please enter a language code');
            return;
        }

        if (!selectedFile) {
            toast.error('Please select a video file');
            return;
        }

        // Check if language already exists (unless replacing)
        if (!isReplacing && existingLanguages.includes(language.toLowerCase())) {
            toast.error(
                `An intro for "${language}" already exists. Use "Replace" to update it.`,
            );
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);

        try {
            // 1. Upload file to Supabase Storage directly
            const client = getSupabaseBrowserClient();
            const timestamp = Date.now();
            const storagePath = `projects/${projectId}/intros/${language.toLowerCase()}-${timestamp}.mp4`;

            setUploadProgress(20);

            const { data: uploadData, error: uploadError } = await client.storage
                .from('project-assets')
                .upload(storagePath, selectedFile, {
                    contentType: selectedFile.type,
                    upsert: true,
                });

            if (uploadError) {
                throw new Error(`Upload failed: ${uploadError.message}`);
            }

            setUploadProgress(60);

            // Get public URL
            const { data: urlData } = client.storage
                .from('project-assets')
                .getPublicUrl(uploadData.path);

            // 2. Get video duration (using video element)
            const duration = await getVideoDuration(selectedFile);

            if (duration > 60) {
                toast.error('Intro video should be 60 seconds or less');
                // Clean up uploaded file
                await client.storage.from('project-assets').remove([storagePath]);
                return;
            }

            setUploadProgress(80);

            // 3. Save to database
            const result = await uploadProjectIntroAction({
                projectId,
                language: language.toLowerCase(),
                languageLabel: languageLabel.trim() || undefined,
                videoUrl: urlData.publicUrl,
                durationSeconds: duration,
                fileName: selectedFile.name,
                fileSizeBytes: selectedFile.size,
                mimeType: selectedFile.type,
            });

            setUploadProgress(100);

            if (result.success && result.intro) {
                toast.success(
                    isReplacing
                        ? `Replaced ${languageLabel || language} intro`
                        : `Added ${languageLabel || language} intro`,
                );
                onSuccess(result.intro);
            } else {
                toast.error(result.error || 'Failed to save intro');
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload intro video');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    return (
        <DialogContent>
            <form onSubmit={handleSubmit}>
                <DialogHeader>
                    <DialogTitle>
                        {isReplacing ? 'Replace Intro Video' : 'Add Intro Video'}
                    </DialogTitle>
                    <DialogDescription>
                        {isReplacing
                            ? 'Upload a new video to replace the current intro.'
                            : 'Upload an intro video for a specific language. This will be stitched to the beginning of each episode.'}
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
                        <Label htmlFor="video">Intro Video</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="video"
                                type="file"
                                accept="video/*"
                                onChange={handleFileChange}
                                disabled={isUploading}
                            />
                        </div>
                        {selectedFile && (
                            <p className="text-xs text-muted-foreground">
                                Selected: {selectedFile.name} (
                                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Max 60 seconds, 100MB. MP4 recommended.
                        </p>
                    </div>

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
                            'Replace Intro'
                        ) : (
                            'Add Intro'
                        )}
                    </Button>
                </DialogFooter>
            </form>
        </DialogContent>
    );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get video duration using a hidden video element
 */
function getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            resolve(video.duration);
        };

        video.onerror = () => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Failed to load video metadata'));
        };

        video.src = URL.createObjectURL(file);
    });
}
