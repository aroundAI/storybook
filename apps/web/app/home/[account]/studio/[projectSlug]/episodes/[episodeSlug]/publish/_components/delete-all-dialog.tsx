'use client';

import { AlertCircle, Loader2, Trash2 } from 'lucide-react';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { deleteEpisodePublishesAction } from '@kit/publishing/server';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

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
            Delete All Publish Records
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This will permanently delete all publish records for this episode.
            This action cannot be undone.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
            Note: This only removes records from our system. Videos already
            published to platforms will need to be deleted manually.
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
