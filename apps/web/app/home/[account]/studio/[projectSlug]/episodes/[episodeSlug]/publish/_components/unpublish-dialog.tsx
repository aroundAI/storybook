'use client';

import {
  AlertCircle,
  Check,
  Clock,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';

import { PlatformIcon } from './platform-ui';
import type { DeleteItemStatus, DeleteStage } from './publish-types';

interface UnpublishDialogProps {
  deleteStage: DeleteStage;
  deleteStatuses: DeleteItemStatus[];
  deleteError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UnpublishDialog({
  deleteStage,
  deleteStatuses,
  deleteError,
  onCancel,
  onConfirm,
}: UnpublishDialogProps) {
  return (
    <Dialog
      open={deleteStage !== 'idle'}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {deleteStage === 'confirm' && (
              <>
                <Trash2 className="h-5 w-5 text-red-500" />
                Confirm Unpublish
              </>
            )}
            {deleteStage === 'deleting' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                Unpublishing...
              </>
            )}
            {deleteStage === 'complete' && (
              <>
                <Check className="h-5 w-5 text-green-500" />
                Unpublished
              </>
            )}
            {deleteStage === 'error' && (
              <>
                <AlertCircle className="h-5 w-5 text-red-500" />
                Unpublish Failed
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Item Status */}
          <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            {deleteStatuses.map((s) => (
              <div
                key={s.publishId}
                className="flex items-center gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
              >
                <PlatformIcon platform={s.platform} size="lg" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{s.channelName}</span>
                  {s.note && (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      ⚠️ {s.note}
                    </p>
                  )}
                  {s.error && (
                    <p className="mt-0.5 text-xs text-red-500">{s.error}</p>
                  )}
                </div>
                <div>
                  {s.status === 'pending' && (
                    <Clock className="h-4 w-4 text-gray-400" />
                  )}
                  {s.status === 'deleting' && (
                    <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                  )}
                  {s.status === 'success' && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                  {s.status === 'error' && (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  {s.status === 'skipped' && (
                    <span className="text-xs text-gray-400">Skipped</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {deleteStage === 'confirm' && (
            <p className="text-sm text-gray-500">
              This will delete the content from the platform and remove it
              from your records.
            </p>
          )}

          {deleteStage === 'error' && deleteError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-sm text-red-700 dark:text-red-400">
                {deleteError}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            {deleteStage === 'confirm' && (
              <>
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button onClick={onConfirm} variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Unpublish
                </Button>
              </>
            )}
            {(deleteStage === 'complete' || deleteStage === 'error') && (
              <Button onClick={onCancel}>
                {deleteStage === 'complete' ? 'Done' : 'Close'}
              </Button>
            )}
            {deleteStage === 'deleting' && (
              <Button variant="outline" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Please wait...
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
