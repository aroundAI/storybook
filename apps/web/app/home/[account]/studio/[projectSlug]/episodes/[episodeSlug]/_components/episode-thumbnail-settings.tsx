'use client';

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
  useTransition,
} from 'react';

import {
  Check,
  ImageIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  type EpisodeThumbnail,
  deleteEpisodeThumbnailAction,
  getEpisodeThumbnailsAction,
  setDefaultThumbnailAction,
  uploadEpisodeThumbnailAction,
} from '@kit/episodes/server';
import { unwrap } from '@kit/next/action-result';
import {
  PROJECT_ASSETS_BUCKET,
  episodeThumbnailPath,
  fileExtension,
} from '@kit/storage/upload-paths';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
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

import { uploadWithPresignedUrl } from '~/lib/presigned-upload';

/** YouTube's limit, and so the publish screen's (KB-89: one limit, not two) */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

// ============================================================================
// Types
// ============================================================================

interface EpisodeThumbnailSettingsProps {
  episodeId: string;
  /**
   * The episode's thumbnails, owned by the publish screen: its per-language
   * video slots read the same list, so the two cannot disagree (KB-89).
   * `null` while it loads.
   */
  thumbnails: EpisodeThumbnail[] | null;
  onThumbnailsChange: Dispatch<SetStateAction<EpisodeThumbnail[]>>;
}

// ============================================================================
// Main Component
// ============================================================================

