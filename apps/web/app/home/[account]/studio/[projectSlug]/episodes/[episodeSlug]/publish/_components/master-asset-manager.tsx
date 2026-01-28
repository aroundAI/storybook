'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Asset, AssetType } from '@kit/assets';
import { checkAssetHashAction, createAssetAction, getAssetAction } from '@kit/assets/mutations';
import { updateEpisodeAction } from '@kit/episodes/server';
import { calculateFileHash } from '@kit/shared/utils';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
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
} from '@kit/ui/dialog';
import { Separator } from '@kit/ui/separator';
import { toast } from '@kit/ui/sonner';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Clock,
    Database,
    FileText,
    Loader2,
    Trash2,
    Upload,
    X,
    FileVideo,
    AlertTriangle,
} from 'lucide-react';

import { uploadWithPresignedUrl } from '~/lib/presigned-upload';

interface MasterAssetManagerProps {
    projectId: string;
    episodeId: string;
    masterVideoAssetId?: string | null;
    masterTitleCardAssetId?: string | null;
    onUpdate?: () => void;
}

export function MasterAssetManager({
    projectId,
    episodeId,
    masterVideoAssetId,
    masterTitleCardAssetId,
    onUpdate,
}: MasterAssetManagerProps) {
    return (
        <div className="space-y-6">
            <MasterAssetSection
                type="master_video"
                title="Master Video"
                description="Upload the clean, subtitle-free master video file for record keeping."
                projectId={projectId}
                episodeId={episodeId}
                currentAssetId={masterVideoAssetId}
                onUpdate={onUpdate}
            />
            <Separator />
            <MasterAssetSection
                type="master_title_card"
                title="Master Title Card"
                description="Upload the master title card source file (video or image)."
                projectId={projectId}
                episodeId={episodeId}
                currentAssetId={masterTitleCardAssetId}
                onUpdate={onUpdate}
            />
        </div>
    );
}

interface MasterAssetSectionProps {
    type: AssetType;
    title: string;
    description: string;
    projectId: string;
    episodeId: string;
    currentAssetId?: string | null;
    onUpdate?: () => void;
}

