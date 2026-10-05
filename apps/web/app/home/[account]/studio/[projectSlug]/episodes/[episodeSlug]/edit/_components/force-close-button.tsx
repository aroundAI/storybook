'use client';

import { useState, useTransition } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
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

import { forceCloseEditSessionAction } from '../_lib/server/actions';

/**
 * A project owner's or admin's force-close of an open Studio session
 * (FILM-2006). The Studio holding it loses the session and opens a new one
 * the next time; the episode goes back to its previous status.
 */
export function ForceCloseButton(props: {
  sessionId: string;
  editorName: string | null;
  path: string;
}) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = () =>
    startTransition(async () => {
      setRefusal(null);

      try {
        const result = await forceCloseEditSessionAction({
          sessionId: props.sessionId,
          path: props.path,
        });

        if (result.ok) {
          toast.success('The Studio session was closed.');
        } else {
          setRefusal(result.message);
        }
      } catch {
        setRefusal('The session could not be closed. Try again.');
      }
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            data-test="force-close-session"
          >
            {pending ? 'Closing…' : 'Force-close session'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this Studio session?</AlertDialogTitle>
            <AlertDialogDescription>
              {props.editorName ?? 'A teammate'} loses the session. Their work
              stays on their computer, and nothing they have not delivered
              reaches StoryBook. The episode goes back to the status it had
              before the session opened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              onClick={close}
              data-test="force-close-session-confirm"
            >
              Close the session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {refusal ? (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-test="force-close-session-refusal"
        >
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
