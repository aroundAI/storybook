'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  Copy,
  Download,
  Loader2,
  MoreVertical,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import {
  deleteEpisodeAction,
  resetEpisodeAction,
} from '@kit/episodes/server/actions';
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
  episodeVersion: number;
  projectId: string;
  account: string;
}

export function QuickActionsMenu({
  episodeId,
  episodeTitle,
  episodeVersion,
  projectId,
  account,
}: QuickActionsMenuProps) {
  const router = useRouter();

  // Consolidated dialog/loading state
  const [state, setState] = useState({
    showDeleteDialog: false,
    showResetDialog: false,
    isDeleting: false,
    isResetting: false,
  });

  async function handleDelete() {
    setState((s) => ({ ...s, isDeleting: true }));
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
      setState((s) => ({ ...s, isDeleting: false, showDeleteDialog: false }));
    }
  }

  async function handleReset() {
    setState((s) => ({ ...s, isResetting: true }));
    try {
      const result = await resetEpisodeAction({
        episodeId,
        version: episodeVersion,
      });

      if (result.success) {
        toast.success('Episode reset to Draft — all content has been cleared');
        router.refresh();
      } else {
        toast.error('Failed to reset episode');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reset episode',
      );
    } finally {
      setState((s) => ({ ...s, isResetting: false, showResetDialog: false }));
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
            onClick={() => setState((s) => ({ ...s, showResetDialog: true }))}
            className="text-amber-600 focus:text-amber-600 dark:text-amber-500 dark:focus:text-amber-500"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to Draft
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setState((s) => ({ ...s, showDeleteDialog: true }))}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Episode
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reset to Draft confirmation */}
      <AlertDialog
        open={state.showResetDialog}
        onOpenChange={(open) =>
          setState((s) => ({ ...s, showResetDialog: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Episode to Draft?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will permanently erase all generated content for{' '}
                  <strong>&quot;{episodeTitle}&quot;</strong>:
                </p>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  <li>Story &amp; narrative</li>
                  <li>Screenplay &amp; all scenes</li>
                  <li>Shot list &amp; all individual shots</li>
                  <li>Canon data (narrative arcs, character states, events)</li>
                </ul>
                <p className="font-medium text-amber-600 dark:text-amber-500">
                  This cannot be undone. The episode will return to Draft status
                  so you can regenerate from scratch.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.isResetting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={state.isResetting}
              className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              {state.isResetting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reset to Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={state.showDeleteDialog}
        onOpenChange={(open) =>
          setState((s) => ({ ...s, showDeleteDialog: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Episode</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{episodeTitle}&quot;? This
              action cannot be undone and will also delete all associated shots.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.isDeleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={state.isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {state.isDeleting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