function MasterAssetSection({
    type,
    title,
    description,
    projectId,
    episodeId,
    currentAssetId,
    onUpdate,
}: MasterAssetSectionProps) {
    const [asset, setAsset] = useState<Asset | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [duplicateAssetId, setDuplicateAssetId] = useState<string | null>(null);
    const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
    const [progress, setProgress] = useState(0);

    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // Load asset details if ID exists
    useEffect(() => {
        if (currentAssetId) {
            setIsLoading(true);
            getAssetAction({ assetId: currentAssetId })
                .then((result) => {
                    if (result.success && result.data) {
                        setAsset(result.data as Asset);
                    }
                })
                .catch(console.error)
                .finally(() => setIsLoading(false));
        } else {
            setAsset(null);
        }
    }, [currentAssetId]);

    const handleLinkAsset = async (assetId: string) => {
        startTransition(async () => {
            try {
                const updateData: any = {
                    id: episodeId,
                    projectId,
                };

                if (type === 'master_video') {
                    updateData.masterVideoAssetId = assetId;
                } else if (type === 'master_title_card') {
                    updateData.masterTitleCardAssetId = assetId;
                }

                const result = await updateEpisodeAction(updateData);

                if (result.success) {
                    toast.success('Master asset linked successfully');
                    setDuplicateDialogOpen(false);
                    setDuplicateAssetId(null);
                    onUpdate?.();
                    router.refresh();
                } else {
                    toast.error('Failed to link asset');
                }
            } catch (error) {
                console.error('Failed to link asset:', error);
                toast.error('An error occurred while linking');
            }
        });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset state
        setDuplicateAssetId(null);
        setProgress(0);
        setIsUploading(true);

        try {
            // 1. Calculate Hash
            setProgress(10);
            const fileHash = await calculateFileHash(file);

            // 2. Check for duplicates
            setProgress(20);
            const duplicateCheck = await checkAssetHashAction({
                projectId,
                fileHash,
                type,
            });

            if (duplicateCheck.success && duplicateCheck.data) {
                setIsUploading(false);
                setDuplicateAssetId(duplicateCheck.data.id);
                setDuplicateDialogOpen(true);
                return;
            }

            // 3. Upload to R2
            setProgress(30);
            const ext = file.name.split('.').pop() || 'bin';
            const timestamp = Date.now();
            const storagePath = `projects/${projectId}/assets/${type}/${timestamp}-${file.name}`;

            // We use 'project-assets' bucket
            const uploadResult = await uploadWithPresignedUrl(
                file,
                'project-assets',
                storagePath
            );

            setProgress(80);

            // 4. Create Asset Record
            const createResult = await createAssetAction({
                projectId,
                name: file.name,
                type,
                fileUrl: uploadResult.url,
                fileHash,
                fileSizeBytes: file.size,
                contentType: file.type,
            });

            if (!createResult.success) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                throw new Error((createResult as any).error || 'Failed to create asset record');
            }

            if (!createResult.data) {
                throw new Error('Failed to create asset record');
            }

            setProgress(90);

            // 5. Link to Episode
            await handleLinkAsset(createResult.data.id);

            setProgress(100);

        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload master asset');
            // Reset input
            e.target.value = '';
        } finally {
            setIsUploading(false);
        }
    };

    const handleRemoveLink = async () => {
        startTransition(async () => {
            try {
                const updateData: any = {
                    id: episodeId,
                    projectId,
                };

                if (type === 'master_video') {
                    updateData.masterVideoAssetId = null;
                } else if (type === 'master_title_card') {
                    updateData.masterTitleCardAssetId = null;
                }

                const result = await updateEpisodeAction(updateData);

                if (result.success) {
                    toast.success('Asset unlinked');
                    setAsset(null);
                    onUpdate?.();
                    router.refresh();
                } else {
                    toast.error('Failed to unlink asset');
                }
            } catch (error) {
                console.error('Unlink failed:', error);
                toast.error('Failed to unlink asset');
            }
        });
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center justify-center p-4">
                        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
                    </div>
                ) : asset ? (
                    <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            <div>
                                <p className="font-medium text-sm">{asset.name}</p>
                                <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                                    <div className="flex items-center gap-1">
                                        <FileText className="h-4 w-4" />
                                        {asset.contentType}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Database className="h-4 w-4" />
                                        {((asset.fileSizeBytes || 0) / 1024 / 1024).toFixed(2)} MB
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-4 w-4" />
                                        Uploaded {new Date(asset.createdAt).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            asChild
                        >
                            <a href={asset.fileUrl || '#'} target="_blank" rel="noopener noreferrer">
                                <FileText className="h-4 w-4" />
                            </a>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleRemoveLink} disabled={isPending}>
                            Unlink
                        </Button>
                    </div>
                ) : (
                    <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-4 hover:bg-muted/50 transition-colors">
                        {isUploading ? (
                            <div className="text-center w-full max-w-xs">
                                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                                <p className="text-sm font-medium">Uploading & Hashing...</p>
                                <div className="w-full bg-secondary h-1.5 mt-2 rounded-full overflow-hidden">
                                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="p-3 bg-muted rounded-full">
                                    <FileVideo className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-medium">Click to upload {title}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        SHA-256 deduplication enabled
                                    </p>
                                </div>
                                <div className="relative">
                                    <input
                                        type="file"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        onChange={handleFileUpload}
                                        accept="video/*,image/*"
                                        disabled={isPending}
                                    />
                                    <Button variant="outline" size="sm">
                                        <Upload className="h-4 w-4 mr-2" />
                                        Select File
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Duplicate Asset Found</DialogTitle>
                            <DialogDescription>
                                An idenitical file already exists in your project. We can link to the existing master asset instead of re-uploading, saving storage space.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex items-center gap-3 p-4 border rounded bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-900/50">
                            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                            <div className="text-sm text-yellow-800 dark:text-yellow-200">
                                Hash Match: Strict binary identity verified.
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>Cancel</Button>
                            <Button onClick={() => duplicateAssetId && handleLinkAsset(duplicateAssetId)}>
                                Link Existing
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card >
    );
}
