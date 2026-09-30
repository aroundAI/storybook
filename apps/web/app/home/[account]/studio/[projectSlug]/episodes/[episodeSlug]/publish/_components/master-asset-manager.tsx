'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  AlertTriangle,
  Clock,
  Database,
  Eye,
  FileText,
  FileVideo,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';

import { Asset, AssetType } from '@kit/assets';
import {
  checkAssetHashAction,
  createAssetAction,
  deleteAssetAction,
} from '@kit/assets/mutations';
import { updateEpisodeAction } from '@kit/episodes/server';
import { unwrap } from '@kit/next/action-result';
import { calculateFileHash } from '@kit/shared/utils';
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

import { uploadWithPresignedUrl } from '~/lib/presigned-upload';

// EpisodeAsset interface removed in favor of @kit/assets Asset type

interface MasterAssetManagerProps {
  projectId: string;
  episodeId: string;
  masterVideoAsset?: Asset | null;
  titleCards: Asset[];
  version: number;
  onUpdate?: () => void;
}

export function MasterAssetManager({
  projectId,
  episodeId,
  masterVideoAsset,
  titleCards,
  version,
  onUpdate,
}: MasterAssetManagerProps) {
  return (
    <div className="space-y-6">
      <MasterVideoSection
        type="master_video"
        title="Master Video"
        description="Upload the clean, subtitle-free master video file for record keeping."
        projectId={projectId}
        episodeId={episodeId}
        currentAsset={masterVideoAsset}
        version={version}
        onUpdate={onUpdate}
      />
      <Separator />
      <TitleCardsSection
        title="Master Title Cards"
        description="Upload master title card source files (video or image)."
        projectId={projectId}
        episodeId={episodeId}
        titleCards={titleCards}
        onUpdate={onUpdate}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Master Video Section (1:1 Linked via Episode FK)
// ----------------------------------------------------------------------------

interface MasterVideoSectionProps {
  type: AssetType;
  title: string;
  description: string;
  projectId: string;
  episodeId: string;
  currentAsset?: Asset | null;
  version: number;
  onUpdate?: () => void;
}

function MasterVideoSection({
  type,
  title,
  description,
  projectId,
  episodeId,
  currentAsset,
  version,
  onUpdate,
}: MasterVideoSectionProps) {
  // Determine active asset from prop or optimistic state could be handled here,
  // but typically we rely on prop updates from parent.
  const asset = currentAsset;

  // Loading state is now implicit via parent fetch, or local upload
  const [isUploading, setIsUploading] = useState(false);

  // Duplicate handling
  const [duplicateAsset, setDuplicateAsset] = useState<Asset | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);

  const [progress, setProgress] = useState(0);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // No local fetch needed anymore

  const handleReuseAsset = async (existingAsset: Asset) => {
    startTransition(async () => {
      try {
        // 1. Link Existing: Update episode with existing asset ID (shared)
        // OR Create New Asset Row pointing to same file?
        // For Master Video, we can just link the existing asset ID directly
        // because episodes table has the FK.

        const result = await updateEpisodeAction({
          episodeId,
          version,
          masterVideoAssetId: existingAsset.id,
        });

        if (result.success) {
          toast.success('Master video linked successfully');
          setDuplicateDialogOpen(false);
          setDuplicateAsset(null);
          onUpdate?.();
          router.refresh();
        } else {
          toast.error('Failed to link video');
        }
      } catch (error) {
        console.error('Failed to link video:', error);
        toast.error('An error occurred while linking');
      }
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDuplicateAsset(null);
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
        // Found duplicate - ask to reuse
        setIsUploading(false);
        setDuplicateAsset(duplicateCheck.data as Asset);
        setDuplicateDialogOpen(true);
        return;
      }

      // 3. Upload to R2
      setProgress(30);
      const fileUuid = crypto.randomUUID();
      const fileExtension = file.name.split('.').pop() || '';
      const safeStorageName = fileExtension
        ? `${fileUuid}.${fileExtension}`
        : fileUuid;
      const storagePath = `projects/${projectId}/assets/${type}/${safeStorageName}`;

      const uploadResult = await uploadWithPresignedUrl(
        file,
        'project-assets',
        storagePath,
      );

      setProgress(80);

      // 4. Create Asset Record
      const createResult = await unwrap(
        createAssetAction({
          projectId,
          name: file.name,
          type,
          fileUrl: uploadResult.url,
          fileHash,
          fileSizeBytes: file.size,
          contentType: file.type,
          episodeId, // Context
        }),
      );

      if (!createResult.success || !createResult.data) {
        // CLEANUP: If DB insert fails, try to delete the uploaded file to avoid orphans
        // Note: We need a server action to delete by path since we don't have an asset ID
        // For now, we'll just log it. Real implementation needs `deleteFileAction`.
        console.warn('Orphaned file potentially created:', uploadResult.url);
        const errorMsg =
          'error' in createResult && typeof createResult.error === 'string'
            ? createResult.error
            : 'Failed to create asset record';
        throw new Error(errorMsg);
      }

      setProgress(90);

      // 5. Link to Episode
      await updateEpisodeAction({
        episodeId,
        version,
        masterVideoAssetId: createResult.data.id,
      });

      setProgress(100);
      onUpdate?.();
      router.refresh();
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload master video');
      // TODO: Ensure we clean up if we have a path but no DB record
    } finally {
      setIsUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleRemoveLink = async () => {
    startTransition(async () => {
      try {
        const result = await updateEpisodeAction({
          episodeId,
          version,
          masterVideoAssetId: null,
        });

        if (result.success) {
          toast.success('Video unlinked');
          // setAsset(null); // Removed: rely on prop update
          onUpdate?.();
          router.refresh();
        } else {
          toast.error('Failed to unlink video');
        }
      } catch (error) {
        console.error('Unlink failed:', error);
        toast.error('Failed to unlink video');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {asset ? (
          <AssetCard
            asset={asset}
            onRemove={handleRemoveLink}
            isPending={isPending}
          />
        ) : (
          <UploadDropzone
            title={title}
            isUploading={isUploading}
            progress={progress}
            onUpload={handleFileUpload}
            isPending={isPending}
          />
        )}

        <DuplicateDialog
          isOpen={duplicateDialogOpen}
          onOpenChange={setDuplicateDialogOpen}
          onReuse={() => duplicateAsset && handleReuseAsset(duplicateAsset)}
          assetName={duplicateAsset?.name}
          isPending={isPending}
        />
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Title Cards Section (1:N via Asset.episode_id)
// ----------------------------------------------------------------------------

interface TitleCardsSectionProps {
  title: string;
  description: string;
  projectId: string;
  episodeId: string;
  titleCards: Asset[];
  onUpdate?: () => void;
}

function TitleCardsSection({
  title,
  description,
  projectId,
  episodeId,
  titleCards,
  onUpdate,
}: TitleCardsSectionProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Duplicate handling
  const [duplicateAsset, setDuplicateAsset] = useState<Asset | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleReuseAsset = async (existingAsset: Asset) => {
    // Validate existing asset has required data
    if (!existingAsset.fileUrl || !existingAsset.contentType) {
      toast.error('Cannot reuse asset: missing file URL or content type');
      setDuplicateDialogOpen(false);
      setDuplicateAsset(null);
      return;
    }

    startTransition(async () => {
      try {
        // Reuse: Create NEW Asset Row pointing to SAME file (URL/Hash)
        // This ensures the new asset belongs to this episode (episode_id)
        // while sharing the storage file.

        const result = await unwrap(
          createAssetAction({
            projectId,
            name: existingAsset.name,
            type: 'master_title_card',
            fileUrl: existingAsset.fileUrl!, // Validated above
            fileHash: existingAsset.fileHash ?? undefined,
            fileSizeBytes: existingAsset.fileSizeBytes ?? undefined,
            contentType: existingAsset.contentType!, // Validated above
            episodeId, // Critical: Link to current episode
          }),
        );

        if (result.success) {
          toast.success('Title card linked successfully');
          setDuplicateDialogOpen(false);
          setDuplicateAsset(null);
          onUpdate?.();
          router.refresh();
        } else {
          toast.error('Failed to link title card');
        }
      } catch (error) {
        console.error('Failed to link title card:', error);
        toast.error('An error occurred while linking');
      }
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDuplicateAsset(null);
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
        type: 'master_title_card',
      });

      if (duplicateCheck.success && duplicateCheck.data) {
        // Found duplicate - ask to reuse
        setIsUploading(false);
        setDuplicateAsset(duplicateCheck.data as Asset);
        setDuplicateDialogOpen(true);
        return;
      }

      // 3. Upload to R2
      setProgress(30);
      const fileUuid = crypto.randomUUID();
      const fileExtension = file.name.split('.').pop() || '';
      const safeStorageName = fileExtension
        ? `${fileUuid}.${fileExtension}`
        : fileUuid;
      const storagePath = `projects/${projectId}/assets/master_title_card/${safeStorageName}`;

      const uploadResult = await uploadWithPresignedUrl(
        file,
        'project-assets',
        storagePath,
      );

      setProgress(80);

      // 4. Create Asset Record (Auto-linked via episodeId)
      const createResult = await unwrap(
        createAssetAction({
          projectId,
          name: file.name,
          type: 'master_title_card',
          fileUrl: uploadResult.url,
          fileHash,
          fileSizeBytes: file.size,
          contentType: file.type,
          episodeId, // Link!
        }),
      );

      if (!createResult.success || !createResult.data) {
        const errorMsg =
          'error' in createResult && typeof createResult.error === 'string'
            ? createResult.error
            : 'Failed to create asset';
        throw new Error(errorMsg);
      }

      setProgress(100);
      onUpdate?.();
      router.refresh();
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload title card');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (assetId: string) => {
    startTransition(async () => {
      const result = await unwrap(deleteAssetAction({ assetId }));
      if (result.success) {
        toast.success('Title card removed');
        setDeleteConfirmId(null);
        onUpdate?.();
        router.refresh();
      } else {
        toast.error('Failed to remove title card');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* List of Title Cards */}
        {titleCards.map((card) => (
          <AssetCard
            key={card.id}
            asset={card}
            onRemove={() => setDeleteConfirmId(card.id as string)}
            isPending={isPending}
          />
        ))}

        {/* Upload Area */}
        <div className="relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors hover:bg-muted/50">
          {isUploading ? (
            <div className="w-full max-w-xs text-center">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium">Uploading...</p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <input
                type="file"
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                onChange={handleFileUpload}
                aria-label={`Upload ${title}`}
                accept="video/*,image/*"
                disabled={isPending}
              />
              <div className="pointer-events-none flex flex-col items-center">
                <Button variant="ghost" size="sm" className="h-8 gap-2">
                  <Plus className="h-4 w-4" />
                  Add Title Card
                </Button>
              </div>
            </>
          )}
        </div>

        <DuplicateDialog
          isOpen={duplicateDialogOpen}
          onOpenChange={setDuplicateDialogOpen}
          onReuse={() => duplicateAsset && handleReuseAsset(duplicateAsset)}
          assetName={duplicateAsset?.name}
          isPending={isPending}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={!!deleteConfirmId}
          onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove Title Card</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove this title card? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmId(null)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Shared Components
// ----------------------------------------------------------------------------

function AssetCard({
  asset,
  onRemove,
  isPending,
}: {
  asset: Asset;
  onRemove: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-3">
        <div className="rounded-md border bg-background p-2 shadow-sm">
          {asset.contentType?.startsWith('video') ? (
            <FileVideo className="h-5 w-5 text-blue-500" />
          ) : (
            <FileText className="h-5 w-5 text-orange-500" />
          )}
        </div>
        <div>
          <p className="max-w-[200px] truncate text-sm font-medium">
            {asset.name}
          </p>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              {((asset.fileSizeBytes || 0) / 1024 / 1024).toFixed(2)} MB
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(asset.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <a
            href={asset.fileUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Eye className="h-4 w-4" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          disabled={isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function UploadDropzone({
  title,
  isUploading,
  progress,
  onUpload,
  isPending,
}: {
  title: string;
  isUploading: boolean;
  progress: number;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isPending: boolean;
}) {
  return (
    <div className="relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-colors hover:bg-muted/50">
      {isUploading ? (
        <div className="w-full max-w-xs text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Uploading & Hashing...</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <input
            type="file"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            onChange={onUpload}
            aria-label={`Upload ${title}`}
            accept="video/*,image/*"
            disabled={isPending}
          />
          <div className="pointer-events-none flex flex-col items-center">
            <div className="mb-4 rounded-full bg-muted p-3">
              <FileVideo className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="mb-4 text-center">
              <p className="text-sm font-medium">Click to upload {title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                SHA-256 deduplication enabled
              </p>
            </div>
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-4 w-4" />
              Select File
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function DuplicateDialog({
  isOpen,
  onOpenChange,
  onReuse,
  assetName,
  isPending,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReuse: () => void;
  assetName?: string;
  isPending: boolean;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Asset Found</DialogTitle>
          <DialogDescription>
            An identical file already exists in this project. We can link to it
            immediately without re-uploading, saving time and storage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/50 dark:bg-yellow-900/10">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
          <div>
            <div className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Hash Match Verified
            </div>
            <div className="text-xs text-yellow-700 dark:text-yellow-300">
              File: {assetName}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onReuse} disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Link Existing File
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
