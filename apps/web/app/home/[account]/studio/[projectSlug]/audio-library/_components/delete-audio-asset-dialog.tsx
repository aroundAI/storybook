'use client';

import { type MouseEvent, useState, useTransition } from 'react';

import { deleteAudioAssetAction } from '@kit/audio-generation/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { toast } from '@kit/ui/sonner';

import type { AudioAsset } from './audio-asset-card';

interface DeleteAudioAssetDialogProps {
  /** The asset to confirm, or null when closed */
  asset: AudioAsset | null;
  onClose: () => void;
  onDeleted: (assetId: string) => void;
}

/**
 * Confirms, then deletes, a library asset (KB-95). A refusal keeps the
 * dialog open with its reason; the card stays until the server says it is
 * gone.
 */
export function DeleteAudioAssetDialog({
  asset,
  onClose,
  onDeleted,
}: DeleteAudioAssetDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const handleDelete = (event: MouseEvent) => {
    // Radix closes the dialog on its action; it stays open until we know
    event.preventDefault();

    if (!asset) return;

    startTransition(async () => {
      try {
        await unwrap(deleteAudioAssetAction({ assetId: asset.id }));
        toast.success('Deleted');
        setError(null);
        onDeleted(asset.id);
      } catch (err) {
        setError(refusalMessage(err, "Couldn't delete this asset."));
      }
    });
  };

  return (
    <AlertDialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) close();
      }}
    >
      <AlertDialogContent data-test="audio-asset-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-semibold">
              {asset?.name ?? asset?.prompt}
            </span>{' '}
            is removed from the library. Episodes already using it keep playing
            it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-test="audio-asset-delete-error"
          >
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            aria-busy={isPending}
            data-test="audio-asset-delete-confirm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
