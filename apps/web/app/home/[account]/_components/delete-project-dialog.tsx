'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Trash2 } from 'lucide-react';

import { refusalMessage } from '@kit/next/action-result';
import { deleteProjectAction } from '@kit/projects/mutations';
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
import { Trans } from '@kit/ui/trans';

interface DeleteProjectDialogProps {
  projectId: string;
  projectName: string;
  accountSlug: string;
}

export function DeleteProjectDialog({
  projectId,
  projectName,
  accountSlug,
}: DeleteProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const result = await deleteProjectAction({ id: projectId });

        if (result.success) {
          toast.success(<Trans i18nKey="projects:deleteSuccess" />);
          setOpen(false);
          router.push(`/home/${accountSlug}/studio`);
        }
      } catch (error) {
        toast.error(
          <Trans
            i18nKey="projects:deleteError"
            values={{
              error: refusalMessage(error, 'Unknown error'),
            }}
          />,
        );
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" />
          <Trans i18nKey={'common:delete'} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans i18nKey={'projects:deleteProjectTitle'} />
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans i18nKey={'projects:deleteProjectConfirm'} />
          </AlertDialogDescription>

          <div className="mt-4 space-y-2">
            <div className="font-semibold">{projectName}</div>
            <div className="text-sm text-destructive">
              <Trans i18nKey={'projects:deleteProjectWarning'} />
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            <Trans i18nKey={'common:cancel'} />
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
              <Trans i18nKey={'common:deleting'} />
            ) : (
              <Trans i18nKey={'common:confirm'} />
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
