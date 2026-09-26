'use client';

import { AlertCircle, Loader2, Trash2 } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  PLATFORMS,
  PLATFORMS_DELETED_ON_UNPUBLISH,
  PLATFORM_NAMES,
  type Platform,
} from '@kit/publishing/lib/platforms';
import { deleteEpisodePublishesAction } from '@kit/publishing/server';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

// What the publish worker actually deletes (KB-119): the text follows the
// list, so it cannot promise more or less than the worker does
const REMOTELY_DELETED = joinNames(PLATFORMS_DELETED_ON_UNPUBLISH);
const ONLY_RECORD_REMOVED = joinNames(
  PLATFORMS.filter(
    (platform) =>
      !(PLATFORMS_DELETED_ON_UNPUBLISH as readonly string[]).includes(platform),
  ),
);

function joinNames(platforms: readonly Platform[]) {
  const names = platforms.map((platform) => PLATFORM_NAMES[platform]);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}

interface DeleteAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeId: string;
  isDeletingAll: boolean;
  setIsDeletingAll: (v: boolean) => void;
  onDeleted: () => void;
}

export function DeleteAllDialog({
  open,
  onOpenChange,
  episodeId,
  isDeletingAll,
  setIsDeletingAll,
  onDeleted,
}: DeleteAllDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !isDeletingAll && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Delete All Published Videos
          </DialogTitle>
        </DialogHeader>
        <div className="py-4" data-test="publish-delete-all-copy">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This deletes this episode&apos;s videos on {REMOTELY_DELETED}, and
            removes every publish record for the episode. This cannot be undone.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
            Videos on {ONLY_RECORD_REMOVED} stay up: only our record of them is
            removed. Delete those on the platform.
          </p>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeletingAll}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isDeletingAll}
            onClick={async () => {
              setIsDeletingAll(true);
              try {
                const result = await unwrap(
                  deleteEpisodePublishesAction({ episodeId }),
                );
                toast.success(
                  `Deleted ${result.deletedCount} publish record(s)`,
                );
                onDeleted();
                onOpenChange(false);
              } catch (error) {
                toast.error(
                  refusalMessage(error, 'Failed to delete publish records'),
                );
              } finally {
                setIsDeletingAll(false);
              }
            }}
          >
            {isDeletingAll ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete All
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
