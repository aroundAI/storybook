'use client';

import { createContext, useCallback, useMemo, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  RotateCcw,
  X,
} from 'lucide-react';

import { bulkResetToStageAction } from '@kit/episodes/server/actions';
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
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

export interface SelectionContextValue {
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export const SelectionContext = createContext<SelectionContextValue | null>(
  null,
);

type TargetStage = 'draft' | 'story' | 'screenplay';

const STAGE_LABELS: Record<TargetStage, string> = {
  story: 'Story',
  screenplay: 'Screenplay',
  draft: 'Draft',
};

const STAGE_DESCRIPTIONS: Record<TargetStage, string> = {
  draft:
    'All generated content will be removed: story, screenplay, shots, dialogue, and audio.',
  story:
    'Screenplay, shots, dialogue, and audio will be cleared. Story data will be kept.',
  screenplay:
    'Shots and audio will be cleared. Story and screenplay data will be kept.',
};

interface EpisodeListWrapperProps {
  children: React.ReactNode;
  episodes: Array<{ id: string; title: string; status: string }>;
  accountId: string;
}

export function EpisodeListWrapper({
  children,
  episodes,
  accountId,
}: EpisodeListWrapperProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    stage: TargetStage;
  }>({ open: false, stage: 'draft' });

  const onToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === episodes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(episodes.map((e) => e.id)));
    }
  }, [selectedIds.size, episodes]);

  const handleResetConfirm = useCallback(async () => {
    const stage = confirmDialog.stage;
    const ids = Array.from(selectedIds);

    startTransition(async () => {
      try {
        const result = await bulkResetToStageAction({
          episodeIds: ids,
          accountId,
          targetStage: stage,
        });

        if (result.success) {
          toast.success(
            `${result.resetCount} episode${result.resetCount !== 1 ? 's' : ''} reset to ${STAGE_LABELS[stage]}`,
          );
        } else {
          toast.warning(
            `Reset ${result.resetCount} episodes with ${result.errors.length} error(s)`,
          );
        }

        router.refresh();
        exitSelectionMode();
      } catch {
        toast.error('Failed to reset episodes. Please try again.');
      } finally {
        setConfirmDialog({ open: false, stage: 'draft' });
      }
    });
  }, [confirmDialog.stage, selectedIds, accountId, router, exitSelectionMode]);

  const selectedEpisodeTitles = useMemo(
    () =>
      episodes
        .filter((e) => selectedIds.has(e.id))
        .map((e) => e.title),
    [episodes, selectedIds],
  );

  const contextValue = useMemo<SelectionContextValue>(
    () => ({ selectionMode, selectedIds, onToggleSelect }),
    [selectionMode, selectedIds, onToggleSelect],
  );

  return (
    <SelectionContext.Provider value={contextValue}>
      {/* Selection mode toggle */}
      {!selectionMode && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectionMode(true)}
            className="gap-2 border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <CheckSquare className="h-4 w-4" />
            Select
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectionMode && (
        <div className="animate-in fade-in slide-in-from-top-2 sticky top-0 z-30 mb-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/90 px-4 py-3 shadow-lg backdrop-blur-md duration-200">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300">
              {selectedIds.size} selected
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              className="text-xs text-slate-400 hover:text-white"
            >
              {selectedIds.size === episodes.length
                ? 'Deselect All'
                : 'Select All'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selectedIds.size === 0}
                  className={cn(
                    'gap-2 border-white/10 bg-white/[0.05]',
                    selectedIds.size === 0
                      ? 'cursor-not-allowed text-slate-600'
                      : 'text-slate-300 hover:bg-white/[0.08] hover:text-white',
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to…
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-white/10 bg-slate-900"
              >
                <DropdownMenuItem
                  onClick={() =>
                    setConfirmDialog({ open: true, stage: 'story' })
                  }
                  className="text-slate-300 focus:bg-white/[0.08] focus:text-white"
                >
                  Reset to Story
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setConfirmDialog({ open: true, stage: 'screenplay' })
                  }
                  className="text-slate-300 focus:bg-white/[0.08] focus:text-white"
                >
                  Reset to Screenplay
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setConfirmDialog({ open: true, stage: 'draft' })
                  }
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                >
                  Reset to Draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              onClick={exitSelectionMode}
              className="gap-1.5 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {children}

      {/* Confirmation dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          !open && setConfirmDialog({ open: false, stage: 'draft' })
        }
      >
        <AlertDialogContent className="border-white/10 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Reset {selectedIds.size} episode
              {selectedIds.size !== 1 ? 's' : ''} to{' '}
              {STAGE_LABELS[confirmDialog.stage]}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-slate-400">
              <p>{STAGE_DESCRIPTIONS[confirmDialog.stage]}</p>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="mb-1.5 text-xs font-medium text-slate-500">
                  Episodes to reset:
                </p>
                <ul className="space-y-0.5">
                  {selectedEpisodeTitles.map((title) => (
                    <li key={title} className="text-sm text-slate-300">
                      • {title}
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/[0.08]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetConfirm}
              disabled={isPending}
              className={cn(
                'gap-2',
                confirmDialog.stage === 'draft'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700',
              )}
            >
              {isPending ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  Resetting…
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to {STAGE_LABELS[confirmDialog.stage]}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SelectionContext.Provider>
  );
}
