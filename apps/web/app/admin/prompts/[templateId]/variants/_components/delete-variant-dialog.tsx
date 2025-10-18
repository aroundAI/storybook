'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { Loader2Icon, Trash2Icon } from 'lucide-react';

interface DeleteVariantDialogProps {
  variantId: string;
  variantName: string;
  onDelete: (id: string) => Promise<void>;
}

export function DeleteVariantDialog({
  variantId,
  variantName,
  onDelete,
}: DeleteVariantDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await onDelete(variantId);
        toast.success('Variant deleted successfully');
        router.refresh();
        setOpen(false);
      } catch (error) {
        toast.error('Failed to delete variant');
        console.error(error);
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Variant</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the variant{' '}
            <span className="font-semibold">{variantName}</span>? This action
            cannot be undone.
            <br />
            <br />
            All account assignments and experiment data for this variant will be
            permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            Delete Variant
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
