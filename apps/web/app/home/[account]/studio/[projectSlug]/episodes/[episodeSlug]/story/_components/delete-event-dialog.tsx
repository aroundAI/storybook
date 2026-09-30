'use client';

import { useState, useTransition } from 'react';

import { Loader2, Trash2 } from 'lucide-react';

import { deleteImmutableEventAction } from '@kit/episodes/server';
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

interface DeleteEventDialogProps {
  eventId: string;
  description: string;
  onDeleted: () => void;
}

/**
 * Immutable events are never edited: a correction is a delete and a new
 * event (`deleteImmutableEventAction`), so this is the only change offered.
 */
export function DeleteEventDialog({
  eventId,
  description,
  onDeleted,
}: DeleteEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await unwrap(deleteImmutableEventAction({ eventId, confirm: true }));
        toast.success('Event deleted');
        setOpen(false);
        onDeleted();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to delete event'));
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Delete event"
          data-test="canon-event-delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-test="canon-event-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this immutable event?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{description}&rdquo; stops constraining new episodes. Events
            are not edited: to correct one, delete it and add the right one. The
            deletion is recorded in the canon audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
            data-test="canon-event-delete-confirm"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Delete event
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
