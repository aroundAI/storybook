'use client';

import { useState, useTransition } from 'react';

import { Loader2, Undo2 } from 'lucide-react';

import { rollbackCharacterStateAction } from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

interface RollbackStateDialogProps {
  deltaId: string;
  characterName: string;
  currentState: string;
  restoredState: string;
  onRolledBack: () => void;
}

/**
 * Character states are append-only, so a rollback does not delete the change:
 * it records a new state that restores the earlier one, and logs it.
 */
export function RollbackStateDialog({
  deltaId,
  characterName,
  currentState,
  restoredState,
  onRolledBack,
}: RollbackStateDialogProps) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRollback = () => {
    startTransition(async () => {
      try {
        await unwrap(rollbackCharacterStateAction({ deltaId }));
        toast.success('Character state rolled back');
        setRefusal(null);
        setOpen(false);
        onRolledBack();
      } catch (error) {
        setRefusal(refusalMessage(error, 'Failed to roll back the change'));
      }
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRefusal(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground"
          data-test="canon-character-rollback"
        >
          <Undo2 className="h-3 w-3" />
          Rollback
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-test="canon-character-rollback-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Roll back the latest change to {characterName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{currentState}&rdquo; is replaced by &ldquo;{restoredState}
            &rdquo; as the current state. The change stays in the history and
            the rollback is recorded in the canon audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal && (
          <p
            className="text-sm text-destructive"
            role="alert"
            data-test="canon-character-rollback-error"
          >
            {refusal}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            onClick={handleRollback}
            disabled={isPending}
            data-test="canon-character-rollback-confirm"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Roll back
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
