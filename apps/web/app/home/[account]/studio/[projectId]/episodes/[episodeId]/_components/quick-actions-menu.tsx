'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Copy, Download, Loader2, MoreVertical, Trash2 } from 'lucide-react';

import { deleteEpisodeAction } from '@kit/episodes/server/actions';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';

interface QuickActionsMenuProps {
  episodeId: string;
  episodeTitle: string;
  projectId: string;
  account: string;
}

export function QuickActionsMenu({
  episodeId,
  episodeTitle,
  projectId,
  account,
}: QuickActionsMenuProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const result = await deleteEpisodeAction({ episodeId });

      if (result.success) {
        toast.success('Episode deleted successfully');
        router.push(`/home/${account}/studio/${projectId}/episodes`);
      } else {
        toast.error('Failed to delete episode');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete episode',
      );
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  function handleDuplicate() {
    toast.info('Duplicate episode feature coming soon');
  }

  function handleExport() {
    toast.info('Export screenplay feature coming soon');
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Episode actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="mr-2 h-4 w-4" />
            Duplicate Episode
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export Screenplay
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowDeleteDialog(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Episode
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Episode</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{episodeTitle}&quot;? This
              action cannot be undone and will also delete all associated shots.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
