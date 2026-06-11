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
  resetToStageAction,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';

type ResetStage = 'draft' | 'story' | 'screenplay' | 'storyboard';

const stageLabels: Record<ResetStage, string> = {
  draft: 'Draft',
  story: 'Story',
  screenplay: 'Screenplay',
  storyboard: 'Storyboard',
};

const stageDeleteDescriptions: Record<ResetStage, string[]> = {
  draft: [
    'Story & narrative',
    'Screenplay & all scenes',
    'Shot list & all individual shots',
    'Audio & dialogue timeline',
    'Canon data (narrative arcs, character states, events)',
  ],
  story: [
    'Screenplay & all scenes',
    'Shot list & all individual shots',
    'Audio & dialogue timeline',
    'Canon data (narrative arcs, character states, events)',
  ],
  screenplay: [
    'Shot list & all individual shots',
    'Audio & dialogue timeline',
  ],
  storyboard: [
    'Shot list & all individual shots',
    'Audio & dialogue timeline',
  ],
};

interface QuickActionsMenuProps {
  episodeId: string;
  episodeTitle: string;
  episodeVersion: number;
  episodeStatus: string;
  projectSlug: string;
  account: string;
}

export function QuickActionsMenu({
  episodeId,
  episodeTitle,
  episodeVersion: _episodeVersion,
  episodeStatus,
  projectSlug,
  account,
}: QuickActionsMenuProps) {
  const router = useRouter();

  const [state, setState] = useState({
    showDeleteDialog: false,
    showResetDialog: false,
    resetTargetStage: 'draft' as ResetStage,
    isDeleting: false,
    isResetting: false,
  });

  async function handleDelete() {
    setState((s) => ({ ...s, isDeleting: true }));
    try {
      const result = await deleteEpisodeAction({ episodeId });

      if (result.success) {
        toast.success('Episode deleted successfully');
        router.push(`/home/${account}/studio/${projectSlug}/episodes`);
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
    setState((s) => ({ ...s, isResetting: true, showResetDialog: false }));

    const loadingToastId = toast.loading(
      `Resetting episode to ${stageLabels[state.resetTargetStage]}...`,
    );

    try {
      const result = await resetToStageAction({
        episodeId,
        targetStage: state.resetTargetStage,
      });

      toast.dismiss(loadingToastId);

      if (result.success) {
        toast.success(
          `Episode reset to ${stageLabels[state.resetTargetStage]}`,
        );
        router.refresh();
      } else {
        toast.error('Failed to reset episode');
      }
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.error(
        error instanceof Error ? error.message : 'Failed to reset episode',
      );
    } finally {
      setState((s) => ({ ...s, isResetting: false }));
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-amber-600 focus:text-amber-600 dark:text-amber-500 dark:focus:text-amber-500">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to...
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={
                  ![
                    'story',
                    'storyboard',
                    'visual-studio',
                    'audio-studio',
                    'review',
                    'published',
                  ].includes(episodeStatus)
                }
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    showResetDialog: true,
                    resetTargetStage: 'story',
                  }))
                }
              >
                Reset to Story
                <span className="ml-auto text-xs text-muted-foreground">
                  Clears screenplay, shots, audio
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  ![
                    'storyboard',
                    'visual-studio',
                    'audio-studio',
                    'review',
                    'published',
                  ].includes(episodeStatus)
                }
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    showResetDialog: true,
                    resetTargetStage: 'screenplay',
                  }))
                }
              >
                Reset to Screenplay
                <span className="ml-auto text-xs text-muted-foreground">
                  Clears shots, audio
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-amber-600 focus:text-amber-600 dark:text-amber-500 dark:focus:text-amber-500"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    showResetDialog: true,
                    resetTargetStage: 'draft',
                  }))
                }
              >
                Reset to Draft
                <span className="ml-auto text-xs text-muted-foreground">
                  Clears everything
                </span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

      {/* Reset confirmation */}
      <AlertDialog
        open={state.showResetDialog}
        onOpenChange={(open) =>
          setState((s) => ({ ...s, showResetDialog: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset Episode to {stageLabels[state.resetTargetStage]}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will permanently erase the following content for{' '}
                  <strong>&quot;{episodeTitle}&quot;</strong>:
                </p>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {stageDeleteDescriptions[state.resetTargetStage].map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
                <p className="font-medium text-amber-600 dark:text-amber-500">
                  This cannot be undone. The episode will return to{' '}
                  {stageLabels[state.resetTargetStage]} status so you can
                  regenerate from that point.
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
              Reset to {stageLabels[state.resetTargetStage]}
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