export function EpisodeThumbnailSettings({
  episodeId,
  thumbnails,
  onThumbnailsChange,
}: EpisodeThumbnailSettingsProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const handleThumbnailSaved = (saved: EpisodeThumbnail) => {
    onThumbnailsChange((prev) =>
      [...prev.filter((t) => t.language !== saved.language), saved].sort(
        (a, b) => a.language.localeCompare(b.language),
      ),
    );
    setIsAddDialogOpen(false);
  };

  const handleThumbnailRemoved = (removedId: string) => {
    onThumbnailsChange((prev) => prev.filter((t) => t.id !== removedId));
  };

  const handleDefaultSet = (thumbnailId: string) => {
    onThumbnailsChange((prev) =>
      prev.map((t) => ({ ...t, isDefault: t.id === thumbnailId })),
    );
  };

  // After a refusal the list may be stale (removed or replaced in another
  // tab): read it again rather than keep showing what is no longer there.
  const reloadThumbnails = async () => {
    const result = await getEpisodeThumbnailsAction({ episodeId });

    if (result.success && result.thumbnails) {
      onThumbnailsChange(result.thumbnails);
    }
  };

  return (
    <Card data-test="episode-thumbnails">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Episode Thumbnails</CardTitle>
            <CardDescription>
              One thumbnail per language, used when publishing a video in that
              language. A language without its own uses the default.
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                data-test="thumbnail-add"
                disabled={thumbnails === null}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Thumbnail
              </Button>
            </DialogTrigger>
            <AddThumbnailDialog
              episodeId={episodeId}
              existingLanguages={(thumbnails ?? []).map((t) => t.language)}
              onSuccess={handleThumbnailSaved}
              onClose={() => setIsAddDialogOpen(false)}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {thumbnails === null ? (
          <div
            className="flex items-center justify-center py-8"
            data-test="thumbnails-loading"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : thumbnails.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-8 text-center"
            data-test="thumbnails-empty"
          >
            <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No thumbnails uploaded yet. Click &quot;Add Thumbnail&quot; to
              upload your first one.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {thumbnails.map((thumbnail) => (
              <ThumbnailCard
                key={thumbnail.id}
                thumbnail={thumbnail}
                episodeId={episodeId}
                onRemoved={handleThumbnailRemoved}
                onReplaced={handleThumbnailSaved}
                onDefaultSet={handleDefaultSet}
                onRefused={reloadThumbnails}
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
  onRemoved: (id: string) => void;
  onReplaced: (thumbnail: EpisodeThumbnail) => void;
  onDefaultSet: (id: string) => void;
  onRefused: () => Promise<void>;
}

function ThumbnailCard({
  thumbnail,
  episodeId,
  onRemoved,
  onReplaced,
  onDefaultSet,
  onRefused,
}: ThumbnailCardProps) {
  const [isRemoving, startRemoveTransition] = useTransition();
  const [isSettingDefault, startDefaultTransition] = useTransition();
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const label = thumbnail.languageLabel || thumbnail.language;

  const handleRemove = () => {
    startRemoveTransition(async () => {
      try {
        const result = await unwrap(
          deleteEpisodeThumbnailAction({
            thumbnailId: thumbnail.id,
            episodeId,
          }),
        );

        if (result.success) {
          toast.success(`Removed the ${label} thumbnail`);
          onRemoved(thumbnail.id);
        } else {
          toast.error(result.error || 'Failed to remove thumbnail');
          await onRefused();
        }
      } catch {
        toast.error('Failed to remove thumbnail');
      } finally {
        setIsConfirmOpen(false);
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
          toast.success(`Set ${label} as default`);
          onDefaultSet(thumbnail.id);
        } else {
          toast.error(result.error || 'Failed to set default');
        }
      } catch {
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
    <div
      className="group relative overflow-hidden rounded-lg border"
      data-test={`thumbnail-${thumbnail.language}`}
    >
      <div className="aspect-video w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnail.thumbnailUrl}
          alt={`${label} thumbnail`}
          className="h-full w-full object-cover"
        />
      </div>

      {thumbnail.isDefault && (
        <div
          className="absolute top-2 left-2 flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          data-test="thumbnail-default"
        >
          <Star className="h-3 w-3" />
          Default
        </div>
      )}

      {/* Shown on hover, and whenever a control inside has focus */}
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Dialog
          open={isReplaceDialogOpen}
          onOpenChange={setIsReplaceDialogOpen}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              data-test={`thumbnail-replace-${thumbnail.language}`}
            >
              <Upload className="mr-1 h-3 w-3" />
              Replace
            </Button>
          </DialogTrigger>
          <AddThumbnailDialog
            episodeId={episodeId}
            existingLanguages={[]}
            prefillLanguage={thumbnail.language}
            prefillLabel={thumbnail.languageLabel || undefined}
            onSuccess={(saved) => {
              onReplaced(saved);
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
            data-test={`thumbnail-set-default-${thumbnail.language}`}
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
          onClick={() => setIsConfirmOpen(true)}
          disabled={isRemoving}
          aria-label={`Remove the ${label} thumbnail`}
          data-test={`thumbnail-remove-${thumbnail.language}`}
        >
          {isRemoving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {label} thumbnail?</AlertDialogTitle>
            <AlertDialogDescription>
              The image file is deleted too.
              {thumbnail.isDefault
                ? ' It is the default, so languages without their own thumbnail will have none.'
                : ' Videos in this language will use the default thumbnail.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemoving}
              data-test="thumbnail-remove-confirm"
              onClick={(event) => {
                // Stay open until the action answers
                event.preventDefault();
                handleRemove();
              }}
            >
              {isRemoving ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="p-3">
        <h4 className="font-medium">
          {label}
          <span className="ml-2 text-xs text-muted-foreground">
            ({thumbnail.language})
          </span>
        </h4>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {thumbnail.width && thumbnail.height && (
            <span>
              {thumbnail.width}×{thumbnail.height}
            </span>
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
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const isReplacing = !!prefillLanguage;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      if (file.size > MAX_THUMBNAIL_BYTES) {
        toast.error(
          `Thumbnail must be under 2MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB`,
        );
        return;
      }
      setSelectedFile(file);

      const url = URL.createObjectURL(file);
      setPreviewUrl(url);

      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
      };
      img.src = url;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const code = language.trim().toLowerCase();

    if (!code) {
      toast.error('Please enter a language code');
      return;
    }

    if (!selectedFile) {
      toast.error('Please select an image file');
      return;
    }

    if (!isReplacing && existingLanguages.includes(code)) {
      toast.error(
        `A thumbnail for "${code}" already exists. Use "Replace" to update it.`,
      );
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      setUploadProgress(30);

      // The path the publish screen's upload uses, and the folder the save
      // action accepts (KB-90)
      const uploadResult = await uploadWithPresignedUrl(
        selectedFile,
        PROJECT_ASSETS_BUCKET,
        episodeThumbnailPath(
          episodeId,
          code,
          fileExtension(selectedFile.name, 'jpg'),
        ),
      );

      setUploadProgress(70);

      const result = await unwrap(
        uploadEpisodeThumbnailAction({
          episodeId,
          language: code,
          languageLabel: languageLabel.trim() || undefined,
          thumbnailUrl: uploadResult.url,
          fileName: selectedFile.name,
          fileSizeBytes: selectedFile.size,
          mimeType: selectedFile.type,
          width: imageDimensions?.width,
          height: imageDimensions?.height,
        }),
      );

      setUploadProgress(100);

      if (result.success && result.thumbnail) {
        toast.success(
          isReplacing
            ? `Replaced ${languageLabel || code} thumbnail`
            : `Added ${languageLabel || code} thumbnail`,
        );
        onSuccess(result.thumbnail);
      } else {
        toast.error(result.error || 'Failed to save thumbnail');
      }
    } catch {
      toast.error('Failed to upload thumbnail');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Revoke the preview's object URL when it changes or the dialog closes
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
          <div className="grid gap-2">
            <Label htmlFor="thumbnail-language">Language Code</Label>
            <Input
              id="thumbnail-language"
              data-test="thumbnail-language"
              placeholder="e.g., en, hi, es, it"
              value={language}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setLanguage(e.target.value)
              }
              disabled={isReplacing}
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">
              Use ISO 639-1 codes (en, hi, es) or custom codes
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="thumbnail-label">Display Name (Optional)</Label>
            <Input
              id="thumbnail-label"
              placeholder="e.g., English, Hindi, Italian"
              value={languageLabel}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setLanguageLabel(e.target.value)
              }
              maxLength={100}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="thumbnail-image">Thumbnail Image</Label>
            <Input
              id="thumbnail-image"
              data-test="thumbnail-file"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground">
              Recommended: 1280×720 (16:9). Max 2MB. PNG/JPG/WebP.
            </p>
          </div>

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
              {imageDimensions && selectedFile && (
                <p className="text-xs text-muted-foreground">
                  {imageDimensions.width}×{imageDimensions.height} •{' '}
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          )}

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
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            data-test="thumbnail-submit"
            disabled={isUploading || !selectedFile || !language}
          >
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
